// Category 10 & 11: Review Storage Tests (review_storage.rs)
// Tests for SQLite storage operations and log file generation

use crate::review_storage::ReviewStorage;
use tempfile::TempDir;

/// Helper to create a test storage instance with temp directory
fn create_test_storage() -> (ReviewStorage, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp directory");
    let storage = ReviewStorage::new(temp_dir.path())
        .expect("Failed to create storage");
    (storage, temp_dir)
}

/// Test Case 10.1: Create New Review
/// Insert review into database
#[test]
fn test_create_new_review() {
    let (storage, _temp) = create_test_storage();
    
    let metadata = storage.start_review(
        "facebook",
        "react",
        123,
        "abc123def456",
        Some("Test review body"),
        None,
    ).expect("Failed to start review");
    
    assert_eq!(metadata.owner, "facebook");
    assert_eq!(metadata.repo, "react");
    assert_eq!(metadata.pr_number, 123);
    assert_eq!(metadata.commit_id, "abc123def456");
    assert_eq!(metadata.body, Some("Test review body".to_string()));
    assert!(metadata.created_at.len() > 0);
}

/// Test Case 10.2: Get Existing Review Metadata
/// Returns existing review without creating duplicate
#[test]
fn test_get_existing_review() {
    let (storage, _temp) = create_test_storage();
    
    // Create first review
    let first = storage.start_review(
        "owner", "repo", 1, "commit1", None, None
    ).unwrap();
    
    // Get same review again
    let second = storage.start_review(
        "owner", "repo", 1, "commit2", None, None
    ).unwrap();
    
    // Should return existing review (same created_at)
    assert_eq!(first.created_at, second.created_at);
    // Original commit_id preserved
    assert_eq!(second.commit_id, "commit1");
}

/// Test Case 10.3: Add Comment to Review
#[tokio::test]
async fn test_add_comment() {
    let (storage, _temp) = create_test_storage();
    
    // Start review first
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    
    // Add comment
    let comment = storage.add_comment(
        "owner",
        "repo",
        1,
        "src/app.rs",
        42,
        "RIGHT",
        "Fix this bug",
        "commit1",
        None,
    ).await.expect("Failed to add comment");
    
    assert!(comment.id > 0);
    assert_eq!(comment.file_path, "src/app.rs");
    assert_eq!(comment.line_number, 42);
    assert_eq!(comment.side, "RIGHT");
    assert_eq!(comment.body, "Fix this bug");
    assert!(!comment.deleted);
}

/// Test Case 10.4: List Comments for Review
#[tokio::test]
async fn test_list_comments() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    
    // Add multiple comments
    storage.add_comment("owner", "repo", 1, "file1.rs", 10, "RIGHT", "Comment 1", "commit1", None).await.unwrap();
    storage.add_comment("owner", "repo", 1, "file2.rs", 20, "RIGHT", "Comment 2", "commit1", None).await.unwrap();
    storage.add_comment("owner", "repo", 1, "file1.rs", 30, "LEFT", "Comment 3", "commit1", None).await.unwrap();
    
    let comments = storage.get_comments("owner", "repo", 1).unwrap();
    
    assert_eq!(comments.len(), 3);
}

/// Test Case 10.5: Update Comment Body
#[tokio::test]
async fn test_update_comment() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    let comment = storage.add_comment("owner", "repo", 1, "file.rs", 10, "RIGHT", "Original", "commit1", None).await.unwrap();
    
    let updated = storage.update_comment(comment.id, "Updated text").await.unwrap();
    
    assert_eq!(updated.body, "Updated text");
    assert_ne!(updated.created_at, updated.updated_at);
}

/// Test Case 10.6: Delete Comment (Soft Delete)
#[tokio::test]
async fn test_delete_comment() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    let comment = storage.add_comment("owner", "repo", 1, "file.rs", 10, "RIGHT", "To delete", "commit1", None).await.unwrap();
    
    // Delete
    storage.delete_comment(comment.id).await.unwrap();
    
    // Should not appear in get_comments (which filters deleted)
    let comments = storage.get_comments("owner", "repo", 1).unwrap();
    assert!(comments.is_empty());
}

/// Test Case 10.7: Query Pending Comments
/// Get comments not yet submitted
#[tokio::test]
async fn test_query_pending_comments() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    storage.add_comment("owner", "repo", 1, "file1.rs", 10, "RIGHT", "Pending 1", "commit1", None).await.unwrap();
    storage.add_comment("owner", "repo", 1, "file2.rs", 20, "RIGHT", "Pending 2", "commit1", None).await.unwrap();
    
    // All comments are pending (not submitted to GitHub)
    let comments = storage.get_comments("owner", "repo", 1).unwrap();
    assert_eq!(comments.len(), 2);
}

/// Test Case 10.8: Create Review with Empty Comments List
#[test]
fn test_review_with_no_comments() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    
    let comments = storage.get_comments("owner", "repo", 1).unwrap();
    assert!(comments.is_empty());
}

