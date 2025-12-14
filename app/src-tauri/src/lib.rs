mod auth;
mod error;
mod github;
mod models;
mod storage;
mod review_storage;

use crate::github::CommentMode;
use auth::{
    check_auth_status, fetch_pull_request_details, fetch_file_contents_on_demand, list_repo_pull_requests, logout,
    publish_file_comment, publish_review_comment, start_oauth_flow, start_pending_review,
    finalize_pending_review,
};
use models::{AuthStatus, PullRequestDetail, PullRequestReview, PullRequestSummary};
use review_storage::{ReviewComment, ReviewMetadata};
use serde::Deserialize;
use tauri::Manager;
use tracing::{error, info};

#[cfg(all(windows, debug_assertions))]
fn set_windows_dev_titlebar_color(window: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::mem::size_of;

    // These attributes are supported starting with Windows 11 Build 22000.
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;

    fn colorref(r: u8, g: u8, b: u8) -> u32 {
        // COLORREF is 0x00BBGGRR
        (b as u32) << 16 | (g as u32) << 8 | (r as u32)
    }

    let hwnd = match window.window_handle() {
        Ok(handle) => match handle.as_raw() {
            RawWindowHandle::Win32(h) => h.hwnd.get() as windows_sys::Win32::Foundation::HWND,
            _ => return,
        },
        Err(_) => return,
    };

    // Match the common Windows accent blue for a clear dev indicator.
    let caption_color: u32 = colorref(0x00, 0x78, 0xD7);
    let text_color: u32 = colorref(0xFF, 0xFF, 0xFF);

    unsafe {
        let _ = windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            &caption_color as *const _ as _,
            size_of::<u32>() as u32,
        );
        let _ = windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            &text_color as *const _ as _,
            size_of::<u32>() as u32,
        );
        let _ = windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &caption_color as *const _ as _,
            size_of::<u32>() as u32,
        );
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitFileCommentArgs {
    owner: String,
    repo: String,
    number: u64,
    path: String,
    body: String,
    #[serde(alias = "commit_id")]
    commit_id: String,
    line: Option<u64>,
    side: Option<String>,
    #[serde(alias = "subject_type")]
    subject_type: Option<String>,
    mode: Option<String>,
    #[serde(alias = "pending_review_id")]
    pending_review_id: Option<u64>,
    #[serde(alias = "in_reply_to")]
    in_reply_to: Option<u64>,
}

fn init_logging() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn"));

    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

fn normalize_rel_path(base: &std::path::Path, path: &std::path::Path) -> String {
    let rel = path.strip_prefix(base).unwrap_or(path);
    rel.to_string_lossy().replace('\\', "/")
}

fn resolve_local_directory_path(input: &str) -> std::path::PathBuf {
    let raw = std::path::PathBuf::from(input);
    if raw.is_absolute() {
        return raw;
    }

    // In dev, the Rust process often runs with CWD = `app/src-tauri`.
    // Users tend to provide paths relative to `app/` or the repo root.
    // Try a small set of sensible bases to make relative paths work in dev.
    if let Ok(cwd) = std::env::current_dir() {
        let candidates = [
            cwd.join(&raw),
            cwd.parent().map(|p| p.join(&raw)).unwrap_or_else(|| cwd.join(&raw)),
            cwd.parent()
                .and_then(|p| p.parent())
                .map(|p| p.join(&raw))
                .unwrap_or_else(|| cwd.join(&raw)),
        ];

        for candidate in candidates {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    raw
}

fn collect_markdown_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry in {}: {}", dir.display(), e))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to get file type for {}: {}", path.display(), e))?;

        if file_type.is_dir() {
            collect_markdown_files(&path, out)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if ext == "md" || ext == "markdown" || ext == "mdx" {
            out.push(path);
        }
    }

    Ok(())
}

