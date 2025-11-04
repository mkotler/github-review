# app/src-tauri/src/review_storage.rs

**Path:** `app/src-tauri/src/review_storage.rs`

**Last Updated:** January 2025

**Lines of Code:** 608

## Capabilities Provided

This module implements a comprehensive local storage system for draft pull request reviews using SQLite. It enables users to compose review comments locally with automatic crash recovery through persistent log files. The storage system maintains review metadata (commit ID, review body, creation time) and individual file comments with soft-delete support (comments are marked as deleted rather than removed). Log files are automatically generated in human-readable format for each review, serving as crash recovery backups that survive application crashes or unexpected shutdowns. The module provides thread-safe global storage access through a singleton pattern with `Mutex` protection for concurrent operations. Reviews can be completed (clearing from database), abandoned (marking log file), or deleted (preserving log file with metadata). This ensures users never lose work, even in failure scenarios.

## Data Structures

### ReviewComment

**Purpose:** Represents a single file-specific comment in a pending review.

**Fields:**
- `id: i64` - Unique database identifier (auto-increment primary key)
- `owner: String` - Repository owner username or organization
- `repo: String` - Repository name
- `pr_number: u64` - Pull request number
- `file_path: String` - File path within repository
- `line_number: u64` - Line number for the comment
- `side: String` - "LEFT" (base) or "RIGHT" (head) side of diff
- `body: String` - Comment text content
- `commit_id: String` - Commit SHA the comment is attached to
- `created_at: String` - ISO 8601 timestamp of creation
- `updated_at: String` - ISO 8601 timestamp of last update
- `deleted: bool` - Soft-delete flag (true = marked deleted, false = active)

**Derives:** Debug, Clone, Serialize, Deserialize

**Usage:** Stored in SQLite review_comments table, serialized to log files for crash recovery, and returned to frontend for displaying pending comments

---

### ReviewMetadata

**Purpose:** Tracks high-level information about a pending review session.

**Fields:**
- `owner: String` - Repository owner
- `repo: String` - Repository name
- `pr_number: u64` - Pull request number
- `commit_id: String` - Commit SHA the review is pinned to
- `body: Option<String>` - Optional overall review summary comment
- `created_at: String` - ISO 8601 timestamp of review creation
- `log_file_index: i32` - Versioning index for log file naming (0 for first review, increments for subsequent reviews on same PR)

**Derives:** Debug, Clone, Serialize, Deserialize

**Primary Key:** (owner, repo, pr_number) - Only one pending review per PR at a time

**Usage:** Stored in SQLite review_metadata table, used to track review sessions and generate log file paths

---

### ReviewStorage

**Purpose:** Thread-safe SQLite database wrapper for managing pending reviews and automatic log file generation.

**Fields:**
- `conn: Mutex<Connection>` - Thread-safe SQLite connection with mutex protection
- `log_dir: PathBuf` - Directory path for storing log files (typically `data_dir/review_logs/`)

**Usage:** Singleton instance accessed via `get_storage()`, initialized once at application startup via `init_storage()`

---

## Functions

### ReviewStorage::new

**Purpose:** Constructor that initializes the SQLite database, creates tables with schema migration, and sets up log file directory.

**Parameters:**
- `data_dir: &Path` - Application data directory for storing database and log files

**Returns:** `AppResult<Self>` - Initialized ReviewStorage instance

**Side Effects:**
- Creates data_dir if it doesn't exist
- Opens or creates reviews.db SQLite database
- Creates review_metadata table with composite primary key (owner, repo, pr_number)
- Creates review_comments table with foreign key cascade delete
- Creates index on review_comments for efficient PR lookups
- Migrates existing databases by adding deleted column (ignores error if already exists)
- Creates review_logs subdirectory for log files
- Logs info-level messages for storage creation and database opening

**Exceptions:**
- `AppError::Io` - If directory creation or file access fails
- `AppError::Database` - If SQLite operations fail

**Dependencies:** rusqlite::Connection, std::fs, tracing::info

**Schema Details:**
- review_metadata: Composite primary key ensures one pending review per PR
- review_comments: Foreign key with ON DELETE CASCADE ensures orphaned comments are auto-deleted
- Migration-safe: ALTER TABLE failure is ignored for backward compatibility

---

### ReviewStorage::start_review

**Purpose:** Starts a new pending review or retrieves existing metadata if one already exists for the PR.

**Parameters:**
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `pr_number: u64` - Pull request number
- `commit_id: &str` - Commit SHA to pin review to
- `body: Option<&str>` - Optional review summary comment

**Returns:** `AppResult<ReviewMetadata>` - New or existing review metadata

**Side Effects:**
- Logs info-level message with PR identifier
- If review doesn't exist: Inserts row into review_metadata with current timestamp and log_file_index=0
- If review exists: Returns existing metadata without modification

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail

**Dependencies:** chrono::Utc, rusqlite

**Notes:** Idempotent - safe to call multiple times for same PR without creating duplicates

---

### ReviewStorage::add_comment

**Purpose:** Adds a new comment to the pending review and automatically updates the crash recovery log file.

