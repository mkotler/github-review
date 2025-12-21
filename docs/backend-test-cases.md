# Backend Test Cases (Rust)

**Module:** `app/src-tauri/src/`  
**Test Type:** Unit + Integration  
**Target Coverage:** 80%+  

---

## Category 1: Error Handling (`error.rs`)

### Test Case 1.1: Convert Reqwest Error to AppError
**Description:** When a network request fails with reqwest error, it should convert to AppError with descriptive message  
**Input:** `reqwest::Error` from connection timeout  
**Expected Result:** `AppError::NetworkError("Connection timeout after 30s")`

### Test Case 1.2: Convert Serde JSON Error to AppError
**Description:** When JSON parsing fails, convert to AppError  
**Input:** `serde_json::Error` from malformed JSON  
**Expected Result:** `AppError::ParseError("Invalid JSON: expected value at line 1")`

### Test Case 1.3: Convert IO Error to AppError
**Description:** When file operations fail, convert to AppError  
**Input:** `std::io::Error` from permission denied  
**Expected Result:** `AppError::StorageError("Permission denied: /path/to/file")`

### Test Case 1.4: Convert Rusqlite Error to AppError
**Description:** When database operations fail, convert to AppError  
**Input:** `rusqlite::Error` from constraint violation  
**Expected Result:** `AppError::DatabaseError("Foreign key constraint failed")`

---

## Category 2: Data Models (`models.rs`)

### Test Case 2.1: Deserialize GitHub User
**Description:** Parse GitHub user JSON into User struct  
**Input:** `{"login": "octocat", "id": 1, "avatar_url": "https://..."}`  
**Expected Result:** `User { login: "octocat", id: 1, avatar_url: Some("https://...") }`

### Test Case 2.2: Deserialize Pull Request with Null Fields
**Description:** Handle optional fields in PR response  
**Input:** PR JSON with `null` for `merged_at`, `closed_at`  
**Expected Result:** `PullRequest { merged_at: None, closed_at: None, ... }`

### Test Case 2.3: Deserialize Review Comment with Line Number
**Description:** Parse comment with line position  
**Input:** Comment JSON with `"line": 42, "side": "RIGHT"`  
**Expected Result:** `PullRequestComment { line: Some(42), side: Some("RIGHT"), ... }`

### Test Case 2.4: Deserialize File-Level Comment (No Line)
**Description:** Parse comment without line number (file-level)  
**Input:** Comment JSON with `"line": null, "subject_type": "file"`  
**Expected Result:** `PullRequestComment { line: None, subject_type: Some("file"), ... }`

### Test Case 2.5: Validate Commit SHA Format
**Description:** Reject invalid commit SHA  
**Input:** `"not-a-valid-sha"`  
**Expected Result:** Deserialization error (SHA must be 40 hex chars)

---

## Category 3: Diff Parsing (`github.rs`)

### Test Case 3.1: Parse Simple Unified Diff Header
**Description:** Extract line numbers from unified diff header  
**Input:** `@@ -10,7 +10,8 @@`  
**Expected Result:** `{ old_start: 10, old_count: 7, new_start: 10, new_count: 8 }`

### Test Case 3.2: Parse Diff Header with No Context
**Description:** Handle diff with zero context lines  
**Input:** `@@ -5,1 +5,1 @@`  
**Expected Result:** `{ old_start: 5, old_count: 1, new_start: 5, new_count: 1 }`

### Test Case 3.3: Convert Diff Position to Line Number (RIGHT Side)
**Description:** Map GitHub position field to absolute line number on new side  
**Input:** Position 15 in diff starting at line 100  
**Expected Result:** Line 107 (accounting for diff chunks)

### Test Case 3.4: Convert Diff Position to Line Number (LEFT Side)
**Description:** Map position to old line number  
**Input:** Position 10 in diff, LEFT side  
**Expected Result:** Old line 105

### Test Case 3.5: Handle Position Outside Diff Range
**Description:** Return None for position beyond diff  
**Input:** Position 999 when diff only has 50 lines  
**Expected Result:** `None`

### Test Case 3.6: Parse Multi-Chunk Diff
**Description:** Handle diff with multiple @@ headers  
**Input:** Diff with 3 separate chunks  
**Expected Result:** Correctly map positions in each chunk

---

## Category 4: GitHub API Client (`github.rs` - Mocked HTTP)

### Test Case 4.1: Fetch Pull Request - Success
**Description:** GET /repos/:owner/:repo/pulls/:number returns PR details  
**Input:** Valid owner, repo, PR number  
**Mock Response:** 200 OK with PR JSON  
**Expected Result:** `Ok(PullRequest { ... })`

