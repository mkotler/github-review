// Category 2: Data Models Tests (models.rs)
// Tests for struct serialization and field handling

// Note: serde_json is imported in local scopes where needed

// Test the model structures for correct serialization
// Since models.rs only defines Serialize (not Deserialize for most), 
// we test serialization behavior

/// Test Case 2.1: AuthStatus serializes correctly
#[test]
fn test_auth_status_serialization() {
    use crate::models::AuthStatus;
    
    let status = AuthStatus {
        is_authenticated: true,
        login: Some("octocat".to_string()),
        avatar_url: Some("https://github.com/images/octocat.png".to_string()),
        is_offline: false,
    };
    
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["is_authenticated"], true);
    assert_eq!(json["login"], "octocat");
    assert_eq!(json["avatar_url"], "https://github.com/images/octocat.png");
    assert_eq!(json["is_offline"], false);
}

/// Test Case 2.2: AuthStatus with null fields
#[test]
fn test_auth_status_with_nulls() {
    use crate::models::AuthStatus;
    
    let status = AuthStatus {
        is_authenticated: false,
        login: None,
        avatar_url: None,
        is_offline: false,
    };
    
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["is_authenticated"], false);
    assert!(json["login"].is_null());
    assert!(json["avatar_url"].is_null());
}

/// Test Case 2.3: PullRequestSummary serializes with all fields
#[test]
fn test_pr_summary_serialization() {
    use crate::models::PullRequestSummary;
    
    let summary = PullRequestSummary {
        number: 123,
        title: "Fix bug in feature".to_string(),
        author: "octocat".to_string(),
        updated_at: "2024-01-15T10:00:00Z".to_string(),
        head_ref: "feature-branch".to_string(),
        has_pending_review: true,
        file_count: 5,
        state: "open".to_string(),
        merged: false,
        locked: false,
    };
    
    let json = serde_json::to_value(&summary).unwrap();
    assert_eq!(json["number"], 123);
    assert_eq!(json["title"], "Fix bug in feature");
    assert_eq!(json["author"], "octocat");
    assert_eq!(json["has_pending_review"], true);
    assert_eq!(json["file_count"], 5);
    assert_eq!(json["state"], "open");
    assert_eq!(json["merged"], false);
    assert_eq!(json["locked"], false);
}

/// Test Case 2.4: PullRequestMetadata serializes correctly
#[test]
fn test_pr_metadata_serialization() {
    use crate::models::PullRequestMetadata;
    
    let metadata = PullRequestMetadata {
        state: "open".to_string(),
        merged: false,
        locked: true,
    };
    
    let json = serde_json::to_value(&metadata).unwrap();
    assert_eq!(json["state"], "open");
    assert_eq!(json["merged"], false);
    assert_eq!(json["locked"], true);
}

/// Test Case 2.5: PullRequestDetail serializes with files and comments
#[test]
fn test_pr_detail_serialization() {
    use crate::models::{PullRequestDetail, PullRequestFile};
    
    let detail = PullRequestDetail {
        number: 456,
        title: "Add new feature".to_string(),
        body: Some("This PR adds a new feature".to_string()),
        author: "developer".to_string(),
        head_sha: "abc123def456".to_string(),
        base_sha: "789xyz000111".to_string(),
        files: vec![
            PullRequestFile {
                path: "src/main.rs".to_string(),
                status: "modified".to_string(),
                additions: 10,
                deletions: 5,
                patch: Some("@@ -1,5 +1,10 @@".to_string()),
                head_content: Some("new content".to_string()),
                base_content: Some("old content".to_string()),
                language: "rust".to_string(),
                previous_filename: None,
            }
        ],
        comments: vec![],
        my_comments: vec![],
        reviews: vec![],
    };
    
    let json = serde_json::to_value(&detail).unwrap();
    assert_eq!(json["number"], 456);
    assert_eq!(json["title"], "Add new feature");
    assert_eq!(json["body"], "This PR adds a new feature");
    assert_eq!(json["author"], "developer");
    assert_eq!(json["head_sha"], "abc123def456");
    assert_eq!(json["files"].as_array().unwrap().len(), 1);
}

/// Test Case 2.6: PullRequestFile with renamed status
#[test]
fn test_pr_file_renamed() {
    use crate::models::PullRequestFile;
    
    let file = PullRequestFile {
        path: "src/new_name.rs".to_string(),
        status: "renamed".to_string(),
        additions: 0,
        deletions: 0,
        patch: None,
        head_content: None,
        base_content: None,
        language: "rust".to_string(),
        previous_filename: Some("src/old_name.rs".to_string()),
    };
    
    let json = serde_json::to_value(&file).unwrap();
    assert_eq!(json["status"], "renamed");
    assert_eq!(json["previous_filename"], "src/old_name.rs");
}

