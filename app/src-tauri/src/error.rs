use std::io;

use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("missing configuration value: {0}")]
    MissingConfig(&'static str),
    #[error("oauth flow was cancelled or timed out")]
    OAuthCancelled,
    #[error("received an invalid oauth callback")]
    InvalidOAuthCallback,
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("url parse error: {0}")]
    Url(#[from] url::ParseError),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("secure storage error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("operation timed out")]
    Timeout,
}

impl From<tokio::time::error::Elapsed> for AppError {
    fn from(_: tokio::time::error::Elapsed) -> Self {
        AppError::Timeout
    }
}
