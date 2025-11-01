use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    pub is_authenticated: bool,
    pub login: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub updated_at: String,
    pub head_ref: String,
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
}

#[derive(Debug, Serialize, Clone, Copy)]
pub enum FileLanguage {
    #[serde(rename = "markdown")]
    Markdown,
    #[serde(rename = "yaml")]
    Yaml,
}