### Test Case 4.2: Fetch Pull Request - 404 Not Found
**Description:** Handle PR doesn't exist  
**Input:** Non-existent PR number  
**Mock Response:** 404 Not Found  
**Expected Result:** `Err(AppError::NotFound("Pull request #999 not found"))`

### Test Case 4.3: Fetch Pull Request - 401 Unauthorized
**Description:** Handle invalid token  
**Input:** Expired or invalid GitHub token  
**Mock Response:** 401 Unauthorized  
**Expected Result:** `Err(AppError::Unauthorized("Invalid authentication token"))`

### Test Case 4.4: Fetch Pull Requests List - Pagination
**Description:** Fetch multiple pages of PRs  
**Input:** Repo with 250 PRs (3 pages at 100/page)  
**Mock Response:** 3 paginated responses with `Link` header  
**Expected Result:** Vec with all 250 PRs

### Test Case 4.5: Fetch File Contents - Base64 Decoding
**Description:** Get file content and decode from base64  
**Input:** File with `"encoding": "base64"`, content = "SGVsbG8="  
**Mock Response:** 200 OK with base64 content  
**Expected Result:** `Ok("Hello")` (decoded)

### Test Case 4.6: Fetch Comments - Empty List
**Description:** Handle PR with no comments  
**Input:** PR #1 with no comments  
**Mock Response:** 200 OK with `[]`  
**Expected Result:** `Ok(vec![])`

---

## Category 5: Rate Limiting (`github.rs`)

### Test Case 5.1: Detect Rate Limit from 403 Response
**Description:** Parse rate limit error from GitHub response  
**Input:** 403 Forbidden with `X-RateLimit-Remaining: 0`  
**Mock Response:** 403 with rate limit headers  
**Expected Result:** `Err(AppError::RateLimited("Rate limit exceeded, resets at ..."))`

### Test Case 5.2: Respect Retry-After Header
**Description:** Parse Retry-After and delay next request  
**Input:** 429 with `Retry-After: 60`  
**Mock Response:** 429 Too Many Requests  
**Expected Result:** Error contains retry time, next request delayed 60s

### Test Case 5.3: Rate Limit Not Triggered with Remaining Requests
**Description:** Successful request when rate limit not hit  
**Input:** Normal request  
**Mock Response:** 200 OK with `X-RateLimit-Remaining: 4500`  
**Expected Result:** `Ok(...)` (no rate limit error)

---

## Category 6: Comment Submission with Retry (`github.rs`)

### Test Case 6.1: Submit Single Comment - Success
**Description:** POST comment succeeds on first attempt  
**Input:** Comment body, file path, line, commit SHA  
**Mock Response:** 201 Created  
**Expected Result:** `Ok(CommentId(12345))`

### Test Case 6.2: Submit Comment - "Submitted Too Quickly" Error, Then Success
**Description:** First request returns 422 "submitted too quickly", retry succeeds  
**Input:** Comment data  
**Mock Responses:**  
  - Request 1: 422 with error `"was submitted too quickly"`  
  - Request 2: 201 Created  
**Expected Result:** `Ok(CommentId(12345))` after 1 retry with backoff

### Test Case 6.3: Submit Comment - "Submitted Too Quickly" Multiple Retries
**Description:** Multiple "too quickly" errors, eventually succeeds  
**Input:** Comment data  
**Mock Responses:**  
  - Requests 1-5: 422 "submitted too quickly"  
  - Request 6: 201 Created  
**Expected Result:** `Ok(CommentId(12345))` after 5 retries with exponential backoff

### Test Case 6.4: Submit Comment - "Submitted Too Quickly" Max Retries Exceeded
**Description:** Hit retry limit without success  
**Input:** Comment data  
**Mock Responses:** All 6+ requests return 422  
**Expected Result:** `Err(AppError::RetryExceeded("Failed after 6 attempts"))`

### Test Case 6.5: Submit Comment - Exponential Backoff Timing
**Description:** Verify backoff intervals increase exponentially  
**Input:** Comment data triggering retries  
**Expected Delays:**  
  - Retry 1: 1200ms base  
  - Retry 2: ~2400ms (base * 2)  
  - Retry 3: ~4800ms (base * 4)  
  - Retry 4: ~9600ms (base * 8)  
  - Retry 5: 20000ms (capped at max)

### Test Case 6.6: Submit Comment - Line Could Not Be Resolved Error
**Description:** Line comment fails with 422, should trigger file-level fallback  
**Input:** Comment with line 50 not in diff  
**Mock Responses:**  
  - Line comment: 422 "pull_request_review_thread.line: 50 could not be resolved"  
  - File comment: 201 Created  
**Expected Result:** `Ok(CommentId(12345))` with body prefixed `[Line 50]`

