mod auth;
mod error;
mod github;
mod models;
mod storage;

use crate::github::CommentMode;
use auth::{
    check_auth_status, fetch_pull_request_details, list_repo_pull_requests, logout,
    publish_file_comment, publish_review_comment, start_oauth_flow,
};
use models::{AuthStatus, PullRequestDetail, PullRequestSummary};
use serde::Deserialize;

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
) -> Result<Vec<PullRequestSummary>, String> {
    list_repo_pull_requests(&owner, &repo)
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
    )
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn cmd_open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    open_devtools_impl(window)
}

#[tauri::command]
fn cmd_log_frontend(message: String) {
    tracing::info!(target: "frontend", "{message}");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    init_logging();
    tracing::info!("logging initialised");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            cmd_start_github_oauth,
            cmd_check_auth_status,
            cmd_logout,
            cmd_list_pull_requests,
            cmd_get_pull_request,
            cmd_submit_review_comment,
            cmd_submit_file_comment,
            cmd_open_devtools,
            cmd_log_frontend
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
