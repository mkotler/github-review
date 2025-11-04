# app/src-tauri/src/github.rs

**Path:** `app/src-tauri/src/github.rs`

**Last Updated:** January 2025

**Lines of Code:** 1151

## Capabilities Provided

This module implements a comprehensive GitHub REST API client that serves as the primary integration point for all GitHub operations. It handles authenticated HTTP communication with the GitHub API, providing functions for pull request management, review operations, comment handling, and file content retrieval. The module includes sophisticated error handling with SSO (Single Sign-On) detection, OAuth scope validation, and detailed logging. It supports both single-comment and review-based commenting workflows, manages pending reviews, and provides filtering for supported file types (Markdown and YAML). The module also includes rate limiting awareness, pagination support, and automatic file language detection.

## Functions and Classes

### build_client

**Purpose:** Constructs an authenticated HTTP client with required GitHub API headers.

**Parameters:**
- `token: &str` - GitHub OAuth access token for authentication

**Returns:** `AppResult<reqwest::Client>` - Configured HTTP client with authorization and API version headers

**Side Effects:** None

**Exceptions:**
- `AppError::MissingConfig` - If the token contains invalid characters
- Propagates reqwest client build errors

**Dependencies:** reqwest, HeaderMap, HeaderValue

---

### ensure_success

**Purpose:** Validates HTTP responses and converts errors into structured AppError types with detailed context.

**Parameters:**
- `response: reqwest::Response` - HTTP response to validate
- `context: &str` - Descriptive context for error messages

**Returns:** `AppResult<reqwest::Response>` - Original response if successful

**Side Effects:** Logs warnings to the tracing system for all error conditions

**Exceptions:**
- `AppError::SsoAuthorizationRequired` - When GitHub SSO reauthorization is needed (403 with x-github-sso header)
- `AppError::Api` - For all other HTTP errors with detailed messages including OAuth scope information

**Dependencies:** tracing::warn, parse_sso_header, GitHubApiError

---

### parse_sso_header

**Purpose:** Extracts organization name and authorization URL from GitHub's SSO header.

**Parameters:**
- `header: &HeaderValue` - The x-github-sso HTTP header value

**Returns:** `Option<SsoHeaderInfo>` - Parsed organization and authorization URL if present

**Side Effects:** None

**Exceptions:** Returns None if header is malformed or missing required fields

**Dependencies:** None

---

### fetch_authenticated_user

**Purpose:** Retrieves the currently authenticated user's profile information from GitHub.

**Parameters:**
- `token: &str` - GitHub OAuth access token

**Returns:** `AppResult<GitHubUser>` - User login and avatar URL

**Side Effects:** Makes HTTP GET request to /user endpoint

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** build_client, ensure_success

---

### list_pull_requests

**Purpose:** Fetches a list of pull requests for a repository with optional state filtering.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner username or organization
- `repo: &str` - Repository name
- `state: Option<&str>` - Filter by state ("open", "closed", "all"), defaults to "open"

**Returns:** `AppResult<Vec<PullRequestSummary>>` - List of PRs with number, title, author, updated timestamp, and head branch

**Side Effects:**
- Makes HTTP GET request to /repos/{owner}/{repo}/pulls
- Fetches up to 30 results per page

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** build_client, ensure_success, GitHubPullRequest deserialization

---

### get_pull_request

**Purpose:** Retrieves comprehensive pull request details with file metadata only (no content for performance).

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `current_login: Option<&str>` - Currently authenticated user's login for filtering "my comments"

**Returns:** `AppResult<PullRequestDetail>` - Complete PR data including file metadata (paths, status, additions/deletions), all comments, reviews, and user-specific filtering. File head_content and base_content are set to None.

**Side Effects:**
- Makes HTTP requests for: PR details, file list (paginated 100 per page), review comments, issue comments, reviews
- Logs warnings with current_login context
- Filters files by supported extensions (.md, .markdown, .yaml, .yml)
- Does NOT fetch file contents upfront for performance (contents fetched on-demand via get_file_contents)

**Exceptions:** Propagates network and API errors from any of the API calls

**Dependencies:** build_client, ensure_success, fetch_review_comments, fetch_issue_comments, fetch_pull_request_reviews, is_supported, detect_language, build_comments, build_reviews

---

### get_file_contents