### Test Case 6.7: Submit File-Level Comment Fallback - Also Rate Limited
**Description:** File-level retry also hits "too quickly" error  
**Input:** Comment with unresolved line  
**Mock Responses:**  
  - Line comment: 422 "line...could not be resolved"  
  - File comment attempt 1: 422 "submitted too quickly"  
  - File comment attempt 2: 201 Created  
**Expected Result:** `Ok(CommentId(12345))` after fallback + retry

### Test Case 6.8: Submit Comment - PR Conversation Locked
**Description:** Cannot submit because PR is locked  
**Input:** Comment on locked PR  
**Mock Response:** 422 with error `"pull_request_review_thread.issue...is locked"`  
**Expected Result:** `Err(AppError::Locked("PR conversation is locked"))`

### Test Case 6.9: Submit Comment - Invalid Path Error
**Description:** File path doesn't exist in PR  
**Input:** Comment on non-existent file  
**Mock Response:** 422 with error `"path...is invalid"`  
**Expected Result:** `Err(AppError::ValidationError("File path is invalid"))`

### Test Case 6.10: Submit Comment - Outdated Commit SHA
**Description:** Commit SHA doesn't match PR head  
**Input:** Comment with old commit SHA  
**Mock Response:** 422 with error `"commit_id...is outdated"`  
**Expected Result:** `Err(AppError::ValidationError("Commit is outdated"))`

---

## Category 7: Batch Comment Submission (`github.rs`)

### Test Case 7.1: Submit Batch - All Succeed
**Description:** Submit 10 comments, all succeed  
**Input:** 10 comment payloads  
**Mock Responses:** All 201 Created  
**Expected Result:** `Ok(vec![CommentId(1), CommentId(2), ..., CommentId(10)])`

### Test Case 7.2: Submit Batch - Partial Success
**Description:** Some comments succeed, some fail  
**Input:** 5 comment payloads  
**Mock Responses:**  
  - Comments 1-3: 201 Created  
  - Comment 4: 422 "line could not be resolved"  
  - Comment 5: 201 Created (after fallback)  
**Expected Result:** `Ok(vec![CommentId(1), CommentId(2), CommentId(3), CommentId(5)])` with 4 succeeded

### Test Case 7.3: Submit Batch - Request Spacing
**Description:** Ensure minimum 1200ms between requests  
**Input:** 5 comments  
**Expected Behavior:** Measure time between requests ≥ 1200ms each

### Test Case 7.4: Submit Batch - Stop on PR Locked
**Description:** If PR becomes locked mid-batch, stop immediately  
**Input:** 10 comments  
**Mock Responses:**  
  - Comments 1-5: 201 Created  
  - Comment 6: 422 "is locked"  
  - Comments 7-10: Not attempted  
**Expected Result:** `Err(AppError::Locked(...))` with 5 succeeded IDs returned

### Test Case 7.5: Submit Batch - Progress Events Emitted
**Description:** Emit progress event after each comment  
**Input:** 3 comments  
**Expected Events:**  
  - Event 1: `{ current: 1, total: 3, file: "file1.ts" }`  
  - Event 2: `{ current: 2, total: 3, file: "file2.ts" }`  
  - Event 3: `{ current: 3, total: 3, file: "file3.ts" }`

---

## Category 8: OAuth Authentication (`auth.rs`)

### Test Case 8.1: PKCE Code Verifier Generation
**Description:** Generate random code verifier (43-128 chars)  
**Input:** None  
**Expected Result:** String with length in [43, 128], URL-safe base64

### Test Case 8.2: PKCE Code Challenge from Verifier
**Description:** Generate SHA256 challenge from verifier  
**Input:** Verifier = "test-verifier-12345"  
**Expected Result:** Base64url(SHA256("test-verifier-12345"))

### Test Case 8.3: OAuth Authorization URL Construction
**Description:** Build GitHub OAuth URL with PKCE  
**Input:** client_id, state, code_challenge  
**Expected Result:** URL = `https://github.com/login/oauth/authorize?client_id=...&redirect_uri=http://127.0.0.1:PORT&state=STATE&code_challenge=CHALLENGE&code_challenge_method=S256`

### Test Case 8.4: Local OAuth Server Starts and Binds
**Description:** Start HTTP server on random port  
**Input:** None  
**Expected Result:** Server listening on 127.0.0.1:PORT, returns port number

### Test Case 8.5: OAuth Callback with Valid Code
**Description:** Receive callback with authorization code  
**Input:** GET /?code=AUTH_CODE&state=STATE  
**Expected Result:** Server extracts code, returns to caller

### Test Case 8.6: OAuth Callback with Invalid State (CSRF Protection)
**Description:** Reject callback with mismatched state  
**Input:** GET /?code=CODE&state=WRONG_STATE  
**Expected Result:** Error "State mismatch, possible CSRF attack"

