# app/src-tauri/src/lib.rs

**Path:** `app/src-tauri/src/lib.rs`  
**Last Updated:** 2025-11-03  
**Lines of Code:** 525

## Capabilities Provided

This file serves as the central integration point for the Tauri backend, providing:

- **Tauri Command Registration** - Exports 25+ commands callable from the frontend via `invoke()`
- **Application Initialization** - Sets up logging, loads environment variables, initializes SQLite storage
- **Error Boundary** - Converts all internal errors to string format for frontend consumption
- **Module Coordination** - Wires together auth, github, storage, and review_storage modules
- **Development Tools** - Provides devtools access in debug builds only

## Functions and Classes

### Initialization Functions

#### `init_logging()`
**Purpose:** Configures tracing-based logging system with environment variable filter support  
**Parameters:** None  
**Returns:** `()` (unit type)  
**Side Effects:**  
- Initializes global tracing subscriber
- Reads `RUST_LOG` environment variable (defaults to "info" level)
- Configures stdout output without target prefixes

**Dependencies:** `tracing_subscriber`

---

#### `run()`
**Purpose:** Main application entry point that configures and launches the Tauri application  
**Parameters:** None  
**Returns:** `!` (never returns - runs until application exit)  
**Side Effects:**  
- Loads `.env` file via dotenvy
- Initializes logging system
- Creates app data directory
- Initializes SQLite review storage database
- Registers all Tauri commands
- Launches Tauri event loop

**Exceptions:**  
- Panics if Tauri context generation fails
- Returns error string if storage initialization fails
- Returns error string if app data directory cannot be accessed

**Dependencies:** `dotenvy`, `tauri`, `review_storage`, `tracing`

---

### Authentication Commands

#### `cmd_start_github_oauth(app: tauri::AppHandle) -> Result<AuthStatus, String>`
**Purpose:** Initiates OAuth 2.0 flow by opening browser and starting local callback server  
**Parameters:**  
- `app` - Tauri application handle for emitting events
**Returns:** `AuthStatus` with user info on success, error string on failure  
**Side Effects:**  
- Opens default browser to GitHub OAuth page
- Starts temporary HTTP server on localhost
- Stores access token in system keyring on successful auth

**Dependencies:** `auth::start_oauth_flow`

---

#### `cmd_check_auth_status() -> Result<AuthStatus, String>`
**Purpose:** Checks if user is authenticated and retrieves GitHub user info  
**Parameters:** None  
**Returns:** `AuthStatus` with `is_authenticated` bool and optional user data  
**Side Effects:**  
- Reads token from system keyring
- Makes GitHub API call to `/user` endpoint if token exists

**Dependencies:** `auth::check_auth_status`

---

#### `cmd_logout() -> Result<(), String>`
**Purpose:** Removes authentication token from system keyring  
**Parameters:** None  
**Returns:** `()` on success, error string on failure  
**Side Effects:** Deletes "github_token" entry from system keyring  
**Dependencies:** `auth::logout`

---

### Pull Request Commands

#### `cmd_list_pull_requests(owner: String, repo: String, state: Option<String>) -> Result<Vec<PullRequestSummary>, String>`
**Purpose:** Fetches list of pull requests for a repository  
**Parameters:**  
- `owner` - GitHub repository owner/organization
- `repo` - Repository name
- `state` - Optional filter: "open", "closed", or "all" (defaults to "open")

**Returns:** Vector of `PullRequestSummary` objects  
**Side Effects:** Makes authenticated GitHub API call to `/repos/{owner}/{repo}/pulls`  
**Dependencies:** `auth::list_repo_pull_requests`

---

#### `cmd_get_pull_request(owner: String, repo: String, number: u64, current_login: Option<String>) -> Result<PullRequestDetail, String>`
**Purpose:** Fetches detailed PR information including files, comments, and reviews  
**Parameters:**  
- `owner` - Repository owner
- `repo` - Repository name
- `number` - PR number
- `current_login` - Logged-in username for marking own comments

**Returns:** `PullRequestDetail` with nested files, comments, reviews  
**Side Effects:**  
- Makes multiple GitHub API calls (PR detail, file metadata paginated 100 per page, comments, reviews)
- Does NOT fetch file contents upfront (use `cmd_get_file_contents` for on-demand loading)
- Logs current_login for debugging

**Dependencies:** `auth::fetch_pull_request_details`

---

