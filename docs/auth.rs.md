# app/src-tauri/src/auth.rs

**Path:** `app/src-tauri/src/auth.rs`  
**Last Updated:** 2025-11-07  
**Lines of Code:** ~420

## Capabilities Provided

This module manages GitHub OAuth 2.0 authentication and provides authenticated wrapper functions for GitHub API operations. Key capabilities:

- **OAuth 2.0 PKCE Flow** - Implements secure authorization code flow with PKCE (Proof Key for Code Exchange)
- **Token Management** - Stores and retrieves access tokens from system keyring via storage module
- **Offline Authentication** - Gracefully handles network failures during authentication checks without forcing logout
- **Last Login Caching** - Stores username in keyring for offline authentication identification
- **Automatic Reconnection** - Returns `is_offline` flag to enable frontend re-authentication when network returns
- **Local HTTP Server** - Runs temporary callback server to capture OAuth authorization code
- **Authenticated API Wrappers** - Provides high-level functions that automatically inject authentication tokens
- **Token Validation** - Checks token validity and handles 401 unauthorized responses

## Offline Authentication Strategy

### Security Model

The authentication system maintains security while supporting offline operation:

**Token Storage:**
- OAuth token stored in system keyring (OS-level secure storage)
- Last successful login username cached in keyring
- Both cleared on explicit logout or 401 unauthorized response
- `is_offline` flag added to AuthStatus for reconnection detection

**Online Authentication Flow:**
1. App starts → `check_auth_status()` called
2. Token retrieved from keyring
3. Token verified with GitHub API `/user` endpoint
4. Username cached in keyring for offline use
5. Returns `AuthStatus { is_authenticated: true, login, avatar_url, is_offline: false }`

**Offline Authentication Flow:**
1. App starts → `check_auth_status()` called
2. Token retrieved from keyring
3. GitHub API call fails with network error
4. Retrieves cached username from keyring
5. Returns `AuthStatus { is_authenticated: true, login, avatar_url: None, is_offline: true }`

**Reconnection Flow:**
1. Network returns → Frontend detects via browser event, successful query, or window focus
2. Frontend triggers auth refetch when `isOnline && authQuery.data?.is_offline`
3. Backend successfully verifies token with GitHub API
4. Returns `AuthStatus` with `is_offline: false` and avatar_url restored
5. Frontend updates network status and UI automatically

**Network Error vs Unauthorized:**
- Network errors (timeout, DNS failure, connection refused) → Treated as offline, user stays authenticated
- HTTP 401 Unauthorized → Token explicitly revoked, user logged out, cache cleared
- Other HTTP errors (500, 403, etc.) → Propagated as errors

**Security Properties:**
- Token never exposed to JavaScript or browser storage
- Cached username used only for UI display, not authorization
- All API calls use real token from keyring (even when offline indicator shows)
- Attacker cannot forge authentication by manipulating cache
- Network failures don't disrupt workflow unnecessarily

### Helper Functions

#### `is_network_error(err: &AppError) -> bool`

**Purpose:** Distinguishes network connectivity errors from authorization/application errors  
**Parameters:**
- `err` - Reference to AppError to check

**Returns:** `true` if error indicates network connectivity issue, `false` otherwise  
**Logic:**
- Returns `true` for `AppError::Http(e)` where:
  - `e.is_timeout()` - Request timeout
  - `e.is_connect()` - Connection refused, reset, or failed
  - `e.is_builder()` - Request construction errors
  - `e.status().is_none()` - No HTTP status (connection never established)
- Returns `true` for `AppError::Timeout`
- Returns `false` for all other error types

**Usage:** Used by `check_auth_status()` to determine if authentication failure is due to network (stay authenticated) or explicit rejection (logout)

---

## Functions and Classes

### Authentication Core Functions

#### `check_auth_status() -> AppResult<AuthStatus>`

**Purpose:** Verifies if user is authenticated with graceful offline handling  
**Parameters:** None  
**Returns:** `AuthStatus` with `is_authenticated` bool, optional `login` username, optional `avatar_url`, and `is_offline` flag  
**Side Effects:**  
- Reads token from system keyring
- Makes GET request to GitHub `/user` endpoint if token exists
- Stores username in keyring on successful verification (for offline use)
- Deletes invalid token and cached username from keyring on 401 response
- Logs auth status resolution at info level