/// Test Case 2.7: PullRequestComment with line number
#[test]
fn test_pr_comment_with_line() {
    use crate::models::PullRequestComment;
    
    let comment = PullRequestComment {
        id: 12345,
        body: "This needs fixing".to_string(),
        author: "reviewer".to_string(),
        created_at: "2024-01-15T10:00:00Z".to_string(),
        url: "https://github.com/owner/repo/pull/1#discussion_r12345".to_string(),
        path: Some("src/app.rs".to_string()),
        line: Some(42),
        side: Some("RIGHT".to_string()),
        is_review_comment: true,
        is_draft: false,
        state: Some("submitted".to_string()),
        is_mine: true,
        review_id: Some(9999),
        in_reply_to_id: None,
        outdated: Some(false),
    };
    
    let json = serde_json::to_value(&comment).unwrap();
    assert_eq!(json["id"], 12345);
    assert_eq!(json["line"], 42);
    assert_eq!(json["side"], "RIGHT");
    assert_eq!(json["is_mine"], true);
    assert_eq!(json["outdated"], false);
}

/// Test Case 2.8: PullRequestComment file-level (no line)
#[test]
fn test_pr_comment_file_level() {
    use crate::models::PullRequestComment;
    
    let comment = PullRequestComment {
        id: 67890,
        body: "General file feedback".to_string(),
        author: "reviewer".to_string(),
        created_at: "2024-01-15T11:00:00Z".to_string(),
        url: "https://github.com/owner/repo/pull/1#discussion_r67890".to_string(),
        path: Some("README.md".to_string()),
        line: None,
        side: None,
        is_review_comment: true,
        is_draft: false,
        state: None,
        is_mine: false,
        review_id: None,
        in_reply_to_id: None,
        outdated: None,
    };
    
    let json = serde_json::to_value(&comment).unwrap();
    assert_eq!(json["path"], "README.md");
    assert!(json["line"].is_null());
    assert!(json["side"].is_null());
}

/// Test Case 2.9: PullRequestReview with pending state
#[test]
fn test_pr_review_pending() {
    use crate::models::PullRequestReview;
    
    let review = PullRequestReview {
        id: 11111,
        state: "PENDING".to_string(),
        author: "reviewer".to_string(),
        submitted_at: None,
        body: Some("Draft review".to_string()),
        html_url: Some("https://github.com/owner/repo/pull/1#pullrequestreview-11111".to_string()),
        commit_id: Some("abc123".to_string()),
        is_mine: true,
    };
    
    let json = serde_json::to_value(&review).unwrap();
    assert_eq!(json["state"], "PENDING");
    assert!(json["submitted_at"].is_null());
    assert_eq!(json["is_mine"], true);
}

/// Test Case 2.10: PrUnderReview serializes for sidebar
#[test]
fn test_pr_under_review_serialization() {
    use crate::models::PrUnderReview;
    
    let pr = PrUnderReview {
        owner: "facebook".to_string(),
        repo: "react".to_string(),
        number: 123,
        title: "Fix hooks".to_string(),
        has_local_review: true,
        has_pending_review: false,
        viewed_count: 5,
        total_count: 10,
        local_folder: None,
    };
    
    let json = serde_json::to_value(&pr).unwrap();
    assert_eq!(json["owner"], "facebook");
    assert_eq!(json["repo"], "react");
    assert_eq!(json["number"], 123);
    assert_eq!(json["has_local_review"], true);
    assert_eq!(json["viewed_count"], 5);
    assert_eq!(json["total_count"], 10);
}

/// Test Case 2.11: PrUnderReview with local folder
#[test]
fn test_pr_under_review_local_folder() {
    use crate::models::PrUnderReview;
    
    let pr = PrUnderReview {
        owner: "__local__".to_string(),
        repo: "local".to_string(),
        number: 1,
        title: "Local review".to_string(),
        has_local_review: true,
        has_pending_review: false,
        viewed_count: 3,
        total_count: 7,
        local_folder: Some("C:/Users/me/docs".to_string()),
    };
    
    let json = serde_json::to_value(&pr).unwrap();
    assert_eq!(json["owner"], "__local__");
    assert_eq!(json["repo"], "local");
    assert_eq!(json["local_folder"], "C:/Users/me/docs");
}