**Purpose:** Fetches file contents on-demand for a specific file at given commit SHAs (lazy loading for performance).

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `file_path: &str` - Path to the file
- `base_sha: &str` - Base commit SHA
- `head_sha: &str` - Head commit SHA
- `status: &str` - File status ("added", "modified", "removed")

**Returns:** `AppResult<(Option<String>, Option<String>)>` - Tuple of (head_content, base_content). Returns None for removed (no head) or added (no base) files.

**Side Effects:**
- Makes HTTP requests to fetch file contents only when called
- Calls fetch_file_contents for head and/or base content based on status

**Exceptions:** Propagates network and API errors from fetch_file_contents

**Dependencies:** build_client, fetch_file_contents

---

### fetch_file_contents

**Purpose:** Retrieves the raw text content of a file at a specific commit reference.

**Parameters:**
- `client: &reqwest::Client` - Pre-configured authenticated HTTP client
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `path: &str` - File path within repository
- `reference: &str` - Git reference (commit SHA, branch, or tag)

**Returns:** `AppResult<String>` - Raw file content as text

**Side Effects:** Makes HTTP GET request to /repos/{owner}/{repo}/contents/{path} with Accept header for raw content

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** ensure_success

---

### fetch_review_comments

**Purpose:** Retrieves all review comments (file-specific) for a pull request.

**Parameters:**
- `client: &reqwest::Client` - Pre-configured authenticated HTTP client
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number

**Returns:** `AppResult<Vec<GitHubReviewComment>>` - List of review comments with line numbers, paths, and pending state

**Side Effects:**
- Makes HTTP GET request to /repos/{owner}/{repo}/pulls/{number}/comments
- Logs comment count and details to stderr (eprintln)
- Fetches up to 100 comments per page

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** ensure_success, GitHubReviewComment deserialization

---

### fetch_pending_review_comments

**Purpose:** Retrieves comments associated with a specific pending review.

**Parameters:**
- `client: &reqwest::Client` - Pre-configured authenticated HTTP client
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `review_id: u64` - Review ID to fetch comments for

**Returns:** `AppResult<Vec<GitHubReviewComment>>` - List of comments attached to the specified review

**Side Effects:**
- Makes HTTP GET request to /repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/comments
- Logs comment count and details to stderr
- Fetches up to 100 comments per page

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** ensure_success, GitHubReviewComment deserialization

---

### get_pending_review_comments

**Purpose:** Public wrapper for fetching pending review comments with ownership mapping.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `review_id: u64` - Review ID
- `current_login: Option<&str>` - Currently authenticated user's login

**Returns:** `AppResult<Vec<PullRequestComment>>` - Mapped comments with is_mine flag set appropriately

**Side Effects:** Makes HTTP requests through fetch_pending_review_comments

**Exceptions:** Propagates network and API errors

**Dependencies:** build_client, fetch_pending_review_comments, map_review_comment

---

### fetch_issue_comments

**Purpose:** Retrieves general conversation comments (not file-specific) from a pull request.

**Parameters:**
- `client: &reqwest::Client` - Pre-configured authenticated HTTP client
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number

**Returns:** `AppResult<Vec<GitHubIssueComment>>` - List of general conversation comments

**Side Effects:**
- Makes HTTP GET request to /repos/{owner}/{repo}/issues/{number}/comments
- Fetches up to 100 comments per page

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** ensure_success, GitHubIssueComment deserialization

---

### fetch_pull_request_reviews

**Purpose:** Retrieves all submitted reviews for a pull request.

**Parameters:**
- `client: &reqwest::Client` - Pre-configured authenticated HTTP client
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number

**Returns:** `AppResult<Vec<GitHubPullRequestReview>>` - List of reviews with state (APPROVED, CHANGES_REQUESTED, COMMENTED, PENDING)

**Side Effects:**
- Makes HTTP GET request to /repos/{owner}/{repo}/pulls/{number}/reviews
- Fetches up to 100 reviews per page

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** ensure_success, GitHubPullRequestReview deserialization

---

### submit_general_comment

**Purpose:** Posts a general review comment (not file-specific) to a pull request.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `body: &str` - Comment text content

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:** Makes HTTP POST request to /repos/{owner}/{repo}/pulls/{number}/reviews with event "COMMENT"

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** build_client, ensure_success

---

### create_pending_review

