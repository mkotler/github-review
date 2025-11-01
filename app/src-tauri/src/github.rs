use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tracing::warn;

use crate::error::{AppError, AppResult};
use crate::models::{
    FileLanguage, PullRequestComment, PullRequestDetail, PullRequestFile, PullRequestSummary,
};

const API_BASE: &str = "https://api.github.com";
const USER_AGENT_VALUE: &str = "github-review-app/0.1";
const SUPPORTED_EXTENSIONS: [&str; 4] = [".md", ".markdown", ".yaml", ".yml"];

struct SsoHeaderInfo {
    organization: Option<String>,
    authorization_url: Option<String>,
}

fn parse_sso_header(header: &HeaderValue) -> Option<SsoHeaderInfo> {
    let value = header.to_str().ok()?;
    let mut organization = None;
    let mut authorization_url = None;

    for part in value.split(';') {
        let trimmed = part.trim();
        if let Some(rest) = trimmed.strip_prefix("organization=") {
            organization = Some(rest.trim_matches(|c| c == '\"').to_string());
        } else if let Some(rest) = trimmed.strip_prefix("url=") {
            authorization_url = Some(rest.trim_matches(|c| c == '\"').to_string());
        }
    }

    if organization.is_some() || authorization_url.is_some() {
        Some(SsoHeaderInfo {
            organization,
            authorization_url,
        })
    } else {
        None
    }
}

async fn ensure_success(
    response: reqwest::Response,
    context: &str,
) -> AppResult<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }

    let headers = response.headers().clone();

    if status == StatusCode::FORBIDDEN {
        if let Some(header) = headers.get("x-github-sso") {
            if let Some(info) = parse_sso_header(header) {
                warn!(
                    context = context,
                    organization = info.organization.as_deref().unwrap_or("unknown"),
                    "GitHub SSO authorization required"
                );

                let mut message = String::from("GitHub SSO authorization required.");
                if let Some(org) = info.organization.as_deref() {
                    message.push_str(&format!(" Authorize access for organization `{org}`."));
                }
                if let Some(url) = info.authorization_url.as_deref() {
                    message.push_str(&format!(" Visit {url} to approve this application."));
                }
                message.push_str(" Then retry loading pull requests.");

                return Err(AppError::SsoAuthorizationRequired(message));
            }
        }
    }

    let body = response.text().await.unwrap_or_default();

    if let Ok(api_error) = serde_json::from_str::<GitHubApiError>(&body) {
        let mut message = api_error
            .message
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| "GitHub API returned an error.".to_string());

        if let Some(url) = api_error
            .documentation_url
            .as_deref()
            .filter(|v| !v.is_empty())
        {
            message.push_str(&format!(" See {url} for details."));
        }

        if let Some(required_scopes) = headers
            .get("x-accepted-oauth-scopes")
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty())
        {
            message.push_str(&format!(" Required scopes: {required_scopes}."));
        }

        if let Some(granted_scopes) = headers
            .get("x-oauth-scopes")
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty())
        {
            message.push_str(&format!(" Current token scopes: {granted_scopes}."));
        }

        warn!(
            context = context,
            status = status.as_u16(),
            error_message = %message,
            "GitHub API request failed"
        );

        return Err(AppError::Api(format!(
            "{context} failed with status {}. {message}",
            status.as_u16()
        )));
    }

    if !body.is_empty() {
        warn!(
            context = context,
            status = status.as_u16(),
            response_body = %body,
            "GitHub API request failed"
        );
        return Err(AppError::Api(format!(
            "{context} failed with status {}. Response: {}",
            status.as_u16(),
            body
        )));
    }

    warn!(
        context = context,
        status = status.as_u16(),
        "GitHub API request failed"
    );
    Err(AppError::Api(format!(
        "{context} failed with status {}.",
        status.as_u16()
    )))
}

fn build_client(token: &str) -> AppResult<reqwest::Client> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token))
            .map_err(|_| AppError::MissingConfig("invalid access token"))?,
    );

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()?;

    Ok(client)
}

pub async fn fetch_authenticated_user(token: &str) -> AppResult<GitHubUser> {
    let client = build_client(token)?;
    let response = client.get(format!("{API_BASE}/user")).send().await?;

    let response = ensure_success(response, "fetch authenticated user").await?;

    Ok(response.json::<GitHubUser>().await?)
}