**Parameters:**
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `pr_number: u64` - Pull request number
- `file_path: &str` - File path for the comment
- `line_number: u64` - Line number for the comment
- `side: &str` - "LEFT" or "RIGHT" side of diff
- `body: &str` - Comment text content
- `commit_id: &str` - Commit SHA

**Returns:** `AppResult<ReviewComment>` - The newly created comment with database ID

**Side Effects:**
- Inserts row into review_comments table with deleted=0
- Sets created_at and updated_at to current timestamp
- Calls write_log() to regenerate log file asynchronously
- Database auto-generates ID via AUTOINCREMENT

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail
- Propagates errors from write_log()

**Dependencies:** chrono::Utc, rusqlite, write_log

---

### ReviewStorage::update_comment

**Purpose:** Modifies an existing comment's body text and refreshes the log file.

**Parameters:**
- `comment_id: i64` - Database ID of the comment to update
- `new_body: &str` - New comment text content

**Returns:** `AppResult<ReviewComment>` - The updated comment with new timestamp

**Side Effects:**
- Updates body and updated_at in review_comments table
- Queries full comment data after update
- Calls write_log() to regenerate log file with updated content

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail or comment doesn't exist
- Propagates errors from write_log()

**Dependencies:** chrono::Utc, rusqlite, write_log

---

### ReviewStorage::delete_comment

**Purpose:** Soft-deletes a comment by marking it as deleted and updating the log file (keeps in database for log history).

**Parameters:**
- `comment_id: i64` - Database ID of the comment to delete

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- Sets deleted=1 in review_comments table
- Queries owner, repo, pr_number before deletion for log file update
- Calls write_log() which marks comment as "DELETED" in log file
- Comment remains in database but is filtered from get_comments() queries

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail
- Propagates errors from write_log()

**Dependencies:** rusqlite, write_log

**Notes:** Uses soft-delete to preserve history in log files. See delete_comment_preserve_log() for hard delete.

---

### ReviewStorage::delete_comment_preserve_log

**Purpose:** Hard-deletes a comment from the database without updating the log file, used after successfully submitting comments to GitHub.

**Parameters:**
- `comment_id: i64` - Database ID of the comment to delete permanently

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- Permanently removes row from review_comments table
- Does NOT update log file (log preserves submission history)

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail

**Dependencies:** rusqlite

**Notes:** Used for cleanup after successful GitHub submission to avoid duplicate posting. Log file is not updated to preserve submission record.

---

### ReviewStorage::get_comments

**Purpose:** Retrieves all active (non-deleted) comments for a pending review, ordered by file path and line number.

**Parameters:**
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `pr_number: u64` - Pull request number

**Returns:** `AppResult<Vec<ReviewComment>>` - Sorted list of active comments

**Side Effects:** Queries review_comments table with deleted=0 filter

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail

**Dependencies:** rusqlite

**Notes:** Filters deleted comments automatically. Returns empty vector if no comments exist.

---

### ReviewStorage::get_review_metadata

**Purpose:** Retrieves metadata for a pending review if it exists.

**Parameters:**
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `pr_number: u64` - Pull request number

**Returns:** `AppResult<Option<ReviewMetadata>>` - Some(metadata) if review exists, None otherwise

**Side Effects:** Queries review_metadata table

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail (excluding "not found" which returns None)

**Dependencies:** rusqlite

---

### ReviewStorage::abandon_review

**Purpose:** Abandons a pending review by marking the log file with "ABANDONED" header and removing from database.

**Parameters:**
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `pr_number: u64` - Pull request number

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- Queries review metadata to get log_file_index
- If log file exists: Prepends "REVIEW ABANDONED" header with timestamps
- Deletes review_metadata row (CASCADE deletes all review_comments)

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail
- `AppError::Io` - If log file operations fail

**Dependencies:** chrono::Utc, tokio::fs, rusqlite

**Log File Header Format:**
```
# REVIEW ABANDONED at 2025-01-15T10:30:00Z
# Original review started at 2025-01-15T09:00:00Z

[original log content]
```

---

### ReviewStorage::clear_review

**Purpose:** Clears a completed review from database and marks the log file as "DELETED (NOT SUBMITTED)" with PR metadata.

**Parameters:**
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `pr_number: u64` - Pull request number
- `pr_title: Option<&str>` - Optional PR title for log file documentation

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- Queries review metadata to get log_file_index
- If log file exists: Prepends detailed "DELETED" header with PR URL and title
- Deletes review_metadata row (CASCADE deletes all review_comments)

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail
- `AppError::Io` - If log file operations fail

**Dependencies:** chrono::Utc, tokio::fs, rusqlite

**Log File Header Format:**
```
# REVIEW DELETED (NOT SUBMITTED TO GITHUB) at 2025-01-15T11:00:00Z
# Original review started at 2025-01-15T09:00:00Z
# PR: Add new feature
# URL: https://github.com/owner/repo/pull/42

[original log content]
```

**Usage:** Called when user explicitly deletes a pending review without submitting it

---

### ReviewStorage::get_log_path

**Purpose:** Constructs the file system path for a review's log file based on PR identifier and index.