#### `cmd_get_file_contents(owner: String, repo: String, file_path: String, base_sha: String, head_sha: String, status: String) -> Result<(Option<String>, Option<String>), String>`
**Purpose:** Fetches file contents on-demand for a specific file in a PR (lazy loading)  
**Parameters:**  
- `owner` - Repository owner
- `repo` - Repository name
- `file_path` - Path to the file within the repository
- `base_sha` - SHA of the base branch commit
- `head_sha` - SHA of the head branch commit
- `status` - File status ("added", "modified", "removed", "renamed")

**Returns:** Tuple of `(Option<String>, Option<String>)` representing `(head_content, base_content)`  
- `head_content` is `None` if status is "removed"
- `base_content` is `None` if status is "added"
- Both are `Some(String)` for "modified" or "renamed" files

**Side Effects:**  
- Makes 1-2 GitHub API calls to fetch file contents at specific SHAs
- Decodes base64 content from GitHub API
- No local caching (handled by frontend React Query)

**Dependencies:** `auth::fetch_file_contents_on_demand`, `github::get_file_contents`

**Performance Note:** This command enables progressive file loading. Instead of fetching all file contents upfront in `cmd_get_pull_request` (which caused 20+ second delays for large PRs), the frontend now:
1. Gets file metadata instantly from `cmd_get_pull_request`
2. Calls this command on-demand per file
3. Caches results with React Query (staleTime: Infinity)
4. Background-preloads remaining files progressively

---

### Comment Commands

#### `cmd_submit_review_comment(owner: String, repo: String, number: u64, body: String) -> Result<(), String>`
**Purpose:** Submits a general PR-level comment (not attached to a specific file/line)  
**Parameters:**  
- `owner` - Repository owner
- `repo` - Repository name
- `number` - PR number
- `body` - Comment markdown content

**Returns:** `()` on success  
**Side Effects:** Posts comment to GitHub via `/repos/{owner}/{repo}/issues/{number}/comments`  
**Dependencies:** `auth::publish_review_comment`

---

#### `cmd_submit_file_comment(args: SubmitFileCommentArgs) -> Result<(), String>`
**Purpose:** Submits a comment on a specific file/line in a PR  
**Parameters (in SubmitFileCommentArgs struct):**  
- `owner`, `repo`, `number` - PR identification
- `path` - File path within repository
- `body` - Comment text
- `commit_id` - SHA of commit being commented on
- `line` - Line number (optional for file-level comments)
- `side` - "LEFT" (base) or "RIGHT" (head branch)
- `subject_type` - "line" or "file"
- `mode` - "single" or "review" (adds to pending review)
- `pending_review_id` - Existing pending review ID if mode is "review"

**Returns:** `()` on success  
**Side Effects:**  
- Posts single-shot comment OR adds to pending review based on mode
- Uses GitHub PR Review Comments API

**Dependencies:** `auth::publish_file_comment`, `github::CommentMode`

---

### Review Management Commands

#### `cmd_start_pending_review(...) -> Result<PullRequestReview, String>`
**Purpose:** Creates a new pending review on GitHub (not yet submitted)  
**Parameters:**  
- `owner`, `repo`, `number` - PR identification
- `commit_id` - SHA to attach review to (optional, uses latest if omitted)
- `body` - Overall review comment (optional)
- `current_login` - Username for ownership marking

**Returns:** `PullRequestReview` object with `id` field needed for subsequent operations  
**Side Effects:** Creates pending review via GitHub API (POST `/repos/{owner}/{repo}/pulls/{number}/reviews`)  
**Dependencies:** `auth::start_pending_review`

---

#### `cmd_submit_pending_review(owner: String, repo: String, number: u64, review_id: u64, event: Option<String>, body: Option<String>) -> Result<(), String>`
**Purpose:** Finalizes and submits a pending review with all its comments  
**Parameters:**  
- `owner`, `repo`, `number` - PR identification
- `review_id` - ID of pending review
- `event` - "APPROVE", "REQUEST_CHANGES", "COMMENT", or empty (defaults to "COMMENT")
- `body` - Final review summary (optional)

**Returns:** `()` on success  
**Side Effects:**  
- Submits review via POST `/repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/events`
- Review becomes visible to all PR participants

**Dependencies:** `auth::finalize_pending_review`

---

#### `cmd_delete_review(owner: String, repo: String, pr_number: u64, review_id: u64) -> Result<(), String>`
**Purpose:** Deletes a pending (not yet submitted) review  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification
- `review_id` - ID of review to delete