pub async fn list_pull_requests(
    token: &str,
    owner: &str,
    repo: &str,
) -> AppResult<Vec<PullRequestSummary>> {
    let client = build_client(token)?;
    let pulls = client
        .get(format!("{API_BASE}/repos/{owner}/{repo}/pulls"))
        .query(&[("state", "open"), ("per_page", "30")])
        .send()
        .await?;

    let pulls = ensure_success(pulls, &format!("list pull requests for {owner}/{repo}")).await?;

    let parsed = pulls.json::<Vec<GitHubPullRequest>>().await?;
    Ok(parsed
        .into_iter()
        .map(|pr| PullRequestSummary {
            number: pr.number,
            title: pr.title,
            author: pr.user.login,
            updated_at: pr.updated_at,
            head_ref: pr.head.r#ref,
        })
        .collect())
}

pub async fn get_pull_request(
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    current_login: Option<&str>,
) -> AppResult<PullRequestDetail> {
    let client = build_client(token)?;
    let pr = client
        .get(format!("{API_BASE}/repos/{owner}/{repo}/pulls/{number}"))
        .send()
        .await?;
    let pr = ensure_success(pr, &format!("get pull request {owner}/{repo}#{number}")).await?;
    let pr = pr.json::<GitHubPullRequest>().await?;

    let files_response = client
        .get(format!(
            "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/files"
        ))
        .query(&[("per_page", "100")])
        .send()
        .await?;

    let files_response = ensure_success(
        files_response,
        &format!("list pull request files {owner}/{repo}#{number}"),
    )
    .await?;

    let files = files_response.json::<Vec<GitHubPullRequestFile>>().await?;

    let supported: Vec<_> = files
        .into_iter()
        .filter(|file| is_supported(&file.filename))
        .collect();

    let base_sha = pr.base.sha.clone();
    let head_sha = pr.head.sha.clone();

    let mut collected = Vec::with_capacity(supported.len());

    for file in supported {
        let head_content = if file.status != "removed" {
            Some(fetch_file_contents(&client, owner, repo, &file.filename, &head_sha).await?)
        } else {
            None
        };

        let base_content = if file.status != "added" {
            Some(fetch_file_contents(&client, owner, repo, &file.filename, &base_sha).await?)
        } else {
            None
        };

        let filename = file.filename;
        collected.push(PullRequestFile {
            path: filename.clone(),
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch.clone(),
            head_content,
            base_content,
            language: detect_language(&filename),
        });
    }

    let review_comments = fetch_review_comments(&client, owner, repo, number).await?;
    let issue_comments = fetch_issue_comments(&client, owner, repo, number).await?;

    let my_comments = build_my_comments(current_login, &review_comments, &issue_comments);

    Ok(PullRequestDetail {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        author: pr.user.login,
        head_sha,
        base_sha,
        files: collected,
        my_comments,
    })
}