### Test Case 8.7: OAuth Callback Timeout
**Description:** No callback received within 180 seconds  
**Input:** Start server, wait 181s  
**Expected Result:** Error "OAuth flow timed out after 180 seconds"

### Test Case 8.8: Exchange Authorization Code for Token
**Description:** POST to GitHub with code, receive access token  
**Input:** Authorization code, code_verifier  
**Mock Response:** 200 OK `{"access_token": "gho_..."}`  
**Expected Result:** `Ok("gho_...")`

### Test Case 8.9: Token Exchange Failure
**Description:** GitHub rejects code exchange  
**Input:** Invalid authorization code  
**Mock Response:** 400 Bad Request  
**Expected Result:** Error "Failed to exchange code for token"

### Test Case 8.10: Verify Token with GitHub API
**Description:** GET /user to validate token  
**Input:** Access token  
**Mock Response:** 200 OK with user JSON  
**Expected Result:** `Ok(User { login: "octocat", ... })`

### Test Case 8.11: Token Expired During Verification
**Description:** Token no longer valid  
**Input:** Expired token  
**Mock Response:** 401 Unauthorized  
**Expected Result:** Error "Token is invalid or expired"

---

## Category 9: Keyring Storage (`storage.rs`)

### Test Case 9.1: Store Token in Keyring
**Description:** Save GitHub token to OS credential store  
**Input:** Token = "gho_test123"  
**Expected Result:** Token stored in keyring under service "github-review" (mock keyring)

### Test Case 9.2: Retrieve Token from Keyring
**Description:** Load saved token  
**Input:** None  
**Expected Result:** `Ok("gho_test123")` from keyring

### Test Case 9.3: Token Not Found in Keyring
**Description:** No token stored yet  
**Input:** None  
**Expected Result:** `Err(AppError::NotFound("No token stored"))`

### Test Case 9.4: Delete Token from Keyring
**Description:** Remove stored token  
**Input:** None  
**Expected Result:** Token removed, subsequent retrieval returns NotFound

---

## Category 10: Review Storage - SQLite (`review_storage.rs`)

### Test Case 10.1: Create New Review
**Description:** Insert review into database  
**Input:** `{ pr_number: 123, repo: "owner/repo", description: "Test review" }`  
**Expected Result:** Review created with auto-generated ID, created_at timestamp

### Test Case 10.2: Add Comment to Review
**Description:** Insert comment linked to review  
**Input:** Review ID, comment with file path, line, body  
**Expected Result:** Comment created with auto-generated ID, foreign key to review

### Test Case 10.3: List Comments for Review
**Description:** Query all comments in a review  
**Input:** Review ID = 1  
**Expected Result:** Vec of comments ordered by created_at

### Test Case 10.4: Update Review Description
**Description:** Modify existing review  
**Input:** Review ID = 1, new description  
**Expected Result:** Review updated, updated_at timestamp changed

### Test Case 10.5: Delete Review (Cascade Delete Comments)
**Description:** Remove review and all its comments  
**Input:** Review ID = 1 with 5 comments  
**Expected Result:** Review deleted, 5 comments also deleted (foreign key cascade)

### Test Case 10.6: Mark Comment as Submitted
**Description:** Update comment status after posting to GitHub  
**Input:** Comment ID = 10, GitHub comment ID = 54321  
**Expected Result:** Comment.github_comment_id = 54321, status = "submitted"

### Test Case 10.7: Query Pending Comments
**Description:** Get comments not yet submitted  
**Input:** Review with mix of submitted/pending comments  
**Expected Result:** Vec of comments where github_comment_id IS NULL

### Test Case 10.8: Create Review with Empty Comments List
**Description:** Review with no comments yet  
**Input:** Review metadata only  
**Expected Result:** Review created, comments list empty

