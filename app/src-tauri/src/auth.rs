use std::{env, io, time::Duration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::{header::ACCEPT, StatusCode};
use sha2::{Digest, Sha256};
use tokio::{io::AsyncReadExt, io::AsyncWriteExt, net::TcpListener, net::TcpStream, time};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::github::{fetch_authenticated_user, get_pull_request, list_pull_requests};
use crate::models::{AuthStatus, PullRequestDetail, PullRequestSummary};
use crate::storage::{delete_token, read_token, store_token};

const AUTHORIZE_URL: &str = "https://github.com/login/oauth/authorize";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const SCOPES: &str = "repo pull_request:write";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(180);

pub async fn check_auth_status() -> AppResult<AuthStatus> {
    if let Some(token) = read_token()? {
        match fetch_authenticated_user(&token).await {
            Ok(user) => Ok(AuthStatus {
                is_authenticated: true,
                login: Some(user.login),
                avatar_url: user.avatar_url,
            }),
            Err(err) => match err {
                AppError::Http(http_err) => {
                    if http_err.status() == Some(StatusCode::UNAUTHORIZED) {
                        delete_token().ok();
                        Ok(AuthStatus {
                            is_authenticated: false,
                            login: None,
                            avatar_url: None,
                        })
                    } else {
                        Err(AppError::Http(http_err))
                    }
                }
                other => Err(other),
            },
        }
    } else {
        Ok(AuthStatus {
            is_authenticated: false,
            login: None,
            avatar_url: None,
        })
    }
}

pub async fn logout() -> AppResult<()> {
    delete_token()
}

pub async fn start_oauth_flow(_app: &tauri::AppHandle) -> AppResult<AuthStatus> {
    dotenvy::dotenv().ok();
    let client_id = env::var("GITHUB_CLIENT_ID")
        .map_err(|_| AppError::MissingConfig("GITHUB_CLIENT_ID"))?;
    let client_secret = env::var("GITHUB_CLIENT_SECRET")
        .map_err(|_| AppError::MissingConfig("GITHUB_CLIENT_SECRET"))?;

    let code_verifier = random_string(64);
    let code_challenge = compute_challenge(&code_verifier);
    let state = random_string(32);

    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let redirect_port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{redirect_port}/callback");

    let mut url = Url::parse(AUTHORIZE_URL)?;
    url.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", SCOPES)
        .append_pair("state", &state)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256");

    open::that(url.as_str())
        .map_err(|err| AppError::Io(io::Error::new(io::ErrorKind::Other, err)))?;

    let (code, returned_state) = time::timeout(OAUTH_TIMEOUT, wait_for_callback(listener)).await??;
    if returned_state != state {
        return Err(AppError::InvalidOAuthCallback);
    }

    let token = exchange_code(
        &client_id,
        &client_secret,
        &code,
        &redirect_uri,
        &code_verifier,
    )
    .await?;

    store_token(&token)?;
    let user = fetch_authenticated_user(&token).await?;

    Ok(AuthStatus {
        is_authenticated: true,
        login: Some(user.login),
        avatar_url: user.avatar_url,
    })
}

pub async fn list_repo_pull_requests(owner: &str, repo: &str) -> AppResult<Vec<PullRequestSummary>> {
    let token = require_token()?;
    list_pull_requests(&token, owner, repo).await
}

pub async fn fetch_pull_request_details(
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<PullRequestDetail> {
    let token = require_token()?;
    get_pull_request(&token, owner, repo, number).await
}

fn require_token() -> AppResult<String> {
    read_token()?.ok_or(AppError::OAuthCancelled)
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

#[derive(serde::Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    _token_type: Option<String>,
    #[serde(default)]
    _scope: Option<String>,
}

async fn exchange_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> AppResult<String> {
    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_URL)
        .header(ACCEPT, "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }))
        .send()
        .await?
        .error_for_status()?;

    let payload: TokenResponse = response.json().await?;
    Ok(payload.access_token)
}