pub async fn submit_general_comment(
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    body: &str,
) -> AppResult<()> {
    let client = build_client(token)?;
    let response = client
        .post(format!(
            "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews"
        ))
        .json(&json!({
            "body": body,
            "event": "COMMENT",
        }))
        .send()
        .await?;

    ensure_success(
        response,
        &format!("submit general comment for {owner}/{repo}#{number}"),
    )
    .await?;

    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub enum CommentMode {
    Single,
    Review,
}

pub async fn submit_file_comment(
    token: &str,
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
) -> AppResult<()> {
    let client = build_client(token)?;

    if subject_type.is_none() && line.is_none() {
        return Err(AppError::Api(
            "Provide a line number or mark the comment as file-level.".into(),
        ));
    }

    if matches!(mode, CommentMode::Review) && matches!(subject_type, Some("file")) {
        return Err(AppError::Api(
            "GitHub does not allow starting a review with a file-level comment via the REST API. Choose a specific line or post this as a single comment.".into(),
        ));
    }

    let mut comment_fields = Map::new();
    comment_fields.insert("body".into(), Value::String(body.to_string()));
    comment_fields.insert("path".into(), Value::String(path.to_string()));
    comment_fields.insert("commit_id".into(), Value::String(commit_id.to_string()));

    if let Some(subject_type) = subject_type {
        comment_fields.insert(
            "subject_type".into(),
            Value::String(subject_type.to_string()),
        );
    } else if let Some(line) = line {
        comment_fields.insert("line".into(), Value::Number(line.into()));
        comment_fields.insert(
            "side".into(),
            Value::String(side.unwrap_or("RIGHT").to_string()),
        );
    }

    match mode {
        CommentMode::Single => {
            let payload = Value::Object(comment_fields);
            let response = client
                .post(format!(
                    "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/comments"
                ))
                .json(&payload)
                .send()
                .await?;

            ensure_success(
                response,
                &format!("submit single file comment for {owner}/{repo}#{number}"),
            )
            .await?;
        }
        CommentMode::Review => {
            let mut review_payload = Map::new();
            review_payload.insert(
                "commit_id".into(),
                Value::String(commit_id.to_string()),
            );
            review_payload.insert(
                "comments".into(),
                Value::Array(vec![Value::Object(comment_fields)]),
            );

            let response = client
                .post(format!(
                    "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews"
                ))
                .json(&Value::Object(review_payload))
                .send()
                .await?;

            ensure_success(
                response,
                &format!("start review with file comment for {owner}/{repo}#{number}"),
            )
            .await?;
        }
    }

    Ok(())
}
async fn fetch_file_contents(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    path: &str,
    reference: &str,
) -> AppResult<String> {
    let response = client
        .get(format!("{API_BASE}/repos/{owner}/{repo}/contents/{path}"))
        .query(&[("ref", reference)])
        .header(ACCEPT, "application/vnd.github.v3.raw")
        .send()
        .await?;

    let response = ensure_success(
        response,
        &format!("fetch file contents for {owner}/{repo}:{reference}:{path}"),
    )
    .await?;

    Ok(response.text().await?)
}

async fn fetch_review_comments(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Vec<GitHubReviewComment>> {
    let response = client
        .get(format!(
            "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/comments"
        ))
        .query(&[("per_page", "100")])
        .send()
        .await?;

    let response = ensure_success(
        response,
        &format!("list review comments for {owner}/{repo}#{number}"),
    )
    .await?;

    Ok(response.json::<Vec<GitHubReviewComment>>().await?)
}

async fn fetch_issue_comments(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Vec<GitHubIssueComment>> {
    let response = client
        .get(format!(
            "{API_BASE}/repos/{owner}/{repo}/issues/{number}/comments"
        ))
        .query(&[("per_page", "100")])
        .send()
        .await?;

    let response = ensure_success(
        response,
        &format!("list issue comments for {owner}/{repo}#{number}"),
    )
    .await?;

    Ok(response.json::<Vec<GitHubIssueComment>>().await?)
}

fn build_my_comments(
    current_login: Option<&str>,
    review_comments: &[GitHubReviewComment],
    issue_comments: &[GitHubIssueComment],
) -> Vec<PullRequestComment> {
    let login = match current_login {
        Some(login) if !login.is_empty() => login,
        _ => return Vec::new(),
    };

    let mut collected = Vec::new();

    for comment in review_comments {
        if comment.user.login.eq_ignore_ascii_case(login) {
            collected.push(map_review_comment(comment));
        }
    }

    for comment in issue_comments {
        if comment.user.login.eq_ignore_ascii_case(login) {
            collected.push(map_issue_comment(comment));
        }
    }

    collected.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    collected
}

fn map_review_comment(comment: &GitHubReviewComment) -> PullRequestComment {
    PullRequestComment {
        id: comment.id,
        body: comment.body.clone(),
        author: comment.user.login.clone(),
        created_at: comment.created_at.clone(),
        url: comment.html_url.clone(),
        path: Some(comment.path.clone()),
        line: comment.line.or(comment.original_line),
        side: comment.side.clone(),
        is_review_comment: true,
        is_draft: comment
            .state
            .as_deref()
            .map(|state| state.eq_ignore_ascii_case("pending"))
            .unwrap_or(false),
        state: comment.state.clone(),
    }
}

fn map_issue_comment(comment: &GitHubIssueComment) -> PullRequestComment {
    PullRequestComment {
        id: comment.id,
        body: comment.body.clone(),
        author: comment.user.login.clone(),
        created_at: comment.created_at.clone(),
        url: comment.html_url.clone(),
        path: None,
        line: None,
        side: None,
        is_review_comment: false,
        is_draft: false,
        state: None,
    }
}

fn is_supported(filename: &str) -> bool {
    let lower = filename.to_ascii_lowercase();
    SUPPORTED_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

fn detect_language(filename: &str) -> FileLanguage {
    if filename.ends_with(".yml") || filename.ends_with(".yaml") {
        FileLanguage::Yaml
    } else {
        FileLanguage::Markdown
    }
}

#[derive(Debug, Deserialize)]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubPullRequest {
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub updated_at: String,
    pub head: GitRef,
    pub base: GitRef,
    pub user: GitHubUser,
}

#[derive(Debug, Deserialize)]
struct GitRef {
    pub sha: String,
    #[serde(rename = "ref")]
    pub r#ref: String,
}

#[derive(Debug, Deserialize)]
struct GitHubPullRequestFile {
    pub filename: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub patch: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubApiError {
    message: Option<String>,
    documentation_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubReviewComment {
    pub id: u64,
    pub body: String,
    pub path: String,
    pub line: Option<u64>,
    pub original_line: Option<u64>,
    pub side: Option<String>,
    pub user: GitHubUser,
    pub html_url: String,
    pub state: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
struct GitHubIssueComment {
    pub id: u64,
    pub body: String,
    pub user: GitHubUser,
    pub html_url: String,
    pub created_at: String,
}