**Returns:** `()` on success  
**Exceptions:** Cannot delete submitted reviews, only pending ones  
**Side Effects:** DELETE request to GitHub API  
**Dependencies:** `auth::require_token_for_delete`, `github::delete_review`

---

### GitHub Comment Edit/Delete Commands

#### `cmd_github_update_comment(owner: String, repo: String, comment_id: u64, body: String) -> Result<(), String>`
**Purpose:** Updates the text of an existing GitHub PR review comment  
**Parameters:**  
- `owner`, `repo` - Repository identification
- `comment_id` - GitHub comment ID
- `body` - New comment text

**Returns:** `()` on success  
**Side Effects:** PATCH request to `/repos/{owner}/{repo}/pulls/comments/{comment_id}`  
**Dependencies:** `auth::require_token`, `github::update_review_comment`

---

#### `cmd_github_delete_comment(owner: String, repo: String, comment_id: u64) -> Result<(), String>`
**Purpose:** Permanently deletes a GitHub PR review comment  
**Parameters:**  
- `owner`, `repo` - Repository identification
- `comment_id` - GitHub comment ID

**Returns:** `()` on success  
**Side Effects:** DELETE request to GitHub API, comment cannot be recovered  
**Dependencies:** `auth::require_token`, `github::delete_review_comment`

---

### Local Review Storage Commands

#### `cmd_local_start_review(...) -> Result<ReviewMetadata, String>`
**Purpose:** Initiates a new local draft review stored in SQLite  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification
- `commit_id` - SHA of commit being reviewed
- `body` - Optional overall review comment

**Returns:** `ReviewMetadata` with creation timestamp and log file index  
**Side Effects:**  
- Inserts row into `reviews` SQLite table
- Creates log file in `{app_data}/review_logs/{owner}-{repo}-{pr_number}.log`
- If review already exists, returns existing metadata

**Dependencies:** `review_storage::get_storage()`, `ReviewStorage::start_review()`

---

#### `cmd_local_add_comment(...) -> Result<ReviewComment, String>`
**Purpose:** Adds a comment to local draft review  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification
- `file_path` - Path to file within repository
- `line_number` - Line number of comment
- `side` - "LEFT" or "RIGHT"
- `body` - Comment text
- `commit_id` - Commit SHA

**Returns:** `ReviewComment` with auto-generated `id` field  
**Side Effects:**  
- Inserts into `review_comments` SQLite table
- Appends formatted comment to log file

**Dependencies:** `review_storage::ReviewStorage::add_comment()`

---

#### `cmd_local_update_comment(comment_id: i64, body: String) -> Result<ReviewComment, String>`
**Purpose:** Updates text of a local draft comment  
**Parameters:**  
- `comment_id` - Database ID of comment
- `body` - New comment text

**Returns:** Updated `ReviewComment`  
**Side Effects:**  
- Updates SQLite row
- Regenerates entire log file to reflect changes

**Dependencies:** `review_storage::ReviewStorage::update_comment()`

---

#### `cmd_local_delete_comment(comment_id: i64) -> Result<(), String>`
**Purpose:** Deletes a local draft comment  
**Parameters:**  
- `comment_id` - Database ID

**Returns:** `()`  
**Side Effects:**  
- Deletes SQLite row
- Regenerates log file without the deleted comment

**Dependencies:** `review_storage::ReviewStorage::delete_comment()`

---

#### `cmd_local_get_comments(owner: String, repo: String, pr_number: u64) -> Result<Vec<ReviewComment>, String>`
**Purpose:** Retrieves all comments for a draft review  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification

**Returns:** Vector of `ReviewComment` sorted by file path and line number  
**Side Effects:** None (read-only query)  
**Dependencies:** `review_storage::ReviewStorage::get_comments()`

---

#### `cmd_local_get_review_metadata(owner: String, repo: String, pr_number: u64) -> Result<Option<ReviewMetadata>, String>`
**Purpose:** Retrieves metadata for a draft review if it exists  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification

**Returns:** `Some(ReviewMetadata)` if review exists, `None` otherwise  
**Side Effects:** None  
**Dependencies:** `review_storage::ReviewStorage::get_review_metadata()`

---

#### `cmd_local_abandon_review(owner: String, repo: String, pr_number: u64) -> Result<(), String>`
**Purpose:** Abandons a draft review, preserving log file for manual submission  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification

**Returns:** `()`  
**Side Effects:**  
- Deletes all review data from SQLite
- Prepends "ABANDONED" header to log file
- Next review for this PR will create a new log file with `-1` suffix

