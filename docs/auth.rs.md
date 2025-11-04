# app/src-tauri/src/auth.rs

**Path:** `app/src-tauri/src/auth.rs`  
**Last Updated:** 2025-11-03  
**Lines of Code:** 353

## Capabilities Provided

This module manages GitHub OAuth 2.0 authentication and provides authenticated wrapper functions for GitHub API operations. Key capabilities:

- **OAuth 2.0 PKCE Flow** - Implements secure authorization code flow with PKCE (Proof Key for Code Exchange)
- **Token Management** - Stores and retrieves access tokens from system keyring via storage module
- **Local HTTP Server** - Runs temporary callback server to capture OAuth authorization code
- **Authenticated API Wrappers** - Provides high-level functions that automatically inject authentication tokens
- **Token Validation** - Checks token validity and handles 401 unauthorized responses

## Functions and Classes

### Authentication Core Functions

#### `check_auth_status() -> AppResult<AuthStatus>`

**Purpose:** Verifies if user is authenticated by checking token validity and fetching user info  
**Parameters:** None  
**Returns:** `AuthStatus` with `is_authenticated` bool, optional `login` username, and `avatar_url`  
**Side Effects:**  
- Reads token from system keyring
- Makes GET request to GitHub `/user` endpoint if token exists
- Deletes invalid token from keyring on 401 response
- Logs auth status resolution at info level

**Exceptions:**  
- Returns `AuthStatus { is_authenticated: false, ... }` if no token or 401 error
- Propagates other HTTP errors

**Dependencies:** `read_token`, `fetch_authenticated_user`, `delete_token`

---

#### `logout() -> AppResult<()>`

**Purpose:** Removes authentication token from system keyring  
**Parameters:** None  
**Returns:** `()` on success  
**Side Effects:** Deletes "github_token" entry from keyring  
**Dependencies:** `delete_token` from storage module

---

#### `start_oauth_flow(_app: &tauri::AppHandle) -> AppResult<AuthStatus>`

**Purpose:** Initiates OAuth 2.0 PKCE flow by opening browser and waiting for callback  
**Parameters:**  
- `_app` - Tauri app handle (unused in current implementation)

