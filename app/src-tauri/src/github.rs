use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::models::{FileLanguage, PullRequestDetail, PullRequestFile, PullRequestSummary};

const API_BASE: &str = "https://api.github.com";
const USER_AGENT_VALUE: &str = "github-review-app/0.1";
const SUPPORTED_EXTENSIONS: [&str; 4] = [".md", ".markdown", ".yaml", ".yml"];

fn build_client(token: &str) -> AppResult<reqwest::Client> {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(USER_AGENT_VALUE),
    );
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
    let response = client
        .get(format!("{API_BASE}/user"))
        .send()
        .await?
        .error_for_status()?;

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
        .await?
        .error_for_status()?;

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
) -> AppResult<PullRequestDetail> {
    let client = build_client(token)?;
    let pr = client
        .get(format!("{API_BASE}/repos/{owner}/{repo}/pulls/{number}"))
        .send()
        .await?
        .error_for_status()?;
    let pr = pr.json::<GitHubPullRequest>().await?;

    let files_response = client
        .get(format!(
            "{API_BASE}/repos/{owner}/{repo}/pulls/{number}/files"
        ))
        .query(&[("per_page", "100")])
        .send()
        .await?
        .error_for_status()?;

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
            Some(fetch_file_contents(
                &client,
                owner,
                repo,
                &file.filename,
                &base_sha,
            )
            .await?)
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

    Ok(PullRequestDetail {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        author: pr.user.login,
        head_sha,
        base_sha,
        files: collected,
    })
}

async fn fetch_file_contents(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    path: &str,
    reference: &str,
) -> AppResult<String> {
    let response = client
        .get(format!(
            "{API_BASE}/repos/{owner}/{repo}/contents/{path}"
        ))
        .query(&[("ref", reference)])
        .header(ACCEPT, "application/vnd.github.v3.raw")
        .send()
        .await?
        .error_for_status()?;

    Ok(response.text().await?)
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