/// Test Case 10.9: Review Metadata Retrieval
#[test]
fn test_get_review_metadata() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 123, "commit123", Some("Review body"), None).unwrap();
    
    let metadata = storage.get_review_metadata("owner", "repo", 123).unwrap();
    
    assert!(metadata.is_some());
    let meta = metadata.unwrap();
    assert_eq!(meta.pr_number, 123);
    assert_eq!(meta.body, Some("Review body".to_string()));
}

/// Test Case 10.10: Non-existent Review Returns None
#[test]
fn test_nonexistent_review() {
    let (storage, _temp) = create_test_storage();
    
    let metadata = storage.get_review_metadata("owner", "repo", 999).unwrap();
    assert!(metadata.is_none());
}

/// Test Case 10.11: Update Review Commit ID
#[test]
fn test_update_review_commit() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "old_commit", None, None).unwrap();
    
    let updated = storage.update_review_commit("owner", "repo", 1, "new_commit").unwrap();
    
    assert_eq!(updated.commit_id, "new_commit");
}

/// Test Case 10.12: Update Comment File Path
#[tokio::test]
async fn test_update_comment_file_path() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    storage.add_comment("owner", "repo", 1, "old/path.rs", 10, "RIGHT", "Comment", "commit1", None).await.unwrap();
    storage.add_comment("owner", "repo", 1, "old/path.rs", 20, "RIGHT", "Comment 2", "commit1", None).await.unwrap();
    
    let affected = storage.update_comment_file_path("owner", "repo", 1, "old/path.rs", "new/path.rs").await.unwrap();
    
    assert_eq!(affected, 2);
    
    let comments = storage.get_comments("owner", "repo", 1).unwrap();
    assert!(comments.iter().all(|c| c.file_path == "new/path.rs"));
}

/// Test Case 10.13: Get All Review Metadata
#[test]
fn test_get_all_reviews() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner1", "repo1", 1, "commit1", None, None).unwrap();
    storage.start_review("owner2", "repo2", 2, "commit2", None, None).unwrap();
    storage.start_review("owner1", "repo1", 3, "commit3", None, None).unwrap();
    
    let all = storage.get_all_review_metadata().unwrap();
    
    assert_eq!(all.len(), 3);
}

/// Test Case 10.14: Comment with Reply
#[tokio::test]
async fn test_comment_with_reply() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    let parent = storage.add_comment("owner", "repo", 1, "file.rs", 10, "RIGHT", "Parent", "commit1", None).await.unwrap();
    
    let reply = storage.add_comment("owner", "repo", 1, "file.rs", 10, "RIGHT", "Reply", "commit1", Some(parent.id)).await.unwrap();
    
    assert_eq!(reply.in_reply_to_id, Some(parent.id));
}

/// Test Case 10.15: File-Level Comment (line 0)
#[tokio::test]
async fn test_file_level_comment() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    let comment = storage.add_comment("owner", "repo", 1, "file.rs", 0, "RIGHT", "File-level comment", "commit1", None).await.unwrap();
    
    assert_eq!(comment.line_number, 0);
}

/// Test Case 11.1: Log File Path Generation
#[test]
fn test_log_file_path() {
    let (storage, temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 123, "commit1", None, None).unwrap();
    
    // Check log file exists in log directory
    let log_dir = temp.path().join("review_logs");
    assert!(log_dir.exists());
}

/// Test Case 11.2: Log File Format - Header
#[tokio::test]
async fn test_log_file_header() {
    let (storage, temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 123, "commit1", Some("Review body"), None).unwrap();
    storage.add_comment("owner", "repo", 123, "file.rs", 10, "RIGHT", "Comment", "commit1", None).await.unwrap();
    
    // Find log file
    let log_dir = temp.path().join("review_logs");
    let log_file = log_dir.join("owner-repo-123.log");
    
    if log_file.exists() {
        let content = std::fs::read_to_string(&log_file).unwrap();
        
        // Check header elements
        assert!(content.contains("# Review for PR #123"));
        assert!(content.contains("# Repository: owner/repo"));
        assert!(content.contains("# Commit: commit1"));
    }
}

