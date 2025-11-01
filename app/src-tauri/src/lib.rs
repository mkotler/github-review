mod auth;
mod error;
mod github;
mod models;
mod storage;

use auth::{check_auth_status, fetch_pull_request_details, list_repo_pull_requests, logout, start_oauth_flow};
use models::{AuthStatus, PullRequestDetail, PullRequestSummary};

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
async fn cmd_list_pull_requests(owner: String, repo: String) -> Result<Vec<PullRequestSummary>, String> {
    list_repo_pull_requests(&owner, &repo)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn cmd_get_pull_request(
    owner: String,
    repo: String,
    number: u64,
) -> Result<PullRequestDetail, String> {
    fetch_pull_request_details(&owner, &repo, number)
        .await
        .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            cmd_start_github_oauth,
            cmd_check_auth_status,
            cmd_logout,
            cmd_list_pull_requests,
            cmd_get_pull_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
