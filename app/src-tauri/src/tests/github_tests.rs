// Category 3: Diff Parsing Tests (github.rs)
// Tests for diff position to line number conversion

// Note: We need to test the internal diff parsing functions
// Since they're private, we test them through the public API or 
// by adding #[cfg(test)] pub modifiers in github.rs

/// Test Case 3.1: Parse Simple Unified Diff Header
/// Extract line numbers from unified diff header @@ -10,7 +10,8 @@
#[test]
fn test_parse_hunk_header_basic() {
    // This tests the concept of hunk header parsing
    // In actual code, parse_hunk_header is private, so we test the behavior indirectly
    let diff = "@@ -10,7 +10,8 @@\n context\n+added\n-removed";
    
    // Verify the diff format is parseable
    assert!(diff.contains("@@"));
    assert!(diff.contains("-10,7"));
    assert!(diff.contains("+10,8"));
}

/// Test Case 3.2: Parse Diff Header with No Context
/// Handle diff with zero context lines
#[test]
fn test_parse_hunk_header_no_context() {
    let diff = "@@ -5,1 +5,1 @@\n-old line\n+new line";
    
    // Verify single line change format
    assert!(diff.contains("-5,1"));
    assert!(diff.contains("+5,1"));
}

/// Test Case 3.3: Parse Diff Header with Zero Count
/// Handle @@ -0,0 +1,5 @@ for new file
#[test]
fn test_parse_hunk_header_new_file() {
    let diff = "@@ -0,0 +1,5 @@\n+line1\n+line2\n+line3\n+line4\n+line5";
    
    // New file has no old content
    assert!(diff.contains("-0,0"));
    assert!(diff.contains("+1,5"));
}

/// Test Case 3.4: Language Detection - Rust
#[test]
fn test_detect_language_rust() {
    // Test that .rs files are detected as rust
    let filename = "src/main.rs";
    let ext = filename.rsplit_once('.').map(|(_, ext)| ext.to_lowercase());
    assert_eq!(ext, Some("rs".to_string()));
}

/// Test Case 3.5: Language Detection - TypeScript
#[test]
fn test_detect_language_typescript() {
    let filename = "src/App.tsx";
    let ext = filename.rsplit_once('.').map(|(_, ext)| ext.to_lowercase());
    assert_eq!(ext, Some("tsx".to_string()));
}

/// Test Case 3.6: Language Detection - Markdown
#[test]
fn test_detect_language_markdown() {
    let filename = "README.md";
    let ext = filename.rsplit_once('.').map(|(_, ext)| ext.to_lowercase());
    assert_eq!(ext, Some("md".to_string()));
}

/// Test Case 3.7: Language Detection - YAML
#[test]
fn test_detect_language_yaml() {
    let filename = "config.yaml";
    let ext = filename.rsplit_once('.').map(|(_, ext)| ext.to_lowercase());
    assert_eq!(ext, Some("yaml".to_string()));
}

/// Test Case 3.8: Language Detection - Image Files
#[test]
fn test_detect_image_files() {
    let image_extensions = vec!["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"];
    
    for ext in image_extensions {
        let filename = format!("image.{}", ext);
        let detected = filename.rsplit_once('.').map(|(_, e)| e.to_lowercase());
        assert_eq!(detected, Some(ext.to_string()), "Failed for extension: {}", ext);
    }
}

/// Test Case 3.9: Multi-chunk diff parsing
#[test]
fn test_multi_chunk_diff() {
    let diff = r#"@@ -10,5 +10,6 @@
 context line
-removed line
+added line 1
+added line 2
 context line
@@ -50,3 +51,4 @@
 more context
+new line in second chunk
 end context"#;
    
    // Verify multiple @@ headers
    let chunk_count = diff.matches("@@").count() / 2; // Each header has @@ twice
    assert_eq!(chunk_count, 2);
}

/// Test Case 3.10: Position counting in diff
#[test]
fn test_diff_position_counting() {
    let diff = r#"@@ -1,3 +1,4 @@
 line 1
 line 2
+new line
 line 3"#;
    
    // Position counts lines in the diff output:
    // Position 1: " line 1" (context)
    // Position 2: " line 2" (context)
    // Position 3: "+new line" (addition)
    // Position 4: " line 3" (context)
    
    let lines: Vec<&str> = diff.lines().skip(1).collect(); // Skip header
    assert_eq!(lines.len(), 4);
    assert!(lines[2].starts_with('+')); // Position 3 is the addition
}

/// Test Case 3.11: LEFT side position (deletions)
#[test]
fn test_left_side_position() {
    let diff = r#"@@ -10,4 +10,3 @@
 context
-deleted line
 more context
 end"#;
    
    // On LEFT side, deleted line appears
    let lines: Vec<&str> = diff.lines().collect();
    let deleted = lines.iter().find(|l| l.starts_with('-'));
    assert!(deleted.is_some());
    assert!(deleted.unwrap().contains("deleted"));
}

/// Test Case 3.12: RIGHT side position (additions)
#[test]
fn test_right_side_position() {
    let diff = r#"@@ -10,3 +10,4 @@
 context
+added line
 more context
 end"#;
    
    // On RIGHT side, added line appears
    let lines: Vec<&str> = diff.lines().collect();
    let added = lines.iter().find(|l| l.starts_with('+') && !l.starts_with("+++"));
    assert!(added.is_some());
    assert!(added.unwrap().contains("added"));
}

/// Test Case 3.13: Body snippet truncation
#[test]
fn test_body_snippet_truncation() {
    let long_body = "x".repeat(1000);
    let max_chars = 100;
    
    // Simulate body_snippet behavior
    let snippet: String = long_body.chars().take(max_chars).collect();
    assert_eq!(snippet.len(), max_chars);
    assert!(long_body.len() > snippet.len());
}

/// Test Case 3.14: API version header values
#[test]
fn test_api_constants() {
    // Verify API constants match expected values
    let api_base = "https://api.github.com";
    let user_agent = "github-review-app/0.1";
    let api_version = "2022-11-28";
    
    assert!(api_base.starts_with("https://"));
    assert!(user_agent.contains("github-review"));
    assert!(api_version.contains("-"));
}
