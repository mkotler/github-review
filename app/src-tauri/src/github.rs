use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::Emitter;
use tracing::warn;

use crate::error::{AppError, AppResult};
use crate::models::{
    FileLanguage, PullRequestComment, PullRequestDetail, PullRequestFile, PullRequestReview,
    PullRequestSummary,
};

const API_BASE: &str = "https://api.github.com";
const USER_AGENT_VALUE: &str = "github-review-app/0.1";
const API_VERSION_HEADER: &str = "x-github-api-version";
const API_VERSION_VALUE: &str = "2022-11-28";

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

    // Log the raw error response for debugging
    warn!(
        context = context,
        status = status.as_u16(),
        response_body = body.as_str(),
        "GitHub API error response"
    );

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
    headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.github+json"));
    headers.insert(
        HeaderName::from_static(API_VERSION_HEADER),
        HeaderValue::from_static(API_VERSION_VALUE),
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

pub async fn list_pull_requests_with_login(
    token: &str,
    owner: &str,
    repo: &str,
    state: Option<&str>,
    current_login: Option<&str>,
) -> AppResult<Vec<PullRequestSummary>> {
    let client = build_client(token)?;
    let state_value = state.unwrap_or("open");
    let mut all_pulls = Vec::new();
    let mut page = 1;
    let per_page = 100;

    loop {
        let pulls = client
            .get(format!("{API_BASE}/repos/{owner}/{repo}/pulls"))
            .query(&[
                ("state", state_value),
                ("per_page", &per_page.to_string()),
                ("page", &page.to_string()),
            ])
            .send()
            .await?;

        let pulls = ensure_success(pulls, &format!("list pull requests for {owner}/{repo}")).await?;
        let parsed = pulls.json::<Vec<GitHubPullRequest>>().await?;
        
        let page_count = parsed.len();
        
        // For each PR, check if there's a pending review if current_login is provided
        for pr in parsed {
            let (has_pending_review, file_count) = if let Some(login) = current_login {
                check_has_pending_review(&client, owner, repo, pr.number, login).await.unwrap_or((false, 0))
            } else {
                (false, 0)
            };
            
            all_pulls.push(PullRequestSummary {
                number: pr.number,
                title: pr.title,
                author: pr.user.login,
                updated_at: pr.updated_at,
                head_ref: pr.head.r#ref,
                has_pending_review,
                file_count,
                state: pr.state.clone(),
                merged: pr.merged_at.is_some(),
            });
        }

        // Stop if we got less than per_page results (last page)
        if page_count < per_page {
            break;
        }

        page += 1;
    }

    Ok(all_pulls)
}

async fn check_has_pending_review(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    number: u64,
    current_login: &str,
) -> AppResult<(bool, usize)> {
    let reviews = fetch_pull_request_reviews(client, owner, repo, number).await?;
    let normalized_login = current_login.to_ascii_lowercase();
    
    let has_pending = reviews.iter().any(|review| {
        review.user.login.eq_ignore_ascii_case(&normalized_login) && 
        review.state.eq_ignore_ascii_case("pending")
    });
    
    // If there's a pending review, also fetch file count
    let file_count = if has_pending {
        let files_response = client
            .get(format!("{API_BASE}/repos/{owner}/{repo}/pulls/{number}/files"))
            .query(&[("per_page", "1")]) // We only need the count, not the actual files
            .send()
            .await?;
        
        if let Ok(_response) = ensure_success(files_response, "count pull request files").await {
            // GitHub returns the total count in the Link header, but for simplicity we can fetch all
            // Actually, let's fetch with per_page=100 to get most in one call
            let files_response = client
                .get(format!("{API_BASE}/repos/{owner}/{repo}/pulls/{number}/files"))
                .query(&[("per_page", "100")])
                .send()
                .await?;
            
            if let Ok(response) = ensure_success(files_response, "list pull request files").await {
                if let Ok(files) = response.json::<Vec<serde_json::Value>>().await {
                    files.len()
                } else {
                    0
                }
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    };
    
    Ok((has_pending, file_count))
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

    // Fetch all files with pagination
    let mut all_files = Vec::new();
    let mut page = 1;
    
    loop {
        let files_response = client
            .get(format!(
                "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/files"
            ))
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await?;

        let files_response = ensure_success(
            files_response,
            &format!("list pull request files {owner}/{repo}#{number} (page {})", page),
        )
        .await?;

        let files = files_response.json::<Vec<GitHubPullRequestFile>>().await?;
        let count = files.len();
        all_files.extend(files);
        
        // If we got less than 100, we've reached the last page
        if count < 100 {
            break;
        }
        
        page += 1;
    }

    // Return all files (frontend will filter if needed)
    let non_removed: Vec<_> = all_files
        .into_iter()
        .filter(|file| file.status != "removed")
        .collect();

    let base_sha = pr.base.sha.clone();
    let head_sha = pr.head.sha.clone();

    let mut collected = Vec::with_capacity(non_removed.len());

    for file in non_removed {
        let filename = file.filename;
        collected.push(PullRequestFile {
            path: filename.clone(),
            status: file.status.clone(),
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch.clone(),
            head_content: None,  // Will be loaded on demand
            base_content: None,  // Will be loaded on demand
            language: detect_language(&filename),
            previous_filename: file.previous_filename,
        });
    }

    let review_comments = fetch_review_comments(&client, owner, repo, number).await?;
    let issue_comments = fetch_issue_comments(&client, owner, repo, number).await?;
    let reviews = fetch_pull_request_reviews(&client, owner, repo, number).await?;

    let comments = build_comments(current_login, &review_comments, &issue_comments);
    let mapped_reviews = build_reviews(current_login, &reviews);
    let my_comments = comments
        .iter()
        .cloned()
        .filter(|comment| comment.is_mine)
        .collect();

    Ok(PullRequestDetail {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        author: pr.user.login,
        head_sha,
        base_sha,
        files: collected,
        comments,
        my_comments,
        reviews: mapped_reviews,
    })
}

pub async fn get_file_contents(
    token: &str,
    owner: &str,
    repo: &str,
    file_path: &str,
    base_sha: &str,
    head_sha: &str,
    status: &str,
    previous_filename: Option<&str>,
) -> AppResult<(Option<String>, Option<String>)> {
    let client = build_client(token)?;
    
    let head_content = if status != "removed" {
        Some(fetch_file_contents(&client, owner, repo, file_path, head_sha).await?)
    } else {
        None
    };

    let base_content = if status != "added" {
        // For renamed files, use the previous filename to fetch base content
        let base_path = if status == "renamed" && previous_filename.is_some() {
            previous_filename.unwrap()
        } else {
            file_path
        };
        Some(fetch_file_contents(&client, owner, repo, base_path, base_sha).await?)
    } else {
        None
    };

    Ok((head_content, base_content))
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

pub async fn create_pending_review(
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    commit_id: Option<&str>,
    _body: Option<&str>,
    _current_login: Option<&str>,
) -> AppResult<PullRequestReview> {
    let client = build_client(token)?;
    
    // Fetch the authenticated user to check review ownership
    let user = fetch_authenticated_user(token).await?;
    let normalized_login = user.login.to_ascii_lowercase();

    // First check if there's already a pending review - you can only have one at a time
    let existing_reviews = fetch_pull_request_reviews(&client, owner, repo, number).await?;
    for review in existing_reviews {
        let mapped = map_review(&review, Some(&normalized_login));
        if mapped.is_mine && mapped.state.eq_ignore_ascii_case("pending") {
            // Reuse existing pending review
            return Ok(mapped);
        }
    }

    // No existing pending review, create a new one
    // Include commit_id if provided, otherwise GitHub uses the latest commit
    let mut payload = Map::new();
    if let Some(commit_id) = commit_id {
        payload.insert("commit_id".into(), Value::String(commit_id.to_string()));
    }

    let response = client
        .post(format!(
            "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews"
        ))
        .json(&Value::Object(payload))
        .send()
        .await?;

    let response = ensure_success(
        response,
        &format!("create pending review for {owner}/{repo}#{number}"),
    )
    .await?;

    let review = response.json::<GitHubPullRequestReview>().await?;
    Ok(map_review(&review, Some(&normalized_login)))
}

pub async fn submit_pending_review(
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    review_id: u64,
    event: &str,
    body: Option<&str>,
) -> AppResult<()> {
    let client = build_client(token)?;
    let mut payload = Map::new();
    payload.insert("event".into(), Value::String(event.to_string()));

    if let Some(body) = body {
        if !body.trim().is_empty() {
            payload.insert("body".into(), Value::String(body.to_string()));
        }
    }

    let response = client
        .post(format!(
            "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/events"
        ))
        .json(&Value::Object(payload))
        .send()
        .await?;

    ensure_success(
        response,
        &format!("submit review {review_id} for {owner}/{repo}#{number}"),
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
    pending_review_id: Option<u64>,
    in_reply_to: Option<u64>,
) -> AppResult<()> {
    let client = build_client(token)?;

    // If no line number provided, treat as file-level comment
    let effective_subject_type = if subject_type.is_none() && line.is_none() {
        Some("file")
    } else {
        subject_type
    };

    if matches!(mode, CommentMode::Review) && matches!(effective_subject_type, Some("file")) {
        return Err(AppError::Api(
            "GitHub does not allow starting a review with a file-level comment via the REST API. Choose a specific line or post this as a single comment.".into(),
        ));
    }

    let mut single_comment_fields = Map::new();
    single_comment_fields.insert("body".into(), Value::String(body.to_string()));
    single_comment_fields.insert("path".into(), Value::String(path.to_string()));
    single_comment_fields.insert("commit_id".into(), Value::String(commit_id.to_string()));

    if let Some(subject_type) = effective_subject_type {
        single_comment_fields.insert(
            "subject_type".into(),
            Value::String(subject_type.to_string()),
        );
    } else if let Some(line_number) = line {
        single_comment_fields.insert("line".into(), Value::Number(line_number.into()));
        single_comment_fields.insert(
            "side".into(),
            Value::String(side.unwrap_or("RIGHT").to_string()),
        );
    }

    // Add in_reply_to if provided
    if let Some(reply_to_id) = in_reply_to {
        single_comment_fields.insert("in_reply_to".into(), Value::Number(reply_to_id.into()));
    }

    match mode {
        CommentMode::Single => {
            let payload = Value::Object(single_comment_fields);
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
            let line_number = line.ok_or_else(|| {
                AppError::Api(
                    "Select a specific line before starting a review comment.".into(),
                )
            })?;

            let comment_side = side.unwrap_or("RIGHT");
            let mut review_comment_fields = Map::new();
            review_comment_fields.insert("body".into(), Value::String(body.to_string()));
            review_comment_fields.insert("path".into(), Value::String(path.to_string()));
            review_comment_fields.insert(
                "line".into(),
                Value::Number(serde_json::Number::from(line_number)),
            );
            review_comment_fields.insert(
                "side".into(),
                Value::String(comment_side.to_string()),
            );
            review_comment_fields.insert(
                "commit_id".into(),
                Value::String(commit_id.to_string()),
            );

            // Add in_reply_to if provided
            if let Some(reply_to_id) = in_reply_to {
                review_comment_fields.insert("in_reply_to".into(), Value::Number(reply_to_id.into()));
            }

            // If we don't have a pending_review_id, the user must call "Start review" first
            let review_id = pending_review_id.ok_or_else(|| {
                AppError::Api(
                    "No pending review found. Please start a review first by clicking 'Start review'.".into(),
                )
            })?;

            // Add comment directly to the pending review using the review comments endpoint
            let response = client
                .post(format!(
                    "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/comments"
                ))
                .json(&Value::Object(review_comment_fields))
                .send()
                .await?;

            ensure_success(
                response,
                &format!(
                    "attach file comment to pending review for {owner}/{repo}#{number}"
                ),
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
    // Check if this is an image file
    let is_image = path.to_ascii_lowercase().ends_with(".png") 
        || path.to_ascii_lowercase().ends_with(".jpg")
        || path.to_ascii_lowercase().ends_with(".jpeg")
        || path.to_ascii_lowercase().ends_with(".gif")
        || path.to_ascii_lowercase().ends_with(".svg")
        || path.to_ascii_lowercase().ends_with(".webp")
        || path.to_ascii_lowercase().ends_with(".bmp")
        || path.to_ascii_lowercase().ends_with(".ico");
    
    if is_image {
        // For images, get the JSON response with base64 content
        let response = client
            .get(format!("{API_BASE}/repos/{owner}/{repo}/contents/{path}"))
            .query(&[("ref", reference)])
            .send()
            .await?;

        let response = ensure_success(
            response,
            &format!("fetch file contents for {owner}/{repo}:{reference}:{path}"),
        )
        .await?;

        let content_json: Value = response.json().await?;
        
        // GitHub returns content as base64 in the "content" field
        if let Some(content) = content_json.get("content").and_then(|c| c.as_str()) {
            // Remove whitespace/newlines that GitHub adds to the base64 string
            let cleaned: String = content.chars().filter(|c| !c.is_whitespace()).collect();
            Ok(cleaned)
        } else {
            Err(AppError::Api("Image content not found in response".to_string()))
        }
    } else {
        // For text files, get raw content
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
}

async fn fetch_review_comments(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Vec<GitHubReviewComment>> {
    let mut all_comments = Vec::new();
    let mut page = 1;
    
    loop {
        let response = client
            .get(format!(
                "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/comments"
            ))
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await?;

        let response = ensure_success(
            response,
            &format!("list review comments for {owner}/{repo}#{number} (page {})", page),
        )
        .await?;

        let comments = response.json::<Vec<GitHubReviewComment>>().await?;
        let count = comments.len();
        all_comments.extend(comments);
        
        // If we got less than 100, we've reached the last page
        if count < 100 {
            break;
        }
        
        page += 1;
    }
    
    Ok(all_comments)
}

pub async fn get_pending_review_comments(
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    review_id: u64,
    current_login: Option<&str>,
) -> AppResult<Vec<PullRequestComment>> {
    let client = build_client(token)?;
    let comments = fetch_pending_review_comments(&client, owner, repo, number, review_id).await?;
    
    // Fetch all PR files with pagination to get patches for position-to-line conversion
    let mut all_files = Vec::new();
    let mut page = 1;
    
    loop {
        let files_response = client
            .get(format!(
                "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/files"
            ))
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await?;

        let files_response = ensure_success(
            files_response,
            &format!("list pull request files {owner}/{repo}#{number} (page {})", page),
        )
        .await?;

        let files = files_response.json::<Vec<GitHubPullRequestFile>>().await?;
        let count = files.len();
        all_files.extend(files);
        
        // If we got less than 100, we've reached the last page
        if count < 100 {
            break;
        }
        
        page += 1;
    }
    
    // Build a map of file path to patch
    let mut patches: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for file in all_files {
        if let Some(patch) = file.patch {
            patches.insert(file.filename, patch);
        }
    }
    
    let normalized_login = current_login
        .filter(|login| !login.is_empty())
        .map(|login| login.to_ascii_lowercase());
    
    let mapped_comments: Vec<PullRequestComment> = comments
        .iter()
        .map(|comment| {
            let is_mine = normalized_login
                .as_ref()
                .map(|login| comment.user.login.eq_ignore_ascii_case(login))
                .unwrap_or(false);
            
            // Get the patch for this file
            let patch = patches.get(&comment.path);
            
            map_review_comment(comment, is_mine, patch)
        })
        .collect();
    
    Ok(mapped_comments)
}

async fn fetch_pending_review_comments(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    number: u64,
    review_id: u64,
) -> AppResult<Vec<GitHubReviewComment>> {
    let mut all_comments = Vec::new();
    let mut page = 1;
    
    loop {
        let response = client
            .get(format!(
                "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/comments"
            ))
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await?;

        let response = ensure_success(
            response,
            &format!("list pending review comments for {owner}/{repo}#{number} review {review_id} (page {})", page),
        )
        .await?;

        let comments = response.json::<Vec<GitHubReviewComment>>().await?;
        let count = comments.len();
        all_comments.extend(comments);
        
        // If we got less than 100, we've reached the last page
        if count < 100 {
            break;
        }
        
        page += 1;
    }
    
    Ok(all_comments)
}

async fn fetch_issue_comments(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Vec<GitHubIssueComment>> {
    let mut all_comments = Vec::new();
    let mut page = 1;
    
    loop {
        let response = client
            .get(format!(
                "{API_BASE}/repos/{owner}/{repo}/issues/{number}/comments"
            ))
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await?;

        let response = ensure_success(
            response,
            &format!("list issue comments for {owner}/{repo}#{number} (page {})", page),
        )
        .await?;

        let comments = response.json::<Vec<GitHubIssueComment>>().await?;
        let count = comments.len();
        all_comments.extend(comments);
        
        // If we got less than 100, we've reached the last page
        if count < 100 {
            break;
        }
        
        page += 1;
    }
    
    Ok(all_comments)
}

/// Update a review comment on a pull request
pub async fn update_review_comment(
    token: &str,
    owner: &str,
    repo: &str,
    comment_id: u64,
    body: &str,
) -> AppResult<()> {
    let client = build_client(token)?;
    
    let payload = json!({
        "body": body,
    });

    let response = client
        .patch(format!(
            "{API_BASE}/repos/{owner}/{repo}/pulls/comments/{comment_id}"
        ))
        .json(&payload)
        .send()
        .await?;

    ensure_success(
        response,
        &format!("update review comment {comment_id} for {owner}/{repo}"),
    )
    .await?;

    Ok(())
}

/// Delete a review comment on a pull request
pub async fn delete_review_comment(
    token: &str,
    owner: &str,
    repo: &str,
    comment_id: u64,
) -> AppResult<()> {
    let client = build_client(token)?;

    let response = client
        .delete(format!(
            "{API_BASE}/repos/{owner}/{repo}/pulls/comments/{comment_id}"
        ))
        .send()
        .await?;

    ensure_success(
        response,
        &format!("delete review comment {comment_id} for {owner}/{repo}"),
    )
    .await?;

    Ok(())
}

async fn fetch_pull_request_reviews(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Vec<GitHubPullRequestReview>> {
    let mut all_reviews = Vec::new();
    let mut page = 1;
    
    loop {
        let response = client
            .get(format!(
                "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews"
            ))
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await?;

        let response = ensure_success(
            response,
            &format!("list pull request reviews for {owner}/{repo}#{number} (page {})", page),
        )
        .await?;

        let reviews = response.json::<Vec<GitHubPullRequestReview>>().await?;
        let count = reviews.len();
        all_reviews.extend(reviews);
        
        // If we got less than 100, we've reached the last page
        if count < 100 {
            break;
        }
        
        page += 1;
    }
    
    Ok(all_reviews)
}

fn build_comments(
    current_login: Option<&str>,
    review_comments: &[GitHubReviewComment],
    issue_comments: &[GitHubIssueComment],
) -> Vec<PullRequestComment> {
    let normalized_login = current_login
        .filter(|login| !login.is_empty())
        .map(|login| login.to_ascii_lowercase());

    let mut collected = Vec::new();

    for comment in review_comments {
        let is_mine = normalized_login
            .as_ref()
            .map(|login| comment.user.login.eq_ignore_ascii_case(login))
            .unwrap_or(false);
        // No patch needed for submitted comments - they already have line numbers
        collected.push(map_review_comment(comment, is_mine, None));
    }

    for comment in issue_comments {
        let is_mine = normalized_login
            .as_ref()
            .map(|login| comment.user.login.eq_ignore_ascii_case(login))
            .unwrap_or(false);
        collected.push(map_issue_comment(comment, is_mine));
    }

    collected.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    collected
}

fn build_reviews(
    current_login: Option<&str>,
    reviews: &[GitHubPullRequestReview],
) -> Vec<PullRequestReview> {
    let normalized_login = current_login
        .filter(|login| !login.is_empty())
        .map(|login| login.to_ascii_lowercase());

    reviews
        .iter()
        .map(|review| map_review(review, normalized_login.as_deref()))
        .collect()
}

fn map_review(
    review: &GitHubPullRequestReview,
    normalized_login: Option<&str>,
) -> PullRequestReview {
    let review_author_normalized = review.user.login.to_ascii_lowercase();
    let is_mine = normalized_login
        .map(|login| review_author_normalized == login)
        .unwrap_or(false);

    PullRequestReview {
        id: review.id,
        state: review.state.clone(),
        author: review.user.login.clone(),
        submitted_at: review.submitted_at.clone(),
        body: review.body.clone(),
        html_url: review.html_url.clone(),
        commit_id: review.commit_id.clone(),
        is_mine,
    }
}

fn map_review_comment(comment: &GitHubReviewComment, is_mine: bool, patch: Option<&String>) -> PullRequestComment {
    // Check if this is a file-level comment
    let is_file_level = comment.subject_type.as_deref() == Some("file");
    
    // Try to get line number from multiple possible fields, but only if not file-level
    let mut line = if is_file_level {
        None
    } else {
        comment.line
            .or(comment.original_line)
            .or(comment.start_line)
            .or(comment.original_start_line)
    };
    
    // If we don't have a line number but we have a position and patch, convert it
    if line.is_none() && !is_file_level {
        if let (Some(position), Some(patch_text)) = (comment.position.or(comment.original_position), patch) {
            line = convert_diff_position_to_line(patch_text, position, comment.side.as_deref().unwrap_or("RIGHT"));
        }
    }
    
    PullRequestComment {
        id: comment.id,
        body: comment.body.clone(),
        author: comment.user.login.clone(),
        created_at: comment.created_at.clone(),
        url: comment.html_url.clone(),
        path: Some(comment.path.clone()),
        line,
        side: comment.side.clone().or(comment.start_side.clone()),
        is_review_comment: true,
        is_draft: comment
            .state
            .as_deref()
            .map(|state| state.eq_ignore_ascii_case("pending"))
            .unwrap_or(false),
        state: comment.state.clone(),
        is_mine,
        review_id: comment.pull_request_review_id,
        in_reply_to_id: comment.in_reply_to_id,
    }
}

/// Converts a diff position to an absolute line number
/// Position is 1-indexed and counts lines in the diff output
/// Side is "LEFT" (base) or "RIGHT" (head)
fn convert_diff_position_to_line(patch: &str, position: u64, side: &str) -> Option<u64> {
    let mut current_position = 0u64;
    let mut left_line = 0u64; // Current line in base file
    let mut right_line = 0u64; // Current line in head file
    
    for line in patch.lines() {
        // Parse hunk headers like: @@ -10,7 +10,8 @@
        if line.starts_with("@@") {
            if let Some(header) = parse_hunk_header(line) {
                left_line = header.0;
                right_line = header.1;
            }
            continue;
        }
        
        // Each line in the diff (except headers) increments position
        current_position += 1;
        
        if line.starts_with('-') {
            // Deletion: only exists on LEFT side
            if current_position == position && side == "LEFT" {
                return Some(left_line);
            }
            left_line += 1;
        } else if line.starts_with('+') {
            // Addition: only exists on RIGHT side
            if current_position == position && side == "RIGHT" {
                return Some(right_line);
            }
            right_line += 1;
        } else {
            // Context line: exists on both sides
            if current_position == position {
                return Some(if side == "LEFT" { left_line } else { right_line });
            }
            left_line += 1;
            right_line += 1;
        }
    }
    
    None
}

/// Parses a unified diff hunk header to extract starting line numbers
/// Format: @@ -start_left,count_left +start_right,count_right @@
/// Returns (left_start, right_start)
fn parse_hunk_header(line: &str) -> Option<(u64, u64)> {
    // Extract the part between @@ and @@
    let parts: Vec<&str> = line.split("@@").collect();
    if parts.len() < 2 {
        return None;
    }
    
    let header = parts[1].trim();
    let sides: Vec<&str> = header.split_whitespace().collect();
    if sides.len() < 2 {
        return None;
    }
    
    // Parse left side: -start,count
    let left_start = sides[0]
        .trim_start_matches('-')
        .split(',')
        .next()?
        .parse::<u64>()
        .ok()?;
    
    // Parse right side: +start,count
    let right_start = sides[1]
        .trim_start_matches('+')
        .split(',')
        .next()?
        .parse::<u64>()
        .ok()?;
    
    Some((left_start, right_start))
}

fn map_issue_comment(comment: &GitHubIssueComment, is_mine: bool) -> PullRequestComment {
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
        is_mine,
        review_id: None,
        in_reply_to_id: None,
    }
}

fn detect_language(filename: &str) -> FileLanguage {
    let lower = filename.to_ascii_lowercase();
    
    if lower.ends_with(".yml") || lower.ends_with(".yaml") {
        "yaml".to_string()
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "markdown".to_string()
    } else if lower.ends_with(".json") {
        "json".to_string()
    } else if lower.ends_with(".js") || lower.ends_with(".jsx") {
        "javascript".to_string()
    } else if lower.ends_with(".ts") || lower.ends_with(".tsx") {
        "typescript".to_string()
    } else if lower.ends_with(".py") {
        "python".to_string()
    } else if lower.ends_with(".rs") {
        "rust".to_string()
    } else if lower.ends_with(".go") {
        "go".to_string()
    } else if lower.ends_with(".java") {
        "java".to_string()
    } else if lower.ends_with(".c") || lower.ends_with(".h") {
        "c".to_string()
    } else if lower.ends_with(".cpp") || lower.ends_with(".hpp") || lower.ends_with(".cc") {
        "cpp".to_string()
    } else if lower.ends_with(".cs") {
        "csharp".to_string()
    } else if lower.ends_with(".rb") {
        "ruby".to_string()
    } else if lower.ends_with(".php") {
        "php".to_string()
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        "html".to_string()
    } else if lower.ends_with(".css") {
        "css".to_string()
    } else if lower.ends_with(".sh") || lower.ends_with(".bash") {
        "shell".to_string()
    } else if lower.ends_with(".xml") {
        "xml".to_string()
    } else if lower.ends_with(".sql") {
        "sql".to_string()
    } else if lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") || 
              lower.ends_with(".gif") || lower.ends_with(".svg") || lower.ends_with(".webp") ||
              lower.ends_with(".bmp") || lower.ends_with(".ico") {
        "image".to_string()
    } else {
        // Get extension or use "text" as fallback
        filename
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_string())
            .unwrap_or_else(|| "text".to_string())
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
    pub state: String,
    pub merged_at: Option<String>,
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
    pub previous_filename: Option<String>,
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
    pub original_position: Option<u64>,
    pub position: Option<u64>,
    pub start_line: Option<u64>,
    pub original_start_line: Option<u64>,
    pub side: Option<String>,
    pub start_side: Option<String>,
    pub user: GitHubUser,
    pub html_url: String,
    pub state: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub pull_request_review_id: Option<u64>,
    #[serde(default)]
    pub in_reply_to_id: Option<u64>,
    #[allow(dead_code)]
    pub subject_type: Option<String>, // "line" or "file" - reserved for future use
}

#[derive(Debug, Deserialize)]
struct GitHubIssueComment {
    pub id: u64,
    pub body: String,
    pub user: GitHubUser,
    pub html_url: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
struct GitHubPullRequestReview {
    pub id: u64,
    pub state: String,
    pub user: GitHubUser,
    pub body: Option<String>,
    pub html_url: Option<String>,
    pub commit_id: Option<String>,
    pub submitted_at: Option<String>,
}

pub async fn create_review_with_comments(
    app: &tauri::AppHandle,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    commit_id: &str,
    _body: Option<&str>,
    _event: Option<&str>,
    comments: &[crate::review_storage::ReviewComment],
) -> AppResult<(Vec<i64>, Option<String>)> {
    let client = build_client(token)?;
    
    let total = comments.len();
    warn!("Submitting {} comments to {}/{} PR #{}", total, owner, repo, number);
    
    let mut succeeded = 0;
    let mut failed = 0;
    let mut errors = Vec::new();
    let mut succeeded_ids = Vec::new();
    
    // Submit each comment individually, continuing even if some fail
    for (index, comment) in comments.iter().enumerate() {
        let mut comment_obj = Map::new();
        comment_obj.insert("body".into(), Value::String(comment.body.clone()));
        comment_obj.insert("commit_id".into(), Value::String(commit_id.to_string()));
        comment_obj.insert("path".into(), Value::String(comment.file_path.clone()));
        
        // For file-level comments (line_number = 0), use subject_type instead of line
        if comment.line_number == 0 {
            comment_obj.insert("subject_type".into(), Value::String("file".to_string()));
            warn!("Posting file-level comment to {}: {}", comment.file_path, comment.body);
        } else {
            comment_obj.insert("line".into(), Value::Number(comment.line_number.into()));
            comment_obj.insert("side".into(), Value::String(comment.side.clone()));
            warn!("Posting comment to {}:{}: {}", comment.file_path, comment.line_number, comment.body);
        }
        
        // Emit progress event
        let _ = app.emit("comment-submit-progress", serde_json::json!({
            "current": index + 1,
            "total": total,
            "file": comment.file_path,
        }));
        
        // Add delay between comments to avoid "was submitted too quickly" error
        // Skip delay for the first comment (index 0)
        if index > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
        }
        
        match client
            .post(format!("{API_BASE}/repos/{owner}/{repo}/pulls/{number}/comments"))
            .json(&Value::Object(comment_obj))
            .send()
            .await
        {
            Ok(response) => {
                match ensure_success(
                    response,
                    &format!("add comment to {owner}/{repo}#{number}"),
                )
                .await
                {
                    Ok(_) => {
                        succeeded += 1;
                        succeeded_ids.push(comment.id);
                        warn!("✓ Comment posted successfully");
                    }
                    Err(e) => {
                        failed += 1;
                        let error_msg = format!("Failed to post comment to {}:{} - {}", comment.file_path, comment.line_number, e);
                        warn!("✗ {}", error_msg);
                        errors.push(error_msg);
                    }
                }
            }
            Err(e) => {
                failed += 1;
                let error_msg = format!("Failed to post comment to {}:{} - {}", comment.file_path, comment.line_number, e);
                warn!("✗ {}", error_msg);
                errors.push(error_msg);
            }
        }
    }
    
    warn!("Submission complete: {} succeeded, {} failed", succeeded, failed);
    
    if failed > 0 {
        let error_summary = if succeeded > 0 {
            format!("Submitted {} of {} comments. Failed comments:\n{}", succeeded, comments.len(), errors.join("\n"))
        } else {
            format!("Failed to submit all {} comments:\n{}", comments.len(), errors.join("\n"))
        };
        // Return succeeded_ids along with error message
        Ok((succeeded_ids, Some(error_summary)))
    } else {
        // All succeeded, no error message
        Ok((succeeded_ids, None))
    }
}

pub async fn fetch_file_content(
    token: &str,
    owner: &str,
    repo: &str,
    reference: &str,
    path: &str,
) -> AppResult<String> {
    let client = build_client(token)?;
    
    let response = client
        .get(format!("{API_BASE}/repos/{owner}/{repo}/contents/{path}"))
        .query(&[("ref", reference)])
        .send()
        .await?;
    
    let status = response.status();
    
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        warn!("Error response body: {}", error_text);
        return Err(AppError::Api(format!("Failed to fetch file ({}): {}", status, error_text)));
    }
    
    let content_json: Value = response.json().await?;
    
    // GitHub returns content as base64 in the "content" field
    if let Some(content) = content_json.get("content").and_then(|c| c.as_str()) {
        // Remove whitespace/newlines that GitHub adds
        let cleaned = content.chars().filter(|c| !c.is_whitespace()).collect();
        Ok(cleaned)
    } else {
        warn!("Content field not found in response: {:?}", content_json);
        Err(AppError::Api("File content not found in response".to_string()))
    }
}

pub async fn delete_review(
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    review_id: u64,
) -> AppResult<()> {
    let client = build_client(token)?;
    
    warn!("Deleting review {} for {}/{} PR #{}", review_id, owner, repo, number);
    
    let response = client
        .delete(format!("{API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}"))
        .send()
        .await?;
    
    ensure_success(
        response,
        &format!("delete review {review_id} for {owner}/{repo}#{number}"),
    )
    .await?;
    
    warn!("Successfully deleted review {}", review_id);
    
    Ok(())
}
