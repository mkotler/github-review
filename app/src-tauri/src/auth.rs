use std::{io, sync::OnceLock, time::Duration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::{header::ACCEPT, StatusCode};
use sha2::{Digest, Sha256};
use tokio::{io::AsyncReadExt, io::AsyncWriteExt, net::TcpListener, net::TcpStream, sync::Mutex, time};
use tracing::{info, warn};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::github::{
    create_pending_review, fetch_authenticated_user, get_file_contents, get_pull_request, 
    list_pull_requests_with_login, submit_file_comment, submit_general_comment, 
    submit_pending_review, CommentMode,
};
use crate::github_environment::{
    active_environment, select_environment, ConfiguredGitHubEnvironment, GitHubEnvironment,
};
use crate::models::{AuthStatus, PullRequestDetail, PullRequestReview, PullRequestSummary};
use crate::storage::{
    delete_last_login, delete_token, read_last_login, read_token, store_last_login, store_token,
    StoredToken,
};

const SCOPES: &str = "repo pull_request:write offline_access";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(180);
const TOKEN_REFRESH_BUFFER_SECONDS: i64 = 5 * 60;

fn token_refresh_lock() -> &'static Mutex<()> {
    static TOKEN_REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    TOKEN_REFRESH_LOCK.get_or_init(|| Mutex::new(()))
}