**Purpose:** Creates or reuses a pending review for attaching file comments before submission.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `commit_id: Option<&str>` - Optional commit SHA to pin review to specific commit
- `_body: Option<&str>` - Unused parameter (reserved for future use)
- `_current_login: Option<&str>` - Unused parameter (login is fetched from token)

**Returns:** `AppResult<PullRequestReview>` - The created or existing pending review with ID, state, and ownership information

**Side Effects:**
- Fetches authenticated user via fetch_authenticated_user
- Fetches existing reviews via fetch_pull_request_reviews
- Reuses existing pending review if found (GitHub allows only one pending review per user)
- Creates new pending review if none exists
- Logs detailed warnings about authentication, existing reviews, and payload

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** build_client, fetch_authenticated_user, fetch_pull_request_reviews, map_review, ensure_success

---

### submit_pending_review

**Purpose:** Submits a pending review with a final state and optional summary comment.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `review_id: u64` - ID of the pending review to submit
- `event: &str` - Review event type ("APPROVE", "REQUEST_CHANGES", or "COMMENT")
- `body: Option<&str>` - Optional summary comment for the review

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:** Makes HTTP POST request to /repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/events

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** build_client, ensure_success

---

### submit_file_comment

**Purpose:** Posts a comment on a specific file and line in a pull request, either as a single comment or attached to a pending review.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `path: &str` - File path within the repository
- `body: &str` - Comment text content
- `commit_id: &str` - Commit SHA to attach comment to
- `line: Option<u64>` - Line number for line-specific comments
- `side: Option<&str>` - Which side of the diff ("LEFT" or "RIGHT"), defaults to "RIGHT"
- `subject_type: Option<&str>` - "file" for file-level comments, None for line-specific
- `mode: CommentMode` - Single (immediate) or Review (attached to pending review)
- `pending_review_id: Option<u64>` - Required for Review mode, ID of pending review to attach to

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- For Single mode: Makes HTTP POST request to /repos/{owner}/{repo}/pulls/{number}/comments
- For Review mode: Makes HTTP POST request to /repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/comments

**Exceptions:**
- `AppError::Api` - If neither line nor subject_type is provided
- `AppError::Api` - If attempting Review mode with file-level comment (GitHub API limitation)
- `AppError::Api` - If Review mode is used without pending_review_id
- Propagates network and API errors through ensure_success

**Dependencies:** build_client, ensure_success, CommentMode

---

### update_review_comment

**Purpose:** Edits the body text of an existing review comment.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `comment_id: u64` - ID of the comment to update
- `body: &str` - New comment text content

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:** Makes HTTP PATCH request to /repos/{owner}/{repo}/pulls/comments/{comment_id}

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** build_client, ensure_success

---

### delete_review_comment

**Purpose:** Permanently deletes a review comment from a pull request.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `comment_id: u64` - ID of the comment to delete

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:** Makes HTTP DELETE request to /repos/{owner}/{repo}/pulls/comments/{comment_id}

**Exceptions:** Propagates network and API errors through ensure_success

**Dependencies:** build_client, ensure_success

---

### create_review_with_comments

**Purpose:** Bulk submits multiple file comments individually, continuing even if some fail, and returns successful IDs for cleanup.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `commit_id: &str` - Commit SHA to attach all comments to
- `_body: Option<&str>` - Unused parameter (reserved for future use)
- `_event: Option<&str>` - Unused parameter (reserved for future use)
- `comments: &[crate::review_storage::ReviewComment]` - Array of comments to submit

**Returns:** `AppResult<Vec<i64>>` - Vector of local storage IDs for successfully submitted comments

**Side Effects:**
- Makes multiple HTTP POST requests to /repos/{owner}/{repo}/pulls/{number}/comments (one per comment)
- Logs detailed warnings for each submission attempt (success/failure)
- Logs summary with succeeded/failed counts

**Exceptions:**
- `AppError::Api` - If any comments fail, returns detailed error message listing all failures and partial success count
- Returns Ok only if all comments succeed

**Dependencies:** build_client, ensure_success, crate::review_storage::ReviewComment

---

### fetch_file_content

**Purpose:** Retrieves base64-encoded file content from GitHub and returns it cleaned (whitespace removed) for the frontend AsyncImage component.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `reference: &str` - Git reference (commit SHA, branch, or tag)
- `path: &str` - File path within repository