#[tauri::command]
async fn cmd_load_local_directory(directory: String) -> Result<PullRequestDetail, String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use sha2::{Digest, Sha256};

    let base = resolve_local_directory_path(&directory);
    if !base.exists() {
        let cwd = std::env::current_dir().ok();
        return Err(format!(
            "Local directory does not exist: {} (resolved to: {}). CWD: {}",
            directory,
            base.display(),
            cwd.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "<unknown>".into())
        ));
    }
    if !base.is_dir() {
        return Err(format!(
            "Local path is not a directory: {} (resolved to: {})",
            directory,
            base.display()
        ));
    }

    info!(
        "cmd_load_local_directory: input_dir='{}', resolved_dir='{}'",
        directory,
        base.display()
    );

    let mut hasher = Sha256::new();
    hasher.update(directory.as_bytes());
    let digest = hasher.finalize();
    let id = URL_SAFE_NO_PAD.encode(&digest[..12]);
    let sha = format!("LOCAL-{}", id);

    // Walk directory (blocking), then read contents (async)
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    collect_markdown_files(&base, &mut files)?;
    files.sort();

    info!(
        "cmd_load_local_directory: found {} markdown-like files",
        files.len()
    );

    let mut pr_files = Vec::with_capacity(files.len());

    for path in files {
        let rel_path = normalize_rel_path(&base, &path);
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

        pr_files.push(models::PullRequestFile {
            path: rel_path,
            status: "modified".to_string(),
            additions: 0,
            deletions: 0,
            patch: None,
            head_content: Some(content),
            base_content: None,
            language: "markdown".to_string(),
            previous_filename: None,
        });
    }

    let title = base
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| format!("Local: {}", s))
        .unwrap_or_else(|| format!("Local: {}", directory));

    Ok(PullRequestDetail {
        number: 1,
        title,
        body: Some(format!("Local directory mode: {}", directory)),
        author: "local".to_string(),
        head_sha: sha.clone(),
        base_sha: sha,
        files: pr_files,
        comments: Vec::new(),
        my_comments: Vec::new(),
        reviews: Vec::new(),
    })
}

