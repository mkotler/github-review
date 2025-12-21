// Category 1: Error Handling Tests (error.rs)
// Tests for AppError type conversions and Display implementations

use crate::error::{AppError, AppResult};
use std::io;

/// Test Case 1.1: Convert IO Error to AppError
/// When file operations fail, convert to AppError::Io
#[test]
fn test_io_error_conversion() {
    let io_error = io::Error::new(io::ErrorKind::PermissionDenied, "permission denied");
    let app_error: AppError = io_error.into();
    
    match app_error {
        AppError::Io(_) => {}, // Expected
        other => panic!("Expected AppError::Io, got {:?}", other),
    }
}

/// Test Case 1.2: Convert Rusqlite Error to AppError
/// When database operations fail, convert to AppError::Database
#[test]
fn test_database_error_conversion() {
    // Create a rusqlite error by forcing an invalid operation
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let result: Result<(), rusqlite::Error> = conn.execute("INVALID SQL STATEMENT", []).map(|_| ());
    
    if let Err(rusqlite_error) = result {
        let app_error: AppError = rusqlite_error.into();
        match app_error {
            AppError::Database(_) => {}, // Expected
            other => panic!("Expected AppError::Database, got {:?}", other),
        }
    }
}

/// Test Case 1.3: Convert Serde JSON Error to AppError
/// When JSON parsing fails, convert to AppError::Serde
#[test]
fn test_serde_error_conversion() {
    let malformed_json = "{ invalid json }";
    let result: Result<serde_json::Value, serde_json::Error> = serde_json::from_str(malformed_json);
    
    if let Err(serde_error) = result {
        let app_error: AppError = serde_error.into();
        match app_error {
            AppError::Serde(_) => {}, // Expected
            other => panic!("Expected AppError::Serde, got {:?}", other),
        }
    }
}

/// Test Case 1.4: Convert URL Parse Error to AppError
/// When URL parsing fails, convert to AppError::Url
#[test]
fn test_url_error_conversion() {
    let invalid_url = "not a valid url ://";
    let result = url::Url::parse(invalid_url);
    
    if let Err(url_error) = result {
        let app_error: AppError = url_error.into();
        match app_error {
            AppError::Url(_) => {}, // Expected
            other => panic!("Expected AppError::Url, got {:?}", other),
        }
    }
}

/// Test Case 1.5: AppError Display - MissingConfig
/// Error message should be descriptive
#[test]
fn test_missing_config_display() {
    let error = AppError::MissingConfig("GITHUB_CLIENT_ID");
    let display = format!("{}", error);
    assert!(display.contains("missing configuration value"));
    assert!(display.contains("GITHUB_CLIENT_ID"));
}

/// Test Case 1.6: AppError Display - OAuthCancelled
#[test]
fn test_oauth_cancelled_display() {
    let error = AppError::OAuthCancelled;
    let display = format!("{}", error);
    assert!(display.contains("oauth") || display.contains("cancelled") || display.contains("timed out"));
}

/// Test Case 1.7: AppError Display - InvalidOAuthCallback
#[test]
fn test_invalid_oauth_callback_display() {
    let error = AppError::InvalidOAuthCallback;
    let display = format!("{}", error);
    assert!(display.contains("invalid") || display.contains("callback") || display.contains("oauth"));
}

/// Test Case 1.8: AppError Display - Timeout
#[test]
fn test_timeout_display() {
    let error = AppError::Timeout;
    let display = format!("{}", error);
    assert!(display.contains("timed out"));
}

/// Test Case 1.9: AppError Display - Internal
#[test]
fn test_internal_error_display() {
    let error = AppError::Internal("test internal error".to_string());
    let display = format!("{}", error);
    assert!(display.contains("test internal error"));
}

/// Test Case 1.10: AppError Display - Api
#[test]
fn test_api_error_display() {
    let error = AppError::Api("API returned 404".to_string());
    let display = format!("{}", error);
    assert!(display.contains("API returned 404"));
}

/// Test Case 1.11: AppError Display - SsoAuthorizationRequired
#[test]
fn test_sso_error_display() {
    let error = AppError::SsoAuthorizationRequired("SSO required for org".to_string());
    let display = format!("{}", error);
    assert!(display.contains("SSO required for org"));
}

/// Test Case 1.12: Tokio timeout converts to AppError::Timeout
#[test]
fn test_tokio_timeout_conversion() {
    use tokio::time::error::Elapsed;
    
    // Create an Elapsed error by timing out a future
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    
    rt.block_on(async {
        let result: Result<(), Elapsed> = tokio::time::timeout(
            std::time::Duration::from_nanos(1),
            tokio::time::sleep(std::time::Duration::from_secs(10))
        ).await.map(|_| ());
        
        if let Err(elapsed) = result {
            let app_error: AppError = elapsed.into();
            match app_error {
                AppError::Timeout => {}, // Expected
                other => panic!("Expected AppError::Timeout, got {:?}", other),
            }
        }
    });
}

/// Test Case 1.13: AppResult type alias works correctly
#[test]
fn test_app_result_type_alias() {
    fn returns_ok() -> AppResult<i32> {
        Ok(42)
    }
    
    fn returns_err() -> AppResult<i32> {
        Err(AppError::Internal("test".to_string()))
    }
    
    assert_eq!(returns_ok().unwrap(), 42);
    assert!(returns_err().is_err());
}
