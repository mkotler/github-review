# app/src-tauri/src/error.rs

**Path:** `app/src-tauri/src/error.rs`

**Last Updated:** January 2025

**Lines of Code:** 45

## Capabilities Provided

This module establishes a centralized error handling system for the application using the `thiserror` crate. It defines a comprehensive `AppError` enum that covers all error scenarios including OAuth failures, HTTP errors, I/O errors, database errors, secure storage errors, and GitHub API errors. The module provides automatic error conversion through the `From` trait for common error types, enabling clean error propagation with the `?` operator. The `AppResult<T>` type alias standardizes function return types throughout the codebase. All errors implement `Display` and `Error` traits via `thiserror`, ensuring consistent error messages that can be serialized across the Tauri bridge to the frontend.

## Type Aliases

### AppResult<T>

**Purpose:** Standard Result type alias used throughout the application for consistent error handling.

**Definition:** `Result<T, AppError>`

**Usage:** All fallible functions return `AppResult<T>` instead of `Result<T, AppError>` for brevity. Example: `pub async fn fetch_user(token: &str) -> AppResult<User>`

---

## Enums

### AppError

**Purpose:** Comprehensive error type representing all possible failure modes in the application.

**Derives:** Debug, Error (from thiserror)

**Variants:**

#### MissingConfig

**Format:** `"missing configuration value: {0}"`

**Fields:** `&'static str` - Name of the missing configuration value

**Usage:** Thrown when required environment variables or configuration values are not set

---

#### OAuthCancelled

**Format:** `"oauth flow was cancelled or timed out"`

**Fields:** None

**Usage:** Thrown when user cancels the OAuth authorization flow or the callback timeout (5 minutes) expires

---

#### InvalidOAuthCallback

**Format:** `"received an invalid oauth callback"`

**Fields:** None

**Usage:** Thrown when the OAuth callback HTTP request is malformed or missing required parameters (code, state)

---

#### Http

**Format:** `"http error: {0}"`

**Fields:** `reqwest::Error` - Wrapped HTTP client error

**Conversion:** Automatically converts from `reqwest::Error` via `#[from]` attribute

**Usage:** Covers network errors, connection failures, and invalid HTTP responses from GitHub API

---

#### Io

**Format:** `"io error: {0}"`

**Fields:** `std::io::Error` - Wrapped I/O error

**Conversion:** Automatically converts from `std::io::Error` via `#[from]` attribute

**Usage:** Handles file system errors, socket errors, and other I/O failures including OAuth callback server binding

---

#### Url

**Format:** `"url parse error: {0}"`

**Fields:** `url::ParseError` - Wrapped URL parsing error

**Conversion:** Automatically converts from `url::ParseError` via `#[from]` attribute

**Usage:** Thrown when OAuth callback URL parsing fails or URL construction is invalid

---

#### Serde

**Format:** `"serialization error: {0}"`

**Fields:** `serde_json::Error` - Wrapped JSON serialization/deserialization error

**Conversion:** Automatically converts from `serde_json::Error` via `#[from]` attribute

**Usage:** Handles JSON parsing failures from GitHub API responses or local storage data

---

#### Keyring

**Format:** `"secure storage error: {0}"`

**Fields:** `keyring::Error` - Wrapped secure storage error

**Conversion:** Automatically converts from `keyring::Error` via `#[from]` attribute

**Usage:** Covers errors accessing system keyring/credential manager (Windows Credential Manager, macOS Keychain, Linux Secret Service)

---

#### Database

**Format:** `"database error: {0}"`

**Fields:** `rusqlite::Error` - Wrapped SQLite database error

**Conversion:** Automatically converts from `rusqlite::Error` via `#[from]` attribute

**Usage:** Handles SQLite errors including schema creation, query execution, and transaction failures

---

#### Timeout

**Format:** `"operation timed out"`

**Fields:** None

**Usage:** Thrown when async operations exceed their timeout duration (e.g., OAuth callback waiting period)

**Conversion:** Automatically converts from `tokio::time::error::Elapsed` via manual `From` implementation

---

#### Internal

**Format:** `"internal error: {0}"`

**Fields:** `String` - Custom error message

**Usage:** Catch-all for unexpected errors that don't fit other categories, typically logic errors or invariant violations

---

#### SsoAuthorizationRequired

**Format:** `"{0}"` (message is the full error description)

**Fields:** `String` - Detailed message with organization name and authorization URL

**Usage:** Specialized error for GitHub SSO authorization failures (HTTP 403 with x-github-sso header). Contains user-friendly instructions including the authorization URL.

---

#### Api

**Format:** `"{0}"` (message is the full error description)

**Fields:** `String` - Detailed GitHub API error message including status code, documentation URL, and scope information

**Usage:** General GitHub API errors with rich context extracted from API response (error message, documentation URL, required scopes, current scopes)

---

## Trait Implementations

### From<tokio::time::error::Elapsed> for AppError

**Purpose:** Enables automatic conversion of tokio timeout errors to `AppError::Timeout`.

**Implementation:** Maps all `tokio::time::error::Elapsed` instances to `AppError::Timeout`

**Usage:** Allows using `?` operator with `tokio::time::timeout` results

**Example:**
```rust
let result = tokio::time::timeout(Duration::from_secs(300), wait_for_callback()).await?;
// If timeout occurs, automatically converts to AppError::Timeout
```

---

## Dependencies

### External Crates

- `thiserror` - Derive macro for automatic `Error` and `Display` trait implementations
- `reqwest` - HTTP client error type
- `std::io` - Standard I/O error type
- `url` - URL parsing error type
- `serde_json` - JSON serialization error type
- `keyring` - Secure credential storage error type
- `rusqlite` - SQLite database error type
- `tokio::time::error` - Async timeout error type

### Usage Context

This error type is used throughout the application:
- `github.rs` - Returns `AppResult` for all GitHub API operations
- `auth.rs` - Returns `AppResult` for OAuth flow and authentication operations
- `review_storage.rs` - Returns `AppResult` for database operations
- `lib.rs` - Tauri commands return these errors which are automatically serialized to JSON for the frontend

The `thiserror` crate ensures all error messages are consistent and user-friendly, with automatic conversion from underlying error types enabling clean error propagation with the `?` operator throughout the codebase.