#[tauri::command]
async fn cmd_start_github_oauth(app: tauri::AppHandle) -> Result<AuthStatus, String> {
    start_oauth_flow(&app).await.map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_check_auth_status() -> Result<AuthStatus, String> {
    info!("cmd_check_auth_status: checking authentication status");
    match check_auth_status().await {
        Ok(status) => {
            info!("cmd_check_auth_status: is_authenticated={}", status.is_authenticated);
            Ok(status)
        }
        Err(err) => {
            error!("cmd_check_auth_status: error - {}", err);
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn cmd_logout() -> Result<(), String> {
    logout().await.map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_list_pull_requests(
    owner: String,
    repo: String,
    state: Option<String>,
    current_login: Option<String>,
) -> Result<Vec<PullRequestSummary>, String> {
    if owner == "__local__" || repo == "local" {
        return Err("Local folder mode does not support listing GitHub pull requests".to_string());
    }
    info!("cmd_list_pull_requests: owner={}, repo={}, state={:?}", owner, repo, state);
    match list_repo_pull_requests(&owner, &repo, state.as_deref(), current_login.as_deref()).await {
        Ok(prs) => {
            info!("cmd_list_pull_requests: success, found {} PRs", prs.len());
            Ok(prs)
        }
        Err(err) => {
            error!("cmd_list_pull_requests: error - {}", err);
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn cmd_get_pull_request(
    owner: String,
    repo: String,
    number: u64,
    current_login: Option<String>,
) -> Result<PullRequestDetail, String> {
    if owner == "__local__" || repo == "local" {
        return Err("Local folder mode does not support fetching GitHub pull request details".to_string());
    }
    info!("cmd_get_pull_request: owner={}, repo={}, pr={}", owner, repo, number);
    match fetch_pull_request_details(&owner, &repo, number, current_login.as_deref()).await {
        Ok(pr) => {
            info!("cmd_get_pull_request: success, {} files", pr.files.len());
            Ok(pr)
        }
        Err(err) => {
            error!("cmd_get_pull_request: error - {}", err);
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn cmd_get_pull_request_metadata(
    owner: String,
    repo: String,
    number: u64,
) -> Result<models::PullRequestMetadata, String> {
    if owner == "__local__" || repo == "local" {
        return Err(
            "Local folder mode does not support fetching GitHub pull request metadata".to_string(),
        );
    }
    auth::fetch_pull_request_metadata(&owner, &repo, number)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_get_file_contents(
    owner: String,
    repo: String,
    file_path: String,
    base_sha: String,
    head_sha: String,
    status: String,
    previous_filename: Option<String>,
) -> Result<(Option<String>, Option<String>), String> {
    fetch_file_contents_on_demand(&owner, &repo, &file_path, &base_sha, &head_sha, &status, previous_filename.as_deref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_submit_review_comment(
    owner: String,
    repo: String,
    number: u64,
    body: String,
) -> Result<(), String> {
    publish_review_comment(&owner, &repo, number, body)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_submit_file_comment(args: SubmitFileCommentArgs) -> Result<(), String> {
    let SubmitFileCommentArgs {
        owner,
        repo,
        number,
        path,
        body,
        commit_id,
        line,
        side,
        subject_type,
        mode,
        pending_review_id,
        in_reply_to,
    } = args;

    let mode = match mode.as_deref() {
        Some("review") => CommentMode::Review,
        _ => CommentMode::Single,
    };

    publish_file_comment(
        &owner,
        &repo,
        number,
        &path,
        &body,
        &commit_id,
        line,
        side.as_deref(),
        subject_type.as_deref(),
        mode,
        pending_review_id,
        in_reply_to,
    )
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_start_pending_review(
    owner: String,
    repo: String,
    number: u64,
    commit_id: Option<String>,
    body: Option<String>,
    current_login: Option<String>,
) -> Result<PullRequestReview, String> {
    start_pending_review(
        &owner,
        &repo,
        number,
        commit_id.as_deref(),
        body.as_deref(),
        current_login.as_deref(),
    )
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_submit_pending_review(
    owner: String,
    repo: String,
    number: u64,
    review_id: u64,
    event: Option<String>,
    body: Option<String>,
) -> Result<(), String> {
    let event = event.unwrap_or_else(|| "COMMENT".into());
    finalize_pending_review(
        &owner,
        &repo,
        number,
        review_id,
        &event,
        body.as_deref(),
    )
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn cmd_open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    open_devtools_impl(window)
}

#[cfg(debug_assertions)]
fn open_devtools_impl(window: tauri::WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    Ok(())
}

#[cfg(not(debug_assertions))]
fn open_devtools_impl(_window: tauri::WebviewWindow) -> Result<(), String> {
    Err("Devtools are disabled in release builds".into())
}

#[tauri::command]
async fn cmd_local_start_review(
    owner: String,
    repo: String,
    pr_number: u64,
    commit_id: String,
    body: Option<String>,
    local_folder: Option<String>,
) -> Result<ReviewMetadata, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .start_review(
            &owner,
            &repo,
            pr_number,
            &commit_id,
            body.as_deref(),
            local_folder.as_deref(),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_local_add_comment(
    owner: String,
    repo: String,
    pr_number: u64,
    file_path: String,
    line_number: Option<u64>,
    side: String,
    body: String,
    commit_id: String,
    in_reply_to_id: Option<i64>,
    local_folder: Option<String>,
) -> Result<ReviewComment, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;

    // Ensure there is review metadata for log output, and persist the local folder path if provided.
    storage
        .start_review(
            &owner,
            &repo,
            pr_number,
            &commit_id,
            None,
            local_folder.as_deref(),
        )
        .map_err(|e| e.to_string())?;

    storage
        .add_comment(
            &owner,
            &repo,
            pr_number,
            &file_path,
            line_number.unwrap_or(0), // Use 0 for file-level comments
            &side,
            &body,
            &commit_id,
            in_reply_to_id,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_local_update_review_commit(
    owner: String,
    repo: String,
    pr_number: u64,
    new_commit_id: String,
) -> Result<ReviewMetadata, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .update_review_commit(&owner, &repo, pr_number, &new_commit_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_local_update_comment_file_path(
    owner: String,
    repo: String,
    pr_number: u64,
    old_path: String,
    new_path: String,
) -> Result<usize, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .update_comment_file_path(&owner, &repo, pr_number, &old_path, &new_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_local_update_comment(
    comment_id: i64,
    body: String,
) -> Result<ReviewComment, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .update_comment(comment_id, &body)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_local_delete_comment(comment_id: i64) -> Result<(), String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .delete_comment(comment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_github_update_comment(
    owner: String,
    repo: String,
    comment_id: u64,
    body: String,
) -> Result<(), String> {
    use auth::require_token;
    let token = require_token().map_err(|e| e.to_string())?;
    github::update_review_comment(&token, &owner, &repo, comment_id, &body)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_github_delete_comment(
    owner: String,
    repo: String,
    comment_id: u64,
) -> Result<(), String> {
    use auth::require_token;
    let token = require_token().map_err(|e| e.to_string())?;
    github::delete_review_comment(&token, &owner, &repo, comment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_fetch_file_content(
    owner: String,
    repo: String,
    reference: String,
    path: String,
) -> Result<String, String> {
    use auth::require_token;
    let token = require_token().map_err(|e| e.to_string())?;
    github::fetch_file_content(&token, &owner, &repo, &reference, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_local_get_comments(
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<Vec<ReviewComment>, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .get_comments(&owner, &repo, pr_number)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_local_get_review_metadata(
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<Option<ReviewMetadata>, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .get_review_metadata(&owner, &repo, pr_number)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_local_abandon_review(
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<(), String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .abandon_review(&owner, &repo, pr_number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_local_clear_review(
    owner: String,
    repo: String,
    pr_number: u64,
    pr_title: Option<String>,
) -> Result<(), String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .clear_review(&owner, &repo, pr_number, pr_title.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cmd_submit_local_review(
    app: tauri::AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
    event: Option<String>,
    body: Option<String>,
) -> Result<(), String> {
    use auth::submit_review_with_comments;
    use auth::fetch_pull_request_details;
    
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    
    // Get metadata and comments
    let metadata = storage
        .get_review_metadata(&owner, &repo, pr_number)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No pending review found".to_string())?;
    
    let comments = storage
        .get_comments(&owner, &repo, pr_number)
        .map_err(|e| e.to_string())?;
    
    // Check if PR has been updated since comments were created
    let pr_detail = fetch_pull_request_details(&owner, &repo, pr_number, None)
        .await
        .map_err(|e| e.to_string())?;
    
    let commit_id_to_use = if pr_detail.head_sha != metadata.commit_id {
        tracing::warn!(
            "⚠️  WARNING: PR has been updated since you created these comments!\n   \
            Your comments were created for: {}\n   \
            Current PR head commit:      {}\n   \
            Using CURRENT commit for submission to maximize success rate.",
            metadata.commit_id, pr_detail.head_sha
        );
        &pr_detail.head_sha
    } else {
        &metadata.commit_id
    };
    
    // Submit to GitHub - returns (succeeded_ids, optional_error_message)
    let (succeeded_ids, error_msg) = submit_review_with_comments(
        &app,
        &owner,
        &repo,
        pr_number,
        commit_id_to_use,
        body.as_deref().or(metadata.body.as_deref()),
        event.as_deref(),
        &comments,
    )
    .await
    .map_err(|e| e.to_string())?;
    
    // Delete only successfully posted comments from DB (but they remain in log file)
    for comment_id in succeeded_ids {
        storage
            .delete_comment_preserve_log(comment_id)
            .map_err(|e| e.to_string())?;
    }
    
    // If all comments were posted, mark the review as submitted
    let remaining_comments = storage
        .get_comments(&owner, &repo, pr_number)
        .map_err(|e| e.to_string())?;
    
    if remaining_comments.is_empty() {
        storage
            .mark_review_submitted(&owner, &repo, pr_number, None)
            .await
            .map_err(|e| e.to_string())?;
    }
    
    // Return error if there was a partial or complete failure
    if let Some(err) = error_msg {
        Err(err)
    } else {
        Ok(())
    }
}

#[tauri::command]
async fn cmd_delete_review(
    owner: String,
    repo: String,
    pr_number: u64,
    review_id: u64,
) -> Result<(), String> {
    use auth::require_token_for_delete;
    use github::delete_review;
    
    let token = require_token_for_delete().map_err(|e| e.to_string())?;
    
    delete_review(&token, &owner, &repo, pr_number, review_id)
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn cmd_get_pending_review_comments(
    owner: String,
    repo: String,
    pr_number: u64,
    review_id: u64,
    current_login: Option<String>,
) -> Result<Vec<models::PullRequestComment>, String> {
    use auth::require_token;
    use github::get_pending_review_comments;
    
    let token = require_token().map_err(|e| e.to_string())?;
    
    get_pending_review_comments(
        &token, 
        &owner, 
        &repo, 
        pr_number, 
        review_id,
        current_login.as_deref()
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_prs_under_review() -> Result<Vec<models::PrUnderReview>, String> {
    tracing::info!("cmd_get_prs_under_review called");
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    
    // Get all review metadata from storage
    let all_reviews = storage.get_all_review_metadata().map_err(|e| e.to_string())?;
    tracing::info!("Found {} reviews in storage", all_reviews.len());
    
    let prs_under_review: Vec<models::PrUnderReview> = all_reviews
        .into_iter()
        .map(|metadata| {
            let is_local_folder = metadata.owner == "__local__" && metadata.repo == "local";
            let total_count = if is_local_folder {
                if let Some(local_folder) = metadata.local_folder.as_deref() {
                    let base = resolve_local_directory_path(local_folder);
                    let mut files: Vec<std::path::PathBuf> = Vec::new();
                    match collect_markdown_files(&base, &mut files) {
                        Ok(()) => files.len(),
                        Err(_) => 0,
                    }
                } else {
                    0
                }
            } else {
                0
            };

            models::PrUnderReview {
                owner: metadata.owner.clone(),
                repo: metadata.repo.clone(),
                number: metadata.pr_number,
                title: String::new(), // Will be filled in by frontend
                has_local_review: true,
                has_pending_review: false,
                viewed_count: 0,
                total_count,
                local_folder: metadata.local_folder.clone(),
            }
        })
        .collect();
    
    Ok(prs_under_review)
}

#[tauri::command]
fn cmd_get_storage_info(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {:?}", e))?;
    
    let db_path = data_dir.join("reviews.db");
    let log_dir = data_dir.join("review_logs");
    
    let info = format!(
        "Storage Directory: {:?}\nDatabase: {:?}\nLog Directory: {:?}\nDB Exists: {}\nLog Dir Exists: {}",
        data_dir,
        db_path,
        log_dir,
        db_path.exists(),
        log_dir.exists()
    );
    
    Ok(info)
}

#[tauri::command]
fn cmd_open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {:?}", e))?;
    
    let log_dir = data_dir.join("review_logs");
    
    // Create the directory if it doesn't exist
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create log directory: {:?}", e))?;
    }
    
    // Open the log directory in the system's file explorer
    open::that(&log_dir)
        .map_err(|e| format!("Failed to open log folder: {:?}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn cmd_open_url(url: String) -> Result<(), String> {
    open::that(&url)
        .map_err(|e| format!("Failed to open URL: {:?}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    init_logging();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize review storage
            let data_dir = app.path().app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {:?}", e))?;
            
            tracing::info!("Initializing review storage at {:?}", data_dir);
            
            review_storage::init_storage(&data_dir)
                .map_err(|e| {
                    tracing::error!("Failed to initialize review storage: {:?}", e);
                    format!("Failed to initialize review storage: {:?}", e)
                })?;
            
            tracing::info!("Review storage initialized successfully");
            
            // Set up panic handler to log panics to the log folder
            let log_dir = data_dir.join("review_logs");
            std::panic::set_hook(Box::new(move |panic_info| {
                let payload = panic_info.payload();
                let msg = if let Some(s) = payload.downcast_ref::<&str>() {
                    s
                } else if let Some(s) = payload.downcast_ref::<String>() {
                    s
                } else {
                    "Unknown panic payload"
                };
                
                let location = if let Some(loc) = panic_info.location() {
                    format!("{}:{}:{}", loc.file(), loc.line(), loc.column())
                } else {
                    "unknown location".to_string()
                };
                
                let crash_msg = format!("PANIC occurred at {}: {}", location, msg);
                
                // Log to tracing/stderr
                tracing::error!("{}", crash_msg);
                eprintln!("💥💥💥 {} 💥💥💥", crash_msg);
                
                // Also write to crash log file in the review_logs directory
                let crash_log = log_dir.join("crash.log");
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
                let crash_entry = format!("[{}] {}\n", timestamp, crash_msg);
                
                // Create log directory if it doesn't exist
                let _ = std::fs::create_dir_all(&log_dir);
                
                // Append to crash log
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&crash_log) {
                    use std::io::Write;
                    let _ = file.write_all(crash_entry.as_bytes());
                    let _ = file.write_all(format!("Backtrace: {:?}\n\n", std::backtrace::Backtrace::capture()).as_bytes());
                    eprintln!("💥 Crash log written to: {}", crash_log.display());
                }
            }));
            
            eprintln!("🚀 Application starting - if crash occurs, check crash.log in log folder");

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title("DocReviewer (Preview)");

                    #[cfg(windows)]
                    set_windows_dev_titlebar_color(&window);
                }
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_load_local_directory,
            cmd_start_github_oauth,
            cmd_check_auth_status,
            cmd_logout,
            cmd_list_pull_requests,
            cmd_get_pull_request,
            cmd_get_pull_request_metadata,
            cmd_get_file_contents,
            cmd_submit_review_comment,
            cmd_submit_file_comment,
            cmd_start_pending_review,
            cmd_submit_pending_review,
            cmd_delete_review,
            cmd_get_pending_review_comments,
            cmd_open_devtools,
            cmd_open_log_folder,
            cmd_get_prs_under_review,
            cmd_local_start_review,
            cmd_local_add_comment,
            cmd_local_update_review_commit,
            cmd_local_update_comment_file_path,
            cmd_local_update_comment,
            cmd_local_delete_comment,
            cmd_github_update_comment,
            cmd_github_delete_comment,
            cmd_fetch_file_content,
            cmd_local_get_comments,
            cmd_local_get_review_metadata,
            cmd_local_abandon_review,
            cmd_local_clear_review,
            cmd_submit_local_review,
            cmd_get_storage_info,
            cmd_open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