fn requires_refresh_token_migration(
    environment: &GitHubEnvironment,
    token: &StoredToken,
) -> bool {
    if !token.legacy {
        return false;
    }
    Url::parse(&environment.web_base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .is_some_and(|host| host == "github.com" || host.ends_with(".ghe.com"))
}

fn auth_status(
    environment: &GitHubEnvironment,
    is_authenticated: bool,
    login: Option<String>,
    avatar_url: Option<String>,
    is_offline: bool,
) -> AuthStatus {
    AuthStatus {
        is_authenticated,
        login,
        avatar_url,
        is_offline,
        environment_id: environment.id.clone(),
        environment_name: environment.name.clone(),
        web_base_url: environment.web_base_url.clone(),
    }
}

/// Helper function to detect network-related errors
fn is_network_error(err: &AppError) -> bool {
    match err {
        AppError::Http(e) => {
            // Check for connection errors, timeouts, DNS failures, etc.
            // is_connect: connection refused, connection reset
            // is_timeout: request timeout
            // is_builder: URL/request construction errors (shouldn't happen but include for safety)
            // Check if there's no status code (connection never established)
            e.is_timeout() || e.is_connect() || e.is_builder() || e.status().is_none()
        }
        AppError::Timeout => true,
        _ => false,
    }
}

pub async fn check_auth_status() -> AppResult<AuthStatus> {
    tracing::info!("checking auth status");
    let configured = select_environment(None)?;
    let environment = &configured.environment;
    if read_token(&environment.id)?.is_some() {
        let token = match require_token().await {
            Ok(token) => token,
            Err(AppError::Unauthorized) => {
                delete_token(&environment.id).ok();
                delete_last_login(&environment.id).ok();
                tracing::info!("auth status resolved after token refresh failed");
                return Ok(auth_status(environment, false, None, None, false));
            }
            Err(error) if is_network_error(&error) => {
                if let Some(last_login) = read_last_login(&environment.id).ok().flatten() {
                    tracing::info!("network error during token refresh, using cached login for offline mode");
                    return Ok(auth_status(environment, true, Some(last_login), None, true));
                }
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        match fetch_authenticated_user(&token).await {
            Ok(user) => {
                // Store login for offline use
                store_last_login(&environment.id, &user.login).ok();
                
                Ok(auth_status(
                    environment,
                    true,
                    Some(user.login),
                    user.avatar_url,
                    false,
                ))
                .map(|status| {
                    tracing::info!(user = status.login.as_deref().unwrap_or("unknown"), "auth status resolved");
                    status
                })
            }
            Err(err) => match err {
                AppError::Unauthorized => {
                    delete_token(&environment.id).ok();
                    delete_last_login(&environment.id).ok();
                    tracing::info!("auth status resolved after unauthorized");
                    Ok(auth_status(environment, false, None, None, false))
                }
                AppError::Http(http_err) => {
                    if http_err.status() == Some(StatusCode::UNAUTHORIZED) {
                        // Token explicitly rejected - clear credentials
                        delete_token(&environment.id).ok();
                        delete_last_login(&environment.id).ok();
                        Ok(auth_status(environment, false, None, None, false))
                        .map(|status| {
                            tracing::info!("auth status resolved after unauthorized");
                            status
                        })
                    } else if let Some(last_login) = read_last_login(&environment.id).ok().flatten() {
                        // Network error but we have cached login - assume offline mode
                        tracing::info!("http error during auth check (status: {:?}), using cached login for offline mode", http_err.status());
                        Ok(auth_status(environment, true, Some(last_login), None, true))
                    } else {
                        // Network error and no cached login - propagate error
                        tracing::warn!("http error during auth check with no cached login");
                        Err(AppError::Http(http_err))
                    }
                }
                // Network error - treat as offline but still authenticated
                other if is_network_error(&other) => {
                    tracing::info!("network error during auth check, assuming offline mode");
                    let last_login = read_last_login(&environment.id).ok().flatten();
                    Ok(auth_status(environment, true, last_login, None, true))
                    .map(|status| {
                        tracing::info!(
                            user = status.login.as_deref().unwrap_or("unknown"),
                            "auth status resolved in offline mode"
                        );
                        status
                    })
                }
                other => {
                    // Other errors - if we have cached login, use it; otherwise propagate
                    if let Some(last_login) = read_last_login(&environment.id).ok().flatten() {
                        tracing::info!("error during auth check, using cached login for offline mode");
                        Ok(auth_status(environment, true, Some(last_login), None, true))
                    } else {
                        tracing::warn!("error during auth check with no cached login");
                        Err(other)
                    }
                }
            },
        }
    } else {
        Ok(auth_status(environment, false, None, None, false))
        .map(|status| {
            tracing::info!("auth status resolved without token");
            status
        })
    }
}

pub async fn logout() -> AppResult<()> {
    let environment = active_environment();
    delete_token(&environment.id)?;
    delete_last_login(&environment.id).ok(); // Best effort - don't fail logout if this fails
    Ok(())
}

pub async fn start_oauth_flow(
    _app: &tauri::AppHandle,
    environment_id: &str,
) -> AppResult<AuthStatus> {
    let configured = select_environment(Some(environment_id))?;
    let environment = &configured.environment;

    let code_verifier = random_string(64);
    let code_challenge = compute_challenge(&code_verifier);
    let state = random_string(32);

    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let redirect_port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{redirect_port}/callback");

    let mut url = Url::parse(&configured.authorize_url)?;
    url.query_pairs_mut()
        .append_pair("client_id", &configured.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", SCOPES)
        .append_pair("state", &state)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256");

    open::that(url.as_str())
        .map_err(|err| AppError::Io(io::Error::new(io::ErrorKind::Other, err)))?;

    let (code, returned_state) =
        time::timeout(OAUTH_TIMEOUT, wait_for_callback(listener)).await??;
    if returned_state != state {
        return Err(AppError::InvalidOAuthCallback);
    }

    let token = exchange_code(
        &configured,
        &code,
        &redirect_uri,
        &code_verifier,
    )
    .await?;

    store_token(&environment.id, &token)?;
    let user = fetch_authenticated_user(&token.access_token).await?;
    
    // Store login for offline use
    store_last_login(&environment.id, &user.login).ok();

    Ok(auth_status(
        environment,
        true,
        Some(user.login),
        user.avatar_url,
        false,
    ))
}

pub async fn list_repo_pull_requests(
    owner: &str,
    repo: &str,
    state: Option<&str>,
    current_login: Option<&str>,
) -> AppResult<Vec<PullRequestSummary>> {
    let token = require_token().await?;
    let pulls = list_pull_requests_with_login(&token, owner, repo, state, current_login).await?;

    info!(owner, repo, count = pulls.len(), "fetched pull requests");
    for pr in &pulls {
        info!(
            owner,
            repo,
            number = pr.number,
            title = %pr.title,
            author = %pr.author,
            head = %pr.head_ref,
            has_pending_review = pr.has_pending_review,
            "pull request summary"
        );
    }

    Ok(pulls)
}

pub async fn fetch_pull_request_details(
    owner: &str,
    repo: &str,
    number: u64,
    current_login: Option<&str>,
) -> AppResult<PullRequestDetail> {
    let token = require_token().await?;
    get_pull_request(&token, owner, repo, number, current_login).await
}

pub async fn fetch_pull_request_metadata(
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<crate::models::PullRequestMetadata> {
    let token = require_token().await?;
    crate::github::get_pull_request_metadata(&token, owner, repo, number).await
}

pub async fn fetch_file_contents_on_demand(
    owner: &str,
    repo: &str,
    file_path: &str,
    base_sha: &str,
    head_sha: &str,
    status: &str,
    previous_filename: Option<&str>,
) -> AppResult<(Option<String>, Option<String>)> {
    let token = require_token().await?;
    get_file_contents(&token, owner, repo, file_path, base_sha, head_sha, status, previous_filename).await
}

pub async fn publish_review_comment(
    owner: &str,
    repo: &str,
    number: u64,
    body: String,
) -> AppResult<()> {
    let token = require_token().await?;
    submit_general_comment(&token, owner, repo, number, &body).await
}

pub async fn publish_file_comment(
    owner: &str,
    repo: &str,
    number: u64,
    path: &str,
    body: &str,
    commit_id: &str,
    line: Option<u64>,
    side: Option<&str>,
    subject_type: Option<&str>,
    mode: CommentMode,
    pending_review_id: Option<u64>,
    in_reply_to: Option<u64>,
) -> AppResult<()> {
    let token = require_token().await?;
    submit_file_comment(
        &token,
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
    )
    .await
}

pub async fn start_pending_review(
    owner: &str,
    repo: &str,
    number: u64,
    commit_id: Option<&str>,
    body: Option<&str>,
    current_login: Option<&str>,
) -> AppResult<PullRequestReview> {
    let token = require_token().await?;
    create_pending_review(
        &token,
        owner,
        repo,
        number,
        commit_id,
        body,
        current_login,
    )
    .await
}

pub async fn finalize_pending_review(
    owner: &str,
    repo: &str,
    number: u64,
    review_id: u64,
    event: &str,
    body: Option<&str>,
) -> AppResult<()> {
    let token = require_token().await?;
    submit_pending_review(&token, owner, repo, number, review_id, event, body).await
}

pub async fn submit_review_with_comments(
    app: &tauri::AppHandle,
    owner: &str,
    repo: &str,
    number: u64,
    commit_id: &str,
    body: Option<&str>,
    event: Option<&str>,
    comments: &[crate::review_storage::ReviewComment],
) -> AppResult<(Vec<i64>, Option<String>)> {
    use crate::github::create_review_with_comments;
    
    let token = require_token().await?;
    create_review_with_comments(
        app,
        &token,
        owner,
        repo,
        number,
        commit_id,
        body,
        event,
        comments,
    )
    .await
}

pub async fn require_token() -> AppResult<String> {
    let environment = active_environment();
    let token = read_token(&environment.id)?.ok_or(AppError::OAuthCancelled)?;
    if requires_refresh_token_migration(&environment, &token) {
        delete_token(&environment.id).ok();
        delete_last_login(&environment.id).ok();
        return Err(AppError::Unauthorized);
    }
    if !should_refresh_token(&token, chrono::Utc::now().timestamp()) {
        return Ok(token.access_token);
    }

    let _refresh_guard = token_refresh_lock().lock().await;
    let token = read_token(&environment.id)?.ok_or(AppError::OAuthCancelled)?;
    let now = chrono::Utc::now().timestamp();
    if !should_refresh_token(&token, now) {
        return Ok(token.access_token);
    }

    if token
        .refresh_token_expires_at
        .is_some_and(|expires_at| expires_at <= now)
    {
        delete_token(&environment.id).ok();
        delete_last_login(&environment.id).ok();
        return Err(AppError::Unauthorized);
    }

    if token.refresh_token.is_none() {
        delete_token(&environment.id).ok();
        delete_last_login(&environment.id).ok();
        return Err(AppError::Unauthorized);
    }
    let configured = select_environment(Some(&environment.id))?;
    let refreshed_token = match refresh_access_token(&configured, &token).await {
        Ok(refreshed_token) => refreshed_token,
        Err(AppError::Unauthorized) => {
            delete_token(&environment.id).ok();
            delete_last_login(&environment.id).ok();
            return Err(AppError::Unauthorized);
        }
        Err(error)
            if token
                .access_token_expires_at
                .is_some_and(|expires_at| expires_at > now) =>
        {
            warn!(
                environment_id = environment.id,
                error = %error,
                "GitHub token refresh failed before access token expiration; using current token"
            );
            return Ok(token.access_token);
        }
        Err(error) => return Err(error),
    };
    store_token(&environment.id, &refreshed_token)?;
    info!(
        environment_id = environment.id,
        "refreshed GitHub access token"
    );
    Ok(refreshed_token.access_token)
}

pub async fn require_token_for_delete() -> AppResult<String> {
    require_token().await
}

fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn compute_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

async fn wait_for_callback(listener: TcpListener) -> AppResult<(String, String)> {
    let (mut stream, _) = listener.accept().await?;
    let mut buffer = Vec::with_capacity(1024);
    read_http_request(&mut stream, &mut buffer).await?;

    let request = String::from_utf8_lossy(&buffer);
    let request_line = request.lines().next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let _method = parts.next();
    let path = parts.next().ok_or(AppError::InvalidOAuthCallback)?;

    let url = Url::parse(&format!("http://localhost{path}"))?;
    let mut code = None;
    let mut state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            _ => {}
        }
    }

    let html = "<html><body><script>window.close();</script><p>You may return to the app.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(), html
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await?;

    match (code, state) {
        (Some(code), Some(state)) => Ok((code, state)),
        _ => Err(AppError::InvalidOAuthCallback),
    }
}

async fn read_http_request(stream: &mut TcpStream, buffer: &mut Vec<u8>) -> AppResult<()> {
    let mut chunk = [0u8; 1024];
    loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > 16 * 1024 {
            break;
        }
    }
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    refresh_token_expires_in: Option<i64>,
    #[serde(default)]
    _token_type: Option<String>,
    #[serde(default)]
    _scope: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

impl TokenResponse {
    fn into_stored_token(self, now: i64) -> AppResult<StoredToken> {
        let access_token = self.access_token.ok_or_else(|| {
            if self.error.as_deref() == Some("bad_refresh_token") {
                AppError::Unauthorized
            } else {
                AppError::Api(
                    self.error_description
                        .or(self.error)
                        .unwrap_or_else(|| "GitHub OAuth response did not include an access token.".to_string()),
                )
            }
        })?;

        Ok(StoredToken {
            access_token,
            legacy: false,
            refresh_token: self.refresh_token,
            access_token_expires_at: self
                .expires_in
                .and_then(|seconds| now.checked_add(seconds)),
            refresh_token_expires_at: self
                .refresh_token_expires_in
                .and_then(|seconds| now.checked_add(seconds)),
        })
    }
}

fn should_refresh_token(token: &StoredToken, now: i64) -> bool {
    token
        .access_token_expires_at
        .is_some_and(|expires_at| expires_at <= now + TOKEN_REFRESH_BUFFER_SECONDS)
}

fn preserve_refresh_metadata(
    mut refreshed_token: StoredToken,
    current_token: &StoredToken,
) -> StoredToken {
    if refreshed_token.refresh_token.is_none() {
        refreshed_token.refresh_token = current_token.refresh_token.clone();
    }
    if refreshed_token.refresh_token_expires_at.is_none() {
        refreshed_token.refresh_token_expires_at = current_token.refresh_token_expires_at;
    }
    refreshed_token
}

async fn exchange_code(
    configured: &ConfiguredGitHubEnvironment,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> AppResult<StoredToken> {
    let client = reqwest::Client::new();
    let response = client
        .post(&configured.token_url)
        .header(ACCEPT, "application/json")
        .json(&serde_json::json!({
            "client_id": configured.client_id,
            "client_secret": configured.client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }))
        .send()
        .await?
        .error_for_status()?;

    let payload: TokenResponse = response.json().await?;
    payload.into_stored_token(chrono::Utc::now().timestamp())
}

async fn refresh_access_token(
    configured: &ConfiguredGitHubEnvironment,
    current_token: &StoredToken,
) -> AppResult<StoredToken> {
    let refresh_token = current_token
        .refresh_token
        .as_deref()
        .ok_or(AppError::Unauthorized)?;
    let response = reqwest::Client::new()
        .post(&configured.token_url)
        .header(ACCEPT, "application/json")
        .json(&serde_json::json!({
            "client_id": configured.client_id,
            "client_secret": configured.client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .await?;

    let status = response.status();
    let payload: TokenResponse = response.json().await?;
    if !status.is_success() {
        if payload.error.as_deref() == Some("bad_refresh_token") {
            return Err(AppError::Unauthorized);
        }
        return Err(AppError::Api(
            payload
                .error_description
                .or(payload.error)
                .unwrap_or_else(|| format!("GitHub token refresh failed with status {status}.")),
        ));
    }

    Ok(preserve_refresh_metadata(
        payload.into_stored_token(chrono::Utc::now().timestamp())?,
        current_token,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_response_preserves_refresh_metadata() {
        let token = TokenResponse {
            access_token: Some("gho_access".to_string()),
            expires_in: Some(28_800),
            refresh_token: Some("ghr_refresh".to_string()),
            refresh_token_expires_in: Some(15_897_600),
            _token_type: Some("bearer".to_string()),
            _scope: Some("repo".to_string()),
            error: None,
            error_description: None,
        }
        .into_stored_token(1_000)
        .unwrap();

        assert_eq!(token.access_token, "gho_access");
        assert_eq!(token.refresh_token.as_deref(), Some("ghr_refresh"));
        assert_eq!(token.access_token_expires_at, Some(29_800));
        assert_eq!(token.refresh_token_expires_at, Some(15_898_600));
    }

    #[test]
    fn token_refresh_starts_before_expiration() {
        let token = StoredToken {
            access_token: "gho_access".to_string(),
            legacy: false,
            refresh_token: Some("ghr_refresh".to_string()),
            access_token_expires_at: Some(1_300),
            refresh_token_expires_at: Some(10_000),
        };

        assert!(should_refresh_token(&token, 1_000));
        assert!(!should_refresh_token(&token, 999));
    }

    #[test]
    fn bad_refresh_token_requires_sign_in() {
        let error = TokenResponse {
            access_token: None,
            expires_in: None,
            refresh_token: None,
            refresh_token_expires_in: None,
            _token_type: None,
            _scope: None,
            error: Some("bad_refresh_token".to_string()),
            error_description: Some("The refresh token is invalid.".to_string()),
        }
        .into_stored_token(1_000)
        .unwrap_err();

        assert!(matches!(error, AppError::Unauthorized));
    }

    #[test]
    fn refresh_response_can_reuse_existing_refresh_token() {
        let current = StoredToken {
            access_token: "gho_old".to_string(),
            legacy: false,
            refresh_token: Some("ghr_existing".to_string()),
            access_token_expires_at: Some(1_000),
            refresh_token_expires_at: Some(10_000),
        };
        let refreshed = StoredToken {
            access_token: "gho_new".to_string(),
            legacy: false,
            refresh_token: None,
            access_token_expires_at: Some(2_000),
            refresh_token_expires_at: None,
        };

        let preserved = preserve_refresh_metadata(refreshed, &current);

        assert_eq!(preserved.refresh_token.as_deref(), Some("ghr_existing"));
        assert_eq!(preserved.refresh_token_expires_at, Some(10_000));
    }

    #[test]
    fn legacy_cloud_token_requires_migration() {
        let environment = GitHubEnvironment {
            id: "msft.ghe.com".to_string(),
            name: "Microsoft GitHub".to_string(),
            web_base_url: "https://msft.ghe.com".to_string(),
            api_base_url: "https://api.msft.ghe.com".to_string(),
        };

        assert!(requires_refresh_token_migration(
            &environment,
            &StoredToken::legacy("gho_legacy".to_string()),
        ));
    }
}
