# app/src-tauri/src/models.rs

**Path:** `app/src-tauri/src/models.rs`

**Last Updated:** January 2025

**Lines of Code:** 83

## Capabilities Provided

This module defines the core domain models and data transfer objects (DTOs) that serve as the contract between the Rust backend and the TypeScript frontend. All structures are serializable to JSON for transmission across the Tauri bridge. These models represent authentication state, pull request summaries, detailed pull request information with file changes, comments with ownership tracking, and review state. The models support rich UI features including diff viewing, comment threading, draft state management, and user-specific filtering of comments and reviews.

## Data Structures

### AuthStatus

**Purpose:** Represents the current authentication state of the user.

**Fields:**
- `is_authenticated: bool` - Whether the user has a valid GitHub OAuth token
- `login: Option<String>` - GitHub username if authenticated
- `avatar_url: Option<String>` - Profile picture URL if authenticated

**Derives:** Debug, Serialize

**Usage:** Returned by authentication status checks to update UI login state

---

### PullRequestSummary

**Purpose:** Lightweight representation of a pull request for list views.

**Fields:**
- `number: u64` - Pull request number
- `title: String` - Pull request title
- `author: String` - GitHub username of PR author
- `updated_at: String` - ISO 8601 timestamp of last update
- `head_ref: String` - Name of the head branch

**Derives:** Debug, Serialize

**Usage:** Used in pull request listing views to show multiple PRs without loading full details

---

### PullRequestDetail

**Purpose:** Complete pull request information including files, comments, and reviews.

**Fields:**
- `number: u64` - Pull request number
- `title: String` - Pull request title
- `body: Option<String>` - Pull request description (Markdown)
- `author: String` - GitHub username of PR author
- `head_sha: String` - Commit SHA of the head branch
- `base_sha: String` - Commit SHA of the base branch
- `files: Vec<PullRequestFile>` - Array of changed files with content
- `comments: Vec<PullRequestComment>` - All comments (review and general) sorted chronologically
- `my_comments: Vec<PullRequestComment>` - Filtered subset of comments authored by current user
- `reviews: Vec<PullRequestReview>` - All submitted reviews

**Derives:** Debug, Serialize

**Usage:** Provides all data needed for the detailed PR review UI including file diffs, comment threads, and review history

---

### PullRequestFile

**Purpose:** Represents a changed file in a pull request with content for both base and head versions.

**Fields:**
- `path: String` - File path within repository
- `status: String` - Change type ("added", "modified", "removed", "renamed")
- `additions: u32` - Number of lines added
- `deletions: u32` - Number of lines deleted
- `patch: Option<String>` - Unified diff patch
- `head_content: Option<String>` - Full file content at head commit (None if file was removed)
- `base_content: Option<String>` - Full file content at base commit (None if file was added)
- `language: FileLanguage` - Detected language for syntax highlighting

**Derives:** Debug, Serialize, Clone

**Usage:** Enables side-by-side diff viewing in Monaco Editor with full file context

---

### FileLanguage

**Purpose:** Enum for file language detection to support syntax highlighting in the editor.

**Variants:**
- `Markdown` - Serializes to "markdown"
- `Yaml` - Serializes to "yaml"

**Derives:** Debug, Serialize, Clone, Copy

**Usage:** Passed to Monaco Editor to enable appropriate syntax highlighting for supported file types

---

### PullRequestComment

**Purpose:** Unified representation of both review comments (file-specific) and issue comments (general conversation).

**Fields:**
- `id: u64` - Comment ID
- `body: String` - Comment text (Markdown)
- `author: String` - GitHub username of comment author
- `created_at: String` - ISO 8601 timestamp
- `url: String` - GitHub web URL to the comment
- `path: Option<String>` - File path (None for general comments)
- `line: Option<u64>` - Line number (None for file-level or general comments)
- `side: Option<String>` - "LEFT" or "RIGHT" side of diff (None for general comments)
- `is_review_comment: bool` - True for file-specific comments, false for general conversation
- `is_draft: bool` - True if comment is part of a pending review not yet submitted
- `state: Option<String>` - "PENDING" for draft comments
- `is_mine: bool` - True if authored by current user
- `review_id: Option<u64>` - Associated review ID if part of a review

**Derives:** Debug, Serialize, Clone

**Usage:** Supports comment threading, draft management, and user-specific filtering in the UI. The `is_mine` flag enables edit/delete actions and the `is_draft` flag controls visibility of pending comments.

---

### PullRequestReview

**Purpose:** Represents a submitted or pending review with overall verdict.

**Fields:**
- `id: u64` - Review ID
- `state: String` - Review state: "APPROVED", "CHANGES_REQUESTED", "COMMENTED", or "PENDING"
- `author: String` - GitHub username of reviewer
- `submitted_at: Option<String>` - ISO 8601 timestamp (None for pending reviews)
- `body: Option<String>` - Optional summary comment for the review
- `html_url: Option<String>` - GitHub web URL to the review
- `commit_id: Option<String>` - Commit SHA the review is pinned to
- `is_mine: bool` - True if review was created by current user

**Derives:** Debug, Serialize, Clone

**Usage:** Enables review state management in UI, including starting pending reviews, adding comments to pending reviews, and submitting reviews with final verdicts. The `is_mine` flag controls access to pending review operations like adding comments and submitting.

---

## Dependencies

### External Crates
- `serde` - Serialization framework with Serialize derive macro for JSON conversion across Tauri bridge

### Usage Context
These models are consumed by:
- `github.rs` - Constructs these models from GitHub API responses
- `lib.rs` - Returns these models as Tauri command responses to the frontend
- `auth.rs` - Uses AuthStatus for authentication checks
- `review_storage.rs` - Stores review comment data in SQLite

All models are designed to be directly serializable to JSON without transformation, providing a clean contract between Rust backend and TypeScript frontend.