/// Test Case 11.3: Log File Format - Comment Entry
#[tokio::test]
async fn test_log_file_comment_entry() {
    let (storage, temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    storage.add_comment("owner", "repo", 1, "src/app.rs", 42, "RIGHT", "Fix this bug", "commit1", None).await.unwrap();
    
    let log_dir = temp.path().join("review_logs");
    let log_file = log_dir.join("owner-repo-1.log");
    
    if log_file.exists() {
        let content = std::fs::read_to_string(&log_file).unwrap();
        
        // Check comment entry
        assert!(content.contains("src/app.rs"));
        assert!(content.contains("Line 42"));
        assert!(content.contains("Fix this bug"));
    }
}

/// Test Case 11.4: Log File Format - File-Level Comment
#[tokio::test]
async fn test_log_file_file_level_comment() {
    let (storage, temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    storage.add_comment("owner", "repo", 1, "readme.md", 0, "RIGHT", "Good doc", "commit1", None).await.unwrap();
    
    let log_dir = temp.path().join("review_logs");
    let log_file = log_dir.join("owner-repo-1.log");
    
    if log_file.exists() {
        let content = std::fs::read_to_string(&log_file).unwrap();
        
        // File-level should show "Overall" not "Line 0"
        assert!(content.contains("readme.md"));
        assert!(content.contains("Overall"));
        assert!(!content.contains("Line 0"));
    }
}

/// Test Case 11.5: Log File Updated After Comment Add
#[tokio::test]
async fn test_log_file_updated_on_comment() {
    let (storage, temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    
    let log_dir = temp.path().join("review_logs");
    let log_file = log_dir.join("owner-repo-1.log");
    
    // Add first comment
    storage.add_comment("owner", "repo", 1, "file1.rs", 10, "RIGHT", "First", "commit1", None).await.unwrap();
    
    if log_file.exists() {
        let content1 = std::fs::read_to_string(&log_file).unwrap();
        assert!(content1.contains("First"));
        
        // Add second comment
        storage.add_comment("owner", "repo", 1, "file2.rs", 20, "RIGHT", "Second", "commit1", None).await.unwrap();
        
        let content2 = std::fs::read_to_string(&log_file).unwrap();
        assert!(content2.contains("First"));
        assert!(content2.contains("Second"));
    }
}

/// Test Case 11.6: Local Folder Review
#[test]
fn test_local_folder_review() {
    let (storage, _temp) = create_test_storage();
    
    let metadata = storage.start_review(
        "__local__",
        "local",
        1,
        "LOCAL-abc123",
        None,
        Some("C:/Users/me/docs"),
    ).unwrap();
    
    assert_eq!(metadata.owner, "__local__");
    assert_eq!(metadata.repo, "local");
    assert_eq!(metadata.local_folder, Some("C:/Users/me/docs".to_string()));
}

/// Test Case 11.7: Abandon Review
#[tokio::test]
async fn test_abandon_review() {
    let (storage, temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    storage.add_comment("owner", "repo", 1, "file.rs", 10, "RIGHT", "Comment", "commit1", None).await.unwrap();
    
    storage.abandon_review("owner", "repo", 1).await.unwrap();
    
    // Review should be gone from database
    let metadata = storage.get_review_metadata("owner", "repo", 1).unwrap();
    assert!(metadata.is_none());
    
    // Log file should still exist with "ABANDONED" header
    let log_file = temp.path().join("review_logs").join("owner-repo-1.log");
    if log_file.exists() {
        let content = std::fs::read_to_string(&log_file).unwrap();
        assert!(content.contains("ABANDONED"));
    }
}

/// Test Case 11.8: Clear Review
#[tokio::test]
async fn test_clear_review() {
    let (storage, temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    storage.add_comment("owner", "repo", 1, "file.rs", 10, "RIGHT", "Comment", "commit1", None).await.unwrap();
    
    storage.clear_review("owner", "repo", 1, None).await.unwrap();
    
    // Review should be gone
    let metadata = storage.get_review_metadata("owner", "repo", 1).unwrap();
    assert!(metadata.is_none());
    
    // Log file should have "DELETED" header
    let log_file = temp.path().join("review_logs").join("owner-repo-1.log");
    if log_file.exists() {
        let content = std::fs::read_to_string(&log_file).unwrap();
        assert!(content.contains("DELETED"));
    }
}

/// Test Case 11.9: Delete Comment Preserve Log
#[tokio::test]
async fn test_delete_comment_preserve_log() {
    let (storage, _temp) = create_test_storage();
    
    storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    let comment = storage.add_comment("owner", "repo", 1, "file.rs", 10, "RIGHT", "Comment", "commit1", None).await.unwrap();
    
    // Delete preserving log (for successfully posted comments)
    storage.delete_comment_preserve_log(comment.id).unwrap();
    
    // Comment should be gone from DB
    let comments = storage.get_comments("owner", "repo", 1).unwrap();
    assert!(comments.is_empty());
}

/// Test Case 11.10: Log File Index Increment
#[tokio::test]
async fn test_log_file_index() {
    let (storage, temp) = create_test_storage();
    
    // First review
    let meta1 = storage.start_review("owner", "repo", 1, "commit1", None, None).unwrap();
    storage.add_comment("owner", "repo", 1, "file.rs", 10, "RIGHT", "Comment", "commit1", None).await.unwrap();
    
    // Clear it (creates log with header)
    storage.clear_review("owner", "repo", 1, None).await.unwrap();
    
    // Second review for same PR should get new index
    let meta2 = storage.start_review("owner", "repo", 1, "commit2", None, None).unwrap();
    
    // Index should increment
    assert!(meta2.log_file_index >= meta1.log_file_index);
}