**Dependencies:** `review_storage::ReviewStorage::abandon_review()`

---

#### `cmd_local_clear_review(...) -> Result<(), String>`
**Purpose:** Silently removes review from database without modifying log file  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification
- `pr_title` - Optional PR title for log file annotation

**Returns:** `()`  
**Side Effects:**  
- Deletes review and all comments from SQLite
- Log file remains unchanged
- Used internally after successful submission

**Dependencies:** `review_storage::ReviewStorage::clear_review()`

---

#### `cmd_submit_local_review(owner: String, repo: String, pr_number: u64, event: Option<String>, body: Option<String>) -> Result<(), String>`
**Purpose:** Submits all local draft comments to GitHub as a single review  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification
- `event` - "APPROVE", "REQUEST_CHANGES", "COMMENT", or empty
- `body` - Final review summary (overrides metadata body if provided)

**Returns:** `()`  
**Exceptions:** Returns error if no pending review found  
**Side Effects:**  
- Creates GitHub review with all comments in single API call
- On success, deletes successfully posted comments from SQLite
- If all comments posted, clears review metadata
- Log file preserved regardless of outcome

**Dependencies:** `auth::submit_review_with_comments`, `review_storage`

---

### Utility Commands

#### `cmd_fetch_file_content(owner: String, repo: String, reference: String, path: String) -> Result<String, String>`
**Purpose:** Fetches raw file content from GitHub repository for a specific commit  
**Parameters:**  
- `owner`, `repo` - Repository identification
- `reference` - Commit SHA or branch name
- `path` - File path within repository

**Returns:** Base64-encoded file content as string  
**Side Effects:** GET request to `/repos/{owner}/{repo}/contents/{path}?ref={reference}`  
**Dependencies:** `auth::require_token`, `github::fetch_file_content`

---

#### `cmd_get_pending_review_comments(...) -> Result<Vec<PullRequestComment>, String>`
**Purpose:** Retrieves comments belonging to a specific pending review  
**Parameters:**  
- `owner`, `repo`, `pr_number` - PR identification
- `review_id` - ID of review
- `current_login` - Username for marking own comments

**Returns:** Vector of `PullRequestComment`  
**Side Effects:** GET request to GitHub API  
**Dependencies:** `auth::require_token`, `github::get_pending_review_comments`

---

#### `cmd_get_storage_info(app: tauri::AppHandle) -> Result<String, String>`
**Purpose:** Returns diagnostic information about storage locations  
**Parameters:**  
- `app` - Tauri app handle

**Returns:** Formatted string with directory paths and existence checks  
**Side Effects:** None (read-only file system checks)  
**Dependencies:** Tauri app path resolver

---

#### `cmd_open_devtools(window: tauri::WebviewWindow) -> Result<(), String>`
**Purpose:** Opens browser devtools for debugging (debug builds only)  
**Parameters:**  
- `window` - Current webview window

**Returns:** `()` in debug builds, error in release builds  
**Side Effects:** Opens devtools panel in debug configuration  
**Dependencies:** Tauri window API

---

#### `cmd_open_log_folder(app: tauri::AppHandle) -> Result<(), String>`
**Purpose:** Opens the review logs directory in the system's default file explorer  
**Parameters:**  
- `app` - Tauri application handle for accessing app data directory

**Returns:** `()` on success, error string on failure  
**Side Effects:**  
- Creates `review_logs` directory if it doesn't exist
- Opens directory in system file explorer (Finder on macOS, Explorer on Windows, default file manager on Linux)
- Uses `open` crate to handle platform-specific file manager launching

**Dependencies:** Tauri app path resolver, `open` crate, `std::fs`

**Usage:** Called from frontend user menu "Open Log Folder" option to provide quick access to review log files for debugging and manual recovery

---

## Data Structures

### `SubmitFileCommentArgs`
**Purpose:** Strongly-typed deserialization target for file comment submission  
**Fields:**  
- `owner`, `repo`, `number` - PR identification
- `path` - File path
- `body` - Comment text
- `commit_id` - Commit SHA
- `line`, `side`, `subject_type` - Comment positioning (optional)
- `mode` - "single" or "review"
- `pending_review_id` - For "review" mode (optional)

**Attributes:**  
- `#[derive(Deserialize)]`
- `#[serde(rename_all = "camelCase")]` - Converts field names from snake_case to camelCase for JS interop
- `#[serde(alias = "...")]` - Accepts both camelCase and snake_case variants

---

*Last generated: 2025-11-03*