### Test Case 10.9: Foreign Key Constraint Violation
**Description:** Try to add comment to non-existent review  
**Input:** Comment with review_id = 999 (doesn't exist)  
**Expected Result:** Error "Foreign key constraint failed"

### Test Case 10.10: Concurrent Review Creation
**Description:** Two reviews created simultaneously  
**Input:** Parallel inserts for same PR  
**Expected Result:** Both reviews created with different IDs, no race condition

---

## Category 11: Review Log File Generation (`review_storage.rs`)

### Test Case 11.1: Generate Log File for New Review
**Description:** Create log file when review is created  
**Input:** Review with 3 comments  
**Expected Result:** File `review_logs/owner-repo-123-1.log` created with formatted content

### Test Case 11.2: Log File Format - Header
**Description:** Log file starts with review metadata  
**Input:** Review { pr_number: 123, created_at: "2025-01-01" }  
**Expected Output:**
```
=================================
REVIEW FOR PR #123
Repository: owner/repo
Created: 2025-01-01 10:00:00
=================================
```

### Test Case 11.3: Log File Format - Comment Entry
**Description:** Each comment formatted correctly  
**Input:** Comment { file: "src/app.ts", line: 42, body: "Fix this" }  
**Expected Output:**
```
---
File: src/app.ts
Line: 42
Status: PENDING

Fix this
```

### Test Case 11.4: Log File Format - File-Level Comment
**Description:** Comment without line number  
**Input:** Comment { file: "readme.md", line: null, body: "Good doc" }  
**Expected Output:**
```
---
File: readme.md
Line: (file-level)
Status: PENDING

Good doc
```

### Test Case 11.5: Update Log File After Submission
**Description:** Mark comments as submitted in log  
**Input:** Comment submitted with GitHub ID 54321  
**Expected Output:**
```
Status: SUBMITTED (GitHub ID: 54321)
Submitted: 2025-01-01 10:05:00
```

### Test Case 11.6: Log File Collision - Auto Increment Index
**Description:** Create multiple logs for same PR  
**Input:** Second review for PR #123  
**Expected Result:** File `owner-repo-123-2.log` created (index incremented)

### Test Case 11.7: Log File for Local Directory Mode
**Description:** Use special repo name for local folders  
**Input:** Review for `__local__` repo  
**Expected Result:** File `__local__-123-1.log` created

---

## Category 12: Library Functions (`lib.rs`)

### Test Case 12.1: Tauri Command - Get Auth Status
**Description:** Frontend calls `cmd_get_auth_status`  
**Input:** None  
**Expected Result:** `{ authenticated: true, login: "octocat", is_offline: false }` if token valid

### Test Case 12.2: Tauri Command - List Pull Requests
**Description:** Frontend calls `cmd_list_pull_requests`  
**Input:** owner = "facebook", repo = "react"  
**Mock Response:** 200 OK with PR list  
**Expected Result:** Vec of PullRequest structs serialized to JSON

### Test Case 12.3: Tauri Command - Submit Comment Error Handling
**Description:** Command fails, error propagated to frontend  
**Input:** Invalid comment data  
**Expected Result:** Tauri IPC error with descriptive message

### Test Case 12.4: Tauri Event - Progress Emission
**Description:** Backend emits progress event during batch submit  
**Input:** Batch submission in progress  
**Expected Result:** Frontend receives `comment-submission-progress` event with payload

---

## Category 20: Pagination and Large Data Sets

### Test Case 20.1: Fetch All PRs - Multiple Pages
**Description:** Paginate through all PRs
**Mock:** 250 PRs total (3 pages of 100)
**Expected Result:** All 250 PRs returned, 3 API requests made

### Test Case 20.2: Fetch PR Files - Large PR
**Description:** PR with 150 files (2 pages)
**Mock:** 150 files across 2 pages
**Expected Result:** All 150 files fetched

### Test Case 20.3: Fetch PR Comments - Paginated
**Description:** PR with 200 comments
**Mock:** 200 comments (2 pages of 100)
**Expected Result:** All 200 comments returned

### Test Case 20.4: Empty Page - Stop Pagination
**Description:** Last page has 0 results
**Mock:** Page 1 has 100, page 2 has 0
**Expected Result:** Stop at page 1, don't request page 3

### Test Case 20.5: Partial Last Page - Detect End
**Description:** Last page has < 100 results
**Mock:** Page 1 has 100, page 2 has 30
**Expected Result:** Stop at page 2, return 130 total

### Test Case 20.6: Check Pending Review - File Count Query
**Description:** Optimize file count fetch (per_page=1)
**Mock:** PR with 50 files
**Expected Result:** First query with per_page=1, then per_page=100 for full list

### Test Case 20.7: Fetch Reviews - Multiple Users
**Description:** PR with reviews from 5 users
**Mock:** 15 reviews total
**Expected Result:** All 15 reviews fetched, pending reviews identified

### Test Case 20.8: Large Diff - Memory Efficiency
**Description:** Parse 10,000 line diff
**Input:** Large diff file
**Expected Result:** Parses without OOM, all hunks extracted

---

## Category 17: GitHub API Retry Logic with Exponential Backoff

### Test Case 17.1: Retry on Timeout - Success on Second Attempt
**Description:** Network timeout, retry succeeds
**Mock:** First request times out after 30s, second request succeeds
**Expected Result:** Request retried after 1s delay, returns data

### Test Case 17.2: Retry on Connection Failure - Exponential Backoff
**Description:** Connection failure with exponential backoff
**Mock:** 3 connection failures, 4th attempt succeeds
**Expected Result:** Retries with delays (1s, 2s, 4s), succeeds on 4th

### Test Case 17.3: Max Retries Exceeded - Return Error
**Description:** All retry attempts fail
**Mock:** 5 timeouts in a row
**Expected Result:** Error returned after 5th attempt, no more retries

### Test Case 17.4: 500 Server Error - Retry with Backoff
**Description:** Server error, retry succeeds
**Mock:** 500 error, then 200 OK
**Expected Result:** Retry after delay, success

### Test Case 17.5: 502 Bad Gateway - Transient Error Retry
**Description:** Gateway error, retry succeeds
**Mock:** 502 error twice, 200 on third
**Expected Result:** Two retries with backoff, success

### Test Case 17.6: 503 Service Unavailable - Exponential Backoff
**Description:** Service temporarily down
**Mock:** 503 three times, success on fourth
**Expected Result:** Exponential backoff (1s, 2s, 4s), then success

### Test Case 17.7: 429 Rate Limit - Wait and Retry
**Description:** Rate limited, wait for Retry-After
**Mock:** 429 with Retry-After: 60, then 200
**Expected Result:** Wait 60 seconds, retry succeeds

### Test Case 17.8: Network Error Detection - is_network_error()
**Description:** Distinguish network errors from API errors
**Mock:** Connection refused error
**Expected Result:** is_network_error() returns true, offline mode triggered

### Test Case 17.9: Timeout vs Rate Limit - Different Handling
**Description:** Timeout should retry, rate limit should respect Retry-After
**Mock:** Timeout error
**Expected Result:** Retry immediately (with backoff), not marked as offline

### Test Case 17.10: Non-Retryable Error - 4xx Client Error
**Description:** 401, 403, 404 should not retry
**Mock:** 404 Not Found
**Expected Result:** Error returned immediately, no retries

### Test Case 18.1: is_network_error() - Connection Refused
**Description:** Detect connection refused as network error
**Error:** reqwest::Error with kind = Connect
**Expected Result:** Returns true, offline mode triggered

### Test Case 18.2: is_network_error() - DNS Resolution Failure
**Description:** DNS lookup fails
**Error:** DNS resolution error
**Expected Result:** Returns true, offline mode activated

### Test Case 18.3: is_network_error() - Timeout
**Description:** Request times out
**Error:** reqwest timeout error
**Expected Result:** Returns true (network issue)

### Test Case 18.4: is_network_error() - 401 Unauthorized
**Description:** Authentication error is not a network error
**Error:** 401 HTTP status
**Expected Result:** Returns false (API error, not network)

### Test Case 18.5: Offline Mode - Use Cached Login
**Description:** Network down, use last_login from keyring
**Mock:** Network unavailable, cached login exists
**Expected Result:** AuthStatus with cached login, is_offline = true

### Test Case 18.6: Offline Mode - No Cache Available
**Description:** Network down, no cached login
**Mock:** Network unavailable, no cached login
**Expected Result:** Error "No cached authentication available"

### Test Case 18.7: Network Recovery - Detect Online
**Description:** Offline mode, then network recovers
**Mock:** Network error, then success
**Expected Result:** First request fails (offline), second succeeds (online)

### Test Case 18.8: Partial Offline - API Down, Auth Works
**Description:** GitHub API returns 500, auth still works
**Mock:** /user/repos returns 500, /user returns 200
**Expected Result:** Auth succeeds, repo fetch fails with API error (not network error)

---

## Category 19: GitHub API Edge Cases and Error Parsing

### Test Case 19.1: SSO Authorization Required - Extract URL
**Description:** Parse SSO authorization URL from header
**Response:** Header "x-github-sso: required; url=https://github.com/orgs/acme/sso?authorization_request=123"
**Expected Result:** AppError::SsoAuthorizationRequired("https://github.com/orgs/acme/sso?authorization_request=123")

### Test Case 19.2: SSO Header - Organization Extraction
**Description:** Parse organization from SSO URL
**Response:** SSO header with org "acme-corp"
**Expected Result:** Organization = "acme-corp"

### Test Case 19.3: Error Body Truncation - Long Response
**Description:** Truncate error body to 400 chars
**Response:** 5000 char error message
**Expected Result:** Error message truncated to 400 chars + "..."

### Test Case 19.4: Error Body Truncation - Log vs User
**Description:** Different truncation for logs (800) vs errors (400)
**Response:** 1000 char error
**Expected Result:** Log has 800 chars, user error has 400 chars

### Test Case 19.5: Empty Error Body - Status Only
**Description:** Error response with no body
**Response:** 500 status, empty body
**Expected Result:** Error message "failed with status 500"

### Test Case 19.6: JSON Error Parsing - GitHub Error Object
**Description:** Parse GitHub error JSON
**Response:** {"message": "Bad credentials", "documentation_url": "..."}
**Expected Result:** Error includes message from JSON

### Test Case 19.7: API Version Header - Always Set
**Description:** All requests include API version
**Expected Result:** Header "X-GitHub-Api-Version: 2022-11-28"

### Test Case 19.8: User-Agent Header - Custom Value
**Description:** Set custom User-Agent
**Expected Result:** Header "User-Agent: github-review-app"

### Test Case 19.9: Authorization Header - Bearer Token
**Description:** OAuth token in Authorization header
**Token:** "gho_test123"
**Expected Result:** Header "Authorization: Bearer gho_test123"

### Test Case 19.10: Accept Header - GitHub JSON Format
**Description:** Request GitHub JSON format
**Expected Result:** Header "Accept: application/vnd.github+json"

---

## Category 20: Pagination and Large Data Sets

### Test Case 20.1: Fetch All PRs - Multiple Pages
**Description:** Paginate through all PRs
**Mock:** 250 PRs total (3 pages of 100)
**Expected Result:** All 250 PRs returned, 3 API requests made

### Test Case 20.2: Fetch PR Files - Large PR
**Description:** PR with 150 files (2 pages)
**Mock:** 150 files across 2 pages
**Expected Result:** All 150 files fetched

### Test Case 20.3: Fetch PR Comments - Paginated
**Description:** PR with 200 comments
**Mock:** 200 comments (2 pages of 100)
**Expected Result:** All 200 comments returned

### Test Case 20.4: Empty Page - Stop Pagination
**Description:** Last page has 0 results
**Mock:** Page 1 has 100, page 2 has 0
**Expected Result:** Stop at page 1, don't request page 3

### Test Case 20.5: Partial Last Page - Detect End
**Description:** Last page has < 100 results
**Mock:** Page 1 has 100, page 2 has 30
**Expected Result:** Stop at page 2, return 130 total

### Test Case 20.6: Check Pending Review - File Count Query
**Description:** Optimize file count fetch (per_page=1)
**Mock:** PR with 50 files
**Expected Result:** First query with per_page=1, then per_page=100 for full list

### Test Case 20.7: Fetch Reviews - Multiple Users
**Description:** PR with reviews from 5 users
**Mock:** 15 reviews total
**Expected Result:** All 15 reviews fetched, pending reviews identified

### Test Case 20.8: Large Diff - Memory Efficiency
**Description:** Parse 10,000 line diff
**Input:** Large diff file
**Expected Result:** Parses without OOM, all hunks extracted

---

## Category 13: Local Directory Mode (`lib.rs`)

### Test Case 13.1: Load Local Directory - Valid Path
**Description:** Load markdown files from local folder
**Input:** Directory path with 5 markdown files
**Expected Result:** PullRequestDetail with 5 files, SHA = "LOCAL-{hash}", number = 1

### Test Case 13.2: Load Local Directory - Nested Folders
**Description:** Recursively find markdown files in subdirectories
**Input:** Directory with `docs/guides/` containing 3 .md files
**Expected Result:** All 3 files found with relative paths `docs/guides/file1.md`, etc.

### Test Case 13.3: Load Local Directory - Multiple Extensions
**Description:** Find .md, .markdown, .mdx files
**Input:** Directory with test.md, test.markdown, test.mdx
**Expected Result:** All 3 files loaded

### Test Case 13.4: Load Local Directory - Non-Existent Path
**Description:** Handle invalid directory
**Input:** Path that doesn't exist
**Expected Result:** Error "Local directory does not exist: {path}"

### Test Case 13.5: Load Local Directory - File Instead of Directory
**Description:** Handle path to file instead of folder
**Input:** Path to single file
**Expected Result:** Error "Local path is not a directory"

### Test Case 13.6: Load Local Directory - Relative Path Resolution
**Description:** Resolve relative paths in dev mode
**Input:** Relative path "../docs"
**Expected Result:** Resolves to absolute path, loads files

### Test Case 13.7: Collect Markdown Files - Ignore Non-Markdown
**Description:** Only include markdown extensions
**Input:** Directory with .md, .txt, .pdf, .docx files
**Expected Result:** Only .md files in result

---

## Category 14: Review Deletion and Pending Reviews

### Test Case 14.1: Delete Review - Success
**Description:** Delete pending review from GitHub
**Input:** Review ID = 12345
**Mock:** DELETE request returns 204 No Content
**Expected Result:** `Ok(())`

### Test Case 14.2: Delete Review - Not Found
**Description:** Review doesn't exist
**Input:** Review ID = 99999
**Mock:** DELETE request returns 404
**Expected Result:** `Err(AppError::NotFound(...))`

### Test Case 14.3: Delete Review - Submitted Review Cannot Be Deleted
**Description:** Try to delete already-submitted review
**Input:** Submitted review ID
**Mock:** DELETE request returns 422
**Expected Result:** Error explaining review is already submitted

### Test Case 14.4: Get Pending Review Comments - Success
**Description:** Fetch comments from pending review
**Input:** Review ID with 5 draft comments
**Mock:** GET request returns comment list
**Expected Result:** `Ok(vec![...])` with 5 comments marked as draft

### Test Case 14.5: Get Pending Review Comments - Empty Review
**Description:** Pending review with no comments yet
**Input:** Review ID with 0 comments
**Mock:** GET request returns empty array
**Expected Result:** `Ok(vec![])`

---

## Category 15: PRs Under Review Query

### Test Case 15.1: Get PRs Under Review - Multiple Reviews
**Description:** Query all reviews in local storage
**Setup:** 3 PRs with local reviews
**Expected Result:** Vec with 3 PrUnderReview objects

### Test Case 15.2: Get PRs Under Review - Local Folder Mode
**Description:** Handle local folder reviews specially
**Setup:** Review with owner="__local__", repo="local"
**Expected Result:** PrUnderReview with total_count = number of markdown files

### Test Case 15.3: Get PRs Under Review - No Reviews
**Description:** No local reviews in storage
**Expected Result:** Empty vec `[]`

---

## Category 16: Crash Logging and Error Handling

### Test Case 16.1: Panic Handler Writes Crash Log
**Description:** Panic is logged to crash.log file
**Action:** Trigger panic
**Expected Result:** crash.log created in review_logs/, contains panic message and backtrace

### Test Case 16.2: Panic Handler - Multiple Panics
**Description:** Multiple crashes append to crash log
**Action:** Trigger 2 panics
**Expected Result:** crash.log contains 2 entries with timestamps

### Test Case 16.3: Panic Handler - Log Directory Creation
**Description:** Create log directory if doesn't exist
**Setup:** No log directory
**Action:** Trigger panic
**Expected Result:** review_logs/ directory created, crash.log written

---

## Category 17: Integration - Full Comment Submission Flow

### Test Case 17.1: End-to-End Single Comment
**Description:** Complete flow from frontend command to GitHub API  
**Steps:**
1. Frontend calls `cmd_submit_file_comment`
2. Backend validates input
3. Backend POSTs to GitHub API (mocked)
4. Backend returns comment ID
5. Frontend receives success response

**Expected Result:** Comment ID returned, no errors

### Test Case 13.2: End-to-End Review with Fallback
**Description:** Submit review with line fallback needed  
**Steps:**
1. Frontend calls `cmd_submit_review_comments`
2. Backend submits first comment (line-based) → 422 error
3. Backend retries as file-level comment → success
4. Backend submits second comment → success
5. Backend returns list of succeeded IDs

**Expected Result:** 2 comment IDs returned, log file shows both submitted

### Test Case 13.3: End-to-End with Rate Limiting
**Description:** Hit rate limit during batch submission  
**Steps:**
1. Frontend calls batch submit with 10 comments
2. Backend submits first 3 → success
3. Backend submits 4th → 422 "too quickly"
4. Backend waits with backoff
5. Backend retries 4th → success
6. Backend continues with remaining comments

**Expected Result:** All 10 comments submitted with increased total time

---

## Test Execution Notes

### Mocking Strategy

- **HTTP:** Use `mockito` crate to mock GitHub API
- **Keyring:** Create trait and mock implementation
- **Time:** Use `tokio-test` for time manipulation in retry tests
- **Database:** Use in-memory SQLite (`:memory:`)
- **File I/O:** Use `tempfile` crate for temporary directories

### Test Data Fixtures

Create `tests/fixtures/` directory with:
- `pr.json` - Sample PR response
- `comments.json` - Sample comments array
- `files.json` - Sample file list
- `diffs.txt` - Various diff formats
- `oauth_response.json` - Token exchange response

### Performance Considerations

- Unit tests should complete in < 100ms each
- Integration tests with mocked HTTP in < 500ms each
- Database tests with in-memory SQLite in < 200ms each
- Total backend test suite in < 30 seconds

---

### Additional Tauri Commands to Test

- `cmd_get_storage_info` - Get database and log paths
- `cmd_open_log_folder` - Open log folder in file explorer
- `cmd_open_url` - Open URL in browser
- `cmd_local_clear_review` - Clear review and regenerate log file
- `cmd_local_update_review_commit` - Update review's commit SHA
- `cmd_local_update_comment_file_path` - Bulk update file paths in comments
- `cmd_fetch_file_content` - Fetch file from GitHub at specific ref

---

**Total Backend Test Cases:** 125+  
**Estimated Implementation Time:** 2.5 weeks  
**Coverage Target:** 80%+ line coverage
