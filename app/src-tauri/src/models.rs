use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct PrUnderReview {
    pub owner: String,
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub has_local_review: bool,
    pub has_pending_review: bool,
    pub viewed_count: usize,
    pub total_count: usize,
    pub local_folder: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    pub is_authenticated: bool,
    pub login: Option<String>,
    pub avatar_url: Option<String>,
    pub is_offline: bool, // true if authenticated using cached data without network verification
}

#[derive(Debug, Serialize)]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub updated_at: String,
    pub head_ref: String,
    pub has_pending_review: bool,
    pub file_count: usize,
    pub state: String,
    pub merged: bool,
}

#[derive(Debug, Serialize)]
pub struct PullRequestDetail {
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub author: String,
    pub head_sha: String,
    pub base_sha: String,
    pub files: Vec<PullRequestFile>,
    pub comments: Vec<PullRequestComment>,
    pub my_comments: Vec<PullRequestComment>,
    pub reviews: Vec<PullRequestReview>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PullRequestFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub patch: Option<String>,
    pub head_content: Option<String>,
    pub base_content: Option<String>,
    pub language: FileLanguage,
    pub previous_filename: Option<String>,
}

pub type FileLanguage = String;

#[derive(Debug, Serialize, Clone)]
pub struct PullRequestComment {
    pub id: u64,
    pub body: String,
    pub author: String,
    pub created_at: String,
    pub url: String,
    pub path: Option<String>,
    pub line: Option<u64>,
    pub side: Option<String>,
    pub is_review_comment: bool,
    pub is_draft: bool,
    pub state: Option<String>,
    pub is_mine: bool,
    pub review_id: Option<u64>,
    pub in_reply_to_id: Option<u64>,
    pub outdated: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PullRequestReview {
    pub id: u64,
    pub state: String,
    pub author: String,
    pub submitted_at: Option<String>,
    pub body: Option<String>,
    pub html_url: Option<String>,
    pub commit_id: Option<String>,
    pub is_mine: bool,
}