**Returns:** `AppResult<String>` - Base64-encoded file content with whitespace removed

**Side Effects:**
- Makes HTTP GET request to /repos/{owner}/{repo}/contents/{path}
- Logs warnings with request parameters, response status, and success/failure details

**Exceptions:**
- `AppError::Api` - If response status is not success, with status code and error body
- `AppError::Api` - If response JSON doesn't contain "content" field
- Propagates JSON parsing errors

**Dependencies:** build_client

---

### delete_review

**Purpose:** Permanently deletes a pending review and all its attached comments.

**Parameters:**
- `token: &str` - GitHub OAuth access token
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `number: u64` - Pull request number
- `review_id: u64` - ID of the review to delete

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- Makes HTTP DELETE request to /repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}
- Logs warnings before and after deletion

**Exceptions:**
- Only pending reviews can be deleted (GitHub API constraint)
- Propagates network and API errors through ensure_success

**Dependencies:** build_client, ensure_success

---

### build_comments

**Purpose:** Merges review comments and issue comments into a unified, sorted list with ownership flags.

**Parameters:**
- `current_login: Option<&str>` - Currently authenticated user's login for filtering
- `review_comments: &[GitHubReviewComment]` - File-specific comments
- `issue_comments: &[GitHubIssueComment]` - General conversation comments

**Returns:** `Vec<PullRequestComment>` - Combined and chronologically sorted comment list with is_mine flags

**Side Effects:** None (pure function)

**Exceptions:** None

**Dependencies:** map_review_comment, map_issue_comment

---

### build_reviews

**Purpose:** Transforms GitHub review API responses into application domain models with ownership information.

**Parameters:**
- `current_login: Option<&str>` - Currently authenticated user's login for filtering
- `reviews: &[GitHubPullRequestReview]` - Raw GitHub review objects

**Returns:** `Vec<PullRequestReview>` - Mapped reviews with is_mine flags

**Side Effects:** None (pure function)

**Exceptions:** None

**Dependencies:** map_review

---

### map_review

**Purpose:** Converts a single GitHub review object to application domain model with ownership determination.

**Parameters:**
- `review: &GitHubPullRequestReview` - Raw GitHub review object
- `normalized_login: Option<&str>` - Lowercase current user login for case-insensitive comparison

**Returns:** `PullRequestReview` - Domain model with is_mine flag

**Side Effects:** Logs warnings with comparison details for debugging ownership logic

**Exceptions:** None

**Dependencies:** None

---

### map_review_comment

**Purpose:** Converts a GitHub review comment to application domain model, detecting pending draft state.

**Parameters:**
- `comment: &GitHubReviewComment` - Raw GitHub review comment object
- `is_mine: bool` - Whether the comment belongs to the current user

**Returns:** `PullRequestComment` - Domain model with path, line, side, draft state, and review association

**Side Effects:** None (pure function)

**Exceptions:** None

**Dependencies:** None

---

### map_issue_comment

**Purpose:** Converts a GitHub issue comment to application domain model (for general conversation comments).

**Parameters:**
- `comment: &GitHubIssueComment` - Raw GitHub issue comment object
- `is_mine: bool` - Whether the comment belongs to the current user

**Returns:** `PullRequestComment` - Domain model with is_review_comment=false and no file/line information

**Side Effects:** None (pure function)

**Exceptions:** None

**Dependencies:** None

---

### is_supported

**Purpose:** Filters files by extension to determine if they should be fetched and displayed in the UI.

**Parameters:**
- `filename: &str` - File path/name to check

**Returns:** `bool` - True if file extension is in SUPPORTED_EXTENSIONS (.md, .markdown, .yaml, .yml)

**Side Effects:** None (pure function)

**Exceptions:** None

**Dependencies:** SUPPORTED_EXTENSIONS constant

---

### detect_language

**Purpose:** Determines the programming/markup language for a file based on extension for syntax highlighting.

**Parameters:**
- `filename: &str` - File path/name to analyze

**Returns:** `FileLanguage` - Either Yaml or Markdown enum variant

**Side Effects:** None (pure function)

**Exceptions:** None

**Dependencies:** FileLanguage enum from crate::models

---

## Data Structures

### CommentMode

**Purpose:** Enum controlling whether file comments are submitted immediately or attached to a pending review.