**Returns:** `AuthStatus` with authenticated user information  
**Side Effects:**  
- Loads `.env` file to read `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- Generates random PKCE code verifier and challenge
- Binds TCP listener on localhost with random available port
- Opens user's default browser to GitHub OAuth authorization page
- Starts temporary HTTP server to receive callback
- Exchanges authorization code for access token
- Stores token in system keyring
- Fetches and returns user info

**Exceptions:**  
- Returns `AppError::MissingConfig` if OAuth credentials not in environment
- Returns `AppError::InvalidOAuthCallback` if state mismatch or missing code
- Times out after 180 seconds (OAUTH_TIMEOUT constant)

**Dependencies:** `TcpListener`, `wait_for_callback`, `exchange_code`, `store_token`, `fetch_authenticated_user`, `open` crate

**Implementation Notes:**  
- Uses PKCE (RFC 7636) for enhanced security without client secret exposure to browser
- Generates SHA-256 hash of code verifier for challenge
- State parameter prevents CSRF attacks
- Scopes requested: "repo pull_request:write"

---

### Token Management Functions

#### `require_token() -> AppResult<String>`

**Purpose:** Retrieves stored token or returns error if not authenticated  
**Parameters:** None  
**Returns:** Token string  
**Exceptions:** Returns `AppError::OAuthCancelled` if no token found  
**Dependencies:** `read_token`

---

#### `require_token_for_delete() -> AppResult<String>`

**Purpose:** Alias for `require_token()` with semantic naming for delete operations  
**Parameters:** None  
**Returns:** Token string  
**Dependencies:** `require_token`

---

### Authenticated GitHub API Wrapper Functions

#### `list_repo_pull_requests(owner: &str, repo: &str, state: Option<&str>) -> AppResult<Vec<PullRequestSummary>>`

**Purpose:** Fetches list of pull requests with authentication  
**Parameters:**  
- `owner` - Repository owner
- `repo` - Repository name
- `state` - Filter: "open", "closed", or "all" (None defaults to "open")

**Returns:** Vector of `PullRequestSummary`  
**Side Effects:**  
- Retrieves token from keyring
- Logs PR count and details at info level for each PR

**Dependencies:** `require_token`, `list_pull_requests` from github module

---

#### `fetch_pull_request_details(owner: &str, repo: &str, number: u64, current_login: Option<&str>) -> AppResult<PullRequestDetail>`

**Purpose:** Fetches comprehensive PR data including files, comments, and reviews  
**Parameters:**  
- `owner`, `repo`, `number` - PR identification
- `current_login` - Username to mark own comments (optional)

**Returns:** `PullRequestDetail` with nested files, comments, reviews  
**Dependencies:** `require_token`, `get_pull_request` from github module

---

#### `fetch_file_contents_on_demand(owner: &str, repo: &str, file_path: &str, base_sha: &str, head_sha: &str, status: &str) -> AppResult<(Option<String>, Option<String>)>`

**Purpose:** Fetches file contents on-demand for lazy loading (performance optimization)  
**Parameters:**  
- `owner`, `repo` - Repository identification
- `file_path` - Path to the file within the repository
- `base_sha` - SHA of the base branch commit
- `head_sha` - SHA of the head branch commit
- `status` - File status ("added", "modified", "removed", "renamed")

**Returns:** Tuple of `(Option<String>, Option<String>)` representing `(head_content, base_content)`  
- `head_content` is `None` if status is "removed"
- `base_content` is `None` if status is "added"

**Side Effects:** Makes 1-2 authenticated GitHub API calls to fetch file contents at specific SHAs

**Dependencies:** `require_token`, `get_file_contents` from github module

**Performance Note:** This function enables progressive file loading. Instead of fetching all file contents upfront in `fetch_pull_request_details` (which caused 20+ second delays for large PRs), files are now fetched individually on-demand, reducing initial PR load time to <1 second.

---

#### `publish_review_comment(owner: &str, repo: &str, number: u64, body: String) -> AppResult<()>`

**Purpose:** Posts a general PR-level comment (not attached to file/line)  
**Parameters:**  
- `owner`, `repo`, `number` - PR identification
- `body` - Comment markdown text

**Returns:** `()`  
**Dependencies:** `require_token`, `submit_general_comment` from github module

---

#### `publish_file_comment(...) -> AppResult<()>`

**Purpose:** Posts a comment on specific file/line or adds to pending review  
**Parameters:**  
- `owner`, `repo`, `number` - PR identification
- `path` - File path in repository
- `body` - Comment text
- `commit_id` - Commit SHA
- `line` - Line number (optional for file-level comments)
- `side` - "LEFT" or "RIGHT" (optional)
- `subject_type` - "line" or "file" (optional)
- `mode` - `CommentMode::Single` or `CommentMode::Review`
- `pending_review_id` - Review ID if mode is Review (optional)

**Returns:** `()`  
**Dependencies:** `require_token`, `submit_file_comment` from github module

---

#### `start_pending_review(...) -> AppResult<PullRequestReview>`

**Purpose:** Creates a new pending (not yet submitted) review on GitHub  
**Parameters:**  
- `owner`, `repo`, `number` - PR identification
- `commit_id` - SHA to attach review to (optional)
- `body` - Overall review comment (optional)
- `current_login` - Username for ownership (optional)

**Returns:** `PullRequestReview` with `id` field  
**Dependencies:** `require_token`, `create_pending_review` from github module

---

#### `finalize_pending_review(owner: &str, repo: &str, number: u64, review_id: u64, event: &str, body: Option<&str>) -> AppResult<()>`

**Purpose:** Submits a pending review with specified event type  
**Parameters:**  
- `owner`, `repo`, `number` - PR identification
- `review_id` - ID of pending review
- `event` - "APPROVE", "REQUEST_CHANGES", "COMMENT"
- `body` - Final review summary (optional)

**Returns:** `()`  
**Dependencies:** `require_token`, `submit_pending_review` from github module

---

#### `submit_review_with_comments(...) -> AppResult<Vec<i64>>`

**Purpose:** Creates a complete review with multiple comments in single API call (for local review submission)  
**Parameters:**  
- `owner`, `repo`, `number` - PR identification
- `commit_id` - Commit SHA
- `body` - Review summary (optional)
- `event` - Review event type (optional)
- `comments` - Slice of `ReviewComment` from local storage

**Returns:** Vector of successfully posted comment IDs  
**Dependencies:** `require_token`, `create_review_with_comments` from github module

---

### OAuth Helper Functions

#### `random_string(len: usize) -> String`

**Purpose:** Generates cryptographically random alphanumeric string  
**Parameters:**  
- `len` - Desired string length

**Returns:** Random string  
**Dependencies:** `rand` crate with `Alphanumeric` distribution

**Usage:** Used for OAuth state parameter and PKCE code verifier

---

#### `compute_challenge(verifier: &str) -> String`

**Purpose:** Computes PKCE code challenge from verifier using SHA-256  
**Parameters:**  
- `verifier` - Random string used as verifier

**Returns:** Base64-URL-encoded SHA-256 hash  
**Dependencies:** `sha2` crate, `base64` crate with `URL_SAFE_NO_PAD` engine

**Implementation:** Per RFC 7636, uses S256 method (SHA-256 hash)

---

#### `wait_for_callback(listener: TcpListener) -> AppResult<(String, String)>`

**Purpose:** Accepts OAuth callback on local HTTP server and extracts code and state  
**Parameters:**  
- `listener` - Bound TCP listener

**Returns:** Tuple of (authorization code, state parameter)  
**Side Effects:**  
- Accepts single incoming TCP connection
- Reads HTTP request up to 16KB max
- Writes HTTP 200 response with HTML that auto-closes browser tab
- Shuts down TCP stream

**Exceptions:**  
- Returns `AppError::InvalidOAuthCallback` if code or state missing from query parameters

**Dependencies:** `TcpListener`, `read_http_request`, `Url` parsing

---

#### `read_http_request(stream: &mut TcpStream, buffer: &mut Vec<u8>) -> AppResult<()>`

**Purpose:** Reads HTTP request from stream until double CRLF or size limit  
**Parameters:**  
- `stream` - TCP stream to read from
- `buffer` - Vector to append data to

**Returns:** `()`  
**Side Effects:**  
- Reads chunks of 1024 bytes
- Stops at `\r\n\r\n` sequence (end of HTTP headers)
- Enforces 16KB maximum to prevent memory exhaustion

**Dependencies:** `TcpStream::read`

---

#### `exchange_code(...) -> AppResult<String>`

**Purpose:** Exchanges OAuth authorization code for access token  
**Parameters:**  
- `client_id` - GitHub OAuth app client ID
- `client_secret` - GitHub OAuth app client secret
- `code` - Authorization code from callback
- `redirect_uri` - Must match URI used in authorization request
- `code_verifier` - PKCE verifier string

**Returns:** Access token string  
**Side Effects:** POST request to `https://github.com/login/oauth/access_token`  
**Exceptions:** Propagates HTTP errors and JSON deserialization errors  
**Dependencies:** `reqwest`, `TokenResponse` struct

---

## Data Structures

### `TokenResponse`

**Purpose:** Deserializes GitHub OAuth token response  
**Fields:**  
- `access_token: String` - The OAuth access token
- `_token_type: Option<String>` - Token type (typically "bearer"), unused
- `_scope: Option<String>` - Granted scopes, unused

**Attributes:** `#[derive(serde::Deserialize)]`, `#[serde(default)]` on optional fields

---

## Constants

- `AUTHORIZE_URL` - `"https://github.com/login/oauth/authorize"`
- `TOKEN_URL` - `"https://github.com/login/oauth/access_token"`
- `SCOPES` - `"repo pull_request:write"` - Required permissions
- `OAUTH_TIMEOUT` - `Duration::from_secs(180)` - 3 minute timeout for user authorization

---

*Last generated: 2025-11-03*