**Parameters:**
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `pr_number: u64` - Pull request number
- `index: i32` - Log file version index (0 for first review, increments for subsequent reviews)

**Returns:** `PathBuf` - Full path to the log file

**Side Effects:** None (pure function)

**Exceptions:** None

**Dependencies:** PathBuf

**File Naming Format:**
- Index 0: `owner-repo-123.log`
- Index > 0: `owner-repo-123-2.log`

**Notes:** The index allows multiple review sessions for the same PR without overwriting previous log files

---

### ReviewStorage::write_log

**Purpose:** Generates a human-readable log file for crash recovery with all review comments grouped by file.

**Parameters:**
- `owner: &str` - Repository owner
- `repo: &str` - Repository name
- `pr_number: u64` - Pull request number

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- Logs info-level messages for start and completion
- Queries review_metadata and all review_comments (including deleted)
- Overwrites log file with current review state
- Async file write operation

**Exceptions:**
- `AppError::Internal` - If mutex lock is poisoned
- `AppError::Database` - If SQLite operations fail
- `AppError::Io` - If file write operations fail

**Dependencies:** tracing::info, tokio::fs, rusqlite, get_log_path

**Log File Format:**
```
# Review for PR #42
# URL: https://github.com/owner/repo/pull/42
# Repository: owner/repo
# Created: 2025-01-15T09:00:00Z
# Commit: abc123def456
# Review Body: This looks good overall
# Total Comments: 3

path/to/file1.md:
    Line 10: This is a comment
    Line 20: Another comment
    DELETED - Line 30: This comment was deleted

path/to/file2.yml:
    Line 5 (ORIGINAL): Comment on original side
```

**Notes:** Automatically called after add_comment, update_comment, and delete_comment to keep log file synchronized with database state. Deleted comments are marked with "DELETED - " prefix for history preservation.

---

## Global Storage Functions

### init_storage

**Purpose:** Initializes the global singleton ReviewStorage instance at application startup.

**Parameters:**
- `data_dir: &Path` - Application data directory

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- Creates ReviewStorage instance via ReviewStorage::new()
- Sets global REVIEW_STORAGE singleton via OnceLock
- Fails if called more than once

**Exceptions:**
- `AppError::Internal` - If storage is already initialized
- Propagates errors from ReviewStorage::new()

**Dependencies:** OnceLock, ReviewStorage::new

**Usage:** Must be called exactly once during application initialization before any storage operations

---

### get_storage

**Purpose:** Retrieves the global singleton ReviewStorage instance for performing storage operations.

**Parameters:** None

**Returns:** `AppResult<&'static ReviewStorage>` - Reference to the global storage instance

**Side Effects:** None

**Exceptions:**
- `AppError::Internal` - If storage has not been initialized via init_storage()

**Dependencies:** OnceLock

**Usage:** Called by all Tauri commands that need to access review storage. Thread-safe for concurrent access due to internal Mutex protection.

---

## Constants

### REVIEW_STORAGE

**Type:** `OnceLock<ReviewStorage>`

**Purpose:** Global singleton storage instance accessible throughout the application lifecycle

**Initialization:** Set once via init_storage(), accessed via get_storage()

**Thread Safety:** OnceLock ensures thread-safe initialization, Mutex inside ReviewStorage ensures thread-safe operations

---

## Dependencies

### External Crates

- `rusqlite` - SQLite database operations (Connection, params, OptionalExtension)
- `chrono` - Timestamp generation (Utc::now().to_rfc3339())
- `serde` - Serialization for ReviewComment and ReviewMetadata structs
- `tokio::fs` - Async file operations for log file writing
- `std::sync` - Mutex for thread-safe database access, OnceLock for singleton pattern
- `std::path` - Path and PathBuf for file system operations
- `tracing` - Structured logging

### Internal Dependencies

- `crate::error` - AppError and AppResult types

### Usage Context

This module is used by:
- `lib.rs` - All local storage Tauri commands (start_review, add_comment, update_comment, delete_comment, get_pending_review_comments, get_review_metadata, submit_review, delete_pending_review, abandon_pending_review, clear_completed_review, get_storage_info)
- Application startup - init_storage() called during Tauri app initialization

### Database Schema

**review_metadata table:**
- Composite primary key: (owner, repo, pr_number)
- Ensures only one pending review per PR
- Tracks commit ID, optional review body, creation time, and log file index

**review_comments table:**
- Auto-increment primary key: id
- Foreign key: (owner, repo, pr_number) references review_metadata with ON DELETE CASCADE
- Index on (owner, repo, pr_number) for efficient queries
- Soft-delete support via deleted column (0 = active, 1 = deleted)

### Log File Strategy

Log files serve as crash recovery mechanism:
- Human-readable format for manual inspection
- Automatically updated after every comment operation
- Survive application crashes and unexpected shutdowns
- Preserve history with "DELETED", "ABANDONED" markers
- Versioned via log_file_index to prevent overwriting previous sessions

Users can recover lost work by manually inspecting log files in case of catastrophic failures where the database is corrupted but log files remain intact.