**Behavior:**
1. If no token exists → Returns unauthenticated status (`is_offline: false`)
2. If token exists and API succeeds → Caches username, returns authenticated with full user info (`is_offline: false`)
3. If token exists and API returns 401 → Deletes token/username, returns unauthenticated (`is_offline: false`)
4. If token exists and network/HTTP error occurs with cached login → Returns authenticated with cached data (`is_offline: true`)
5. If token exists and error occurs without cached login → Propagates error (forces re-authentication)

**Network Error Handling:**  
All errors except explicit 401 Unauthorized are treated as potential network issues when a cached login exists:
- HTTP errors (500, 502, 503, etc.) with cached login → Offline mode (`is_offline: true`)
- Connection errors with cached login → Offline mode (`is_offline: true`)
- Timeout errors with cached login → Offline mode (`is_offline: true`)
- Any error without cached login → Propagates error (user must re-authenticate online)

This defensive approach ensures users can always access cached data if they've successfully authenticated at least once, while still requiring online authentication for first-time users.

**Reconnection Detection:**  
The `is_offline` flag enables the frontend to:
- Display offline indicators immediately on app start
- Detect when re-authentication is needed (when `isOnline && is_offline`)
- Automatically trigger auth refetch when network returns
- Update UI to show full online status with avatar when reconnected

**Exceptions:**  
- Returns `AuthStatus { is_authenticated: false, is_offline: false, ... }` if no token
- Returns `AuthStatus { is_authenticated: false, is_offline: false, ... }` on 401 unauthorized (deletes credentials)
- Returns `AuthStatus { is_authenticated: true, is_offline: true, ... }` with cached username on any other error (if cached login exists)
- Propagates errors only when no cached login is available

**Dependencies:** `read_token`, `fetch_authenticated_user`, `delete_token`, `store_last_login`, `read_last_login`, `delete_last_login`, `is_network_error`

---

#### `logout() -> AppResult<()>`

**Purpose:** Removes authentication token and cached username from system keyring  
**Parameters:** None  
**Returns:** `()` on success  
**Side Effects:** 
- Deletes "github_token" entry from keyring
- Deletes "github_login" entry from keyring (best effort, doesn't fail logout if this fails)

**Dependencies:** `delete_token`, `delete_last_login` from storage module

---

#### `start_oauth_flow(_app: &tauri::AppHandle) -> AppResult<AuthStatus>`

**Purpose:** Initiates OAuth 2.0 PKCE flow by opening browser and waiting for callback  
**Parameters:**  
- `_app` - Tauri app handle (unused in current implementation)

**Returns:** `AuthStatus` with authenticated user information and `is_offline: false`  
**Side Effects:**  
- Loads `.env` file to read `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- Generates random PKCE code verifier and challenge
- Binds TCP listener on localhost with random available port
- Opens user's default browser to GitHub OAuth authorization page
- Starts temporary HTTP server to receive callback
- Exchanges authorization code for access token
- Stores token in system keyring
- Stores username in keyring for offline use
- Fetches and returns user info with `is_offline: false` (online verification)

**Exceptions:**  
- Returns `AppError::MissingConfig` if OAuth credentials not in environment
- Returns `AppError::InvalidOAuthCallback` if state mismatch or missing code
- Times out after 180 seconds (OAUTH_TIMEOUT constant)

**Dependencies:** `TcpListener`, `wait_for_callback`, `exchange_code`, `store_token`, `store_last_login`, `fetch_authenticated_user`, `open` crate

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

### `AuthStatus` (in models.rs)

**Purpose:** Represents authentication state for the frontend  
**Fields:**  
- `is_authenticated: bool` - Whether user has valid credentials
- `login: Option<String>` - GitHub username (None if not authenticated)
- `avatar_url: Option<String>` - User's avatar URL (None if offline or not authenticated)
- `is_offline: bool` - True if authenticated using cached data without network verification

**Usage Context:**
- Returned by `check_auth_status()` and `start_oauth_flow()`
- Frontend uses `is_offline` flag to:
  - Display offline indicator immediately on app start
  - Trigger re-authentication when network returns
  - Show cached username without avatar during offline mode
  - Update to full online status when reconnected

---

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