**Variants:**
- `Single` - Post comment immediately as a standalone review
- `Review` - Attach comment to existing pending review for batch submission

---

### SsoHeaderInfo

**Purpose:** Structured data extracted from GitHub's SSO authorization header.

**Fields:**
- `organization: Option<String>` - Organization requiring SSO authorization
- `authorization_url: Option<String>` - URL to authorize the OAuth app for SSO

---

### GitHubUser

**Purpose:** GitHub user profile information.

**Fields:**
- `login: String` - Username
- `avatar_url: Option<String>` - Profile picture URL

**Derives:** Debug, Deserialize

---

### GitHubPullRequest

**Purpose:** Pull request metadata from GitHub API.

**Fields:**
- `number: u64` - PR number
- `title: String` - PR title
- `body: Option<String>` - PR description
- `updated_at: String` - ISO 8601 timestamp
- `head: GitRef` - Head branch/commit reference
- `base: GitRef` - Base branch/commit reference
- `user: GitHubUser` - PR author

**Derives:** Debug, Deserialize

---

### GitRef

**Purpose:** Git reference (branch or commit) information.

**Fields:**
- `sha: String` - Commit SHA hash
- `r#ref: String` - Branch or tag name (using raw identifier for 'ref' keyword)

**Derives:** Debug, Deserialize

---

### GitHubPullRequestFile

**Purpose:** File change metadata from pull request.

**Fields:**
- `filename: String` - File path
- `status: String` - Change type ("added", "modified", "removed", "renamed")
- `additions: u32` - Lines added count
- `deletions: u32` - Lines deleted count
- `patch: Option<String>` - Unified diff patch

**Derives:** Debug, Deserialize

---

### GitHubApiError

**Purpose:** Structured error response from GitHub API.

**Fields:**
- `message: Option<String>` - Human-readable error message
- `documentation_url: Option<String>` - Link to API documentation for the error

**Derives:** Debug, Deserialize

---

### GitHubReviewComment

**Purpose:** File-specific comment on a pull request with line positioning.

**Fields:**
- `id: u64` - Comment ID
- `body: String` - Comment text
- `path: String` - File path
- `line: Option<u64>` - Current line number
- `original_line: Option<u64>` - Original line number before changes
- `side: Option<String>` - "LEFT" or "RIGHT" side of diff
- `user: GitHubUser` - Comment author
- `html_url: String` - Web URL to comment
- `state: Option<String>` - "PENDING" for draft comments
- `created_at: String` - ISO 8601 timestamp
- `pull_request_review_id: Option<u64>` - Associated review ID if part of a review

**Derives:** Debug, Deserialize

---

### GitHubIssueComment

**Purpose:** General conversation comment (not file-specific) on a pull request.

**Fields:**
- `id: u64` - Comment ID
- `body: String` - Comment text
- `user: GitHubUser` - Comment author
- `html_url: String` - Web URL to comment
- `created_at: String` - ISO 8601 timestamp

**Derives:** Debug, Deserialize

---

### GitHubPullRequestReview

**Purpose:** Review submission with overall verdict and optional summary.

**Fields:**
- `id: u64` - Review ID
- `state: String` - "APPROVED", "CHANGES_REQUESTED", "COMMENTED", or "PENDING"
- `user: GitHubUser` - Reviewer
- `body: Option<String>` - Review summary comment
- `html_url: Option<String>` - Web URL to review
- `commit_id: Option<String>` - Commit SHA the review is pinned to
- `submitted_at: Option<String>` - ISO 8601 timestamp

**Derives:** Debug, Deserialize

---

## Constants

### API_BASE
**Value:** `"https://api.github.com"`
**Purpose:** Base URL for all GitHub REST API requests

### USER_AGENT_VALUE
**Value:** `"github-review-app/0.1"`
**Purpose:** User-Agent header value for GitHub API requests (required by GitHub)

### API_VERSION_HEADER
**Value:** `"x-github-api-version"`
**Purpose:** Header name for specifying GitHub API version

### API_VERSION_VALUE
**Value:** `"2022-11-28"`
**Purpose:** GitHub API version to use for consistent response formats

### SUPPORTED_EXTENSIONS
**Value:** `[".md", ".markdown", ".yaml", ".yml"]`
**Purpose:** File extensions that will be fetched and displayed in the application
