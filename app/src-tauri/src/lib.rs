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
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[tauri::command]
async fn cmd_start_github_oauth(app: tauri::AppHandle) -> Result<AuthStatus, String> {
    start_oauth_flow(&app).await.map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_check_auth_status() -> Result<AuthStatus, String> {
    check_auth_status().await.map_err(|err| err.to_string())
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
    list_repo_pull_requests(&owner, &repo, state.as_deref(), current_login.as_deref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_get_pull_request(
    owner: String,
    repo: String,
    number: u64,
    current_login: Option<String>,
) -> Result<PullRequestDetail, String> {
    fetch_pull_request_details(&owner, &repo, number, current_login.as_deref())
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
) -> Result<ReviewMetadata, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    storage
        .start_review(&owner, &repo, pr_number, &commit_id, body.as_deref())
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
) -> Result<ReviewComment, String> {
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
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
        )
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
    owner: String,
    repo: String,
    pr_number: u64,
    event: Option<String>,
    body: Option<String>,
) -> Result<(), String> {
    use auth::submit_review_with_comments;
    
    let storage = review_storage::get_storage().map_err(|e| e.to_string())?;
    
    // Get metadata and comments
    let metadata = storage
        .get_review_metadata(&owner, &repo, pr_number)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No pending review found".to_string())?;
    
    let comments = storage
        .get_comments(&owner, &repo, pr_number)
        .map_err(|e| e.to_string())?;
    
    // Submit to GitHub
    let succeeded_ids = submit_review_with_comments(
        &owner,
        &repo,
        pr_number,
        &metadata.commit_id,
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
    
    Ok(())
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
        .map(|metadata| models::PrUnderReview {
            owner: metadata.owner.clone(),
            repo: metadata.repo.clone(),
            number: metadata.pr_number,
            title: String::new(), // Will be filled in by frontend
            has_local_review: true,
            has_pending_review: false,
            viewed_count: 0,
            total_count: 0,
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
    tracing::info!("logging initialised");

    tauri::Builder::default()
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_start_github_oauth,
            cmd_check_auth_status,
            cmd_logout,
            cmd_list_pull_requests,
            cmd_get_pull_request,
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
