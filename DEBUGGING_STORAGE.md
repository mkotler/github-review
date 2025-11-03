# Debugging Local Storage Issues

## Quick Test Steps

### 1. Run the app in dev mode
```bash
cd C:/Code/Tools/github-review/app
npm run tauri dev
```

### 2. Open browser console (F12 or Ctrl+Shift+I)

### 3. Copy and paste this test script:

```javascript
// Test storage functionality by importing the invoke function
import('https://esm.sh/@tauri-apps/api@2/core').then(async (module) => {
  const invoke = module.invoke;
  
  console.log('=== Testing Local Storage ===');
  
  try {
    // Get storage info
    console.log('\n1. Getting storage info...');
    const info = await invoke('cmd_get_storage_info');
    console.log(info);
    
    // Start a review
    console.log('\n2. Starting review...');
    const metadata = await invoke('cmd_local_start_review', {
      owner: 'test',
      repo: 'test-repo',
      prNumber: 123,
      commitId: 'abc123',
      body: 'Test review'
    });
    console.log('✅ Review started:', metadata);
    
    // Add a comment
    console.log('\n3. Adding comment...');
    const comment = await invoke('cmd_local_add_comment', {
      owner: 'test',
      repo: 'test-repo',
      prNumber: 123,
      filePath: 'src/test.ts',
      lineNumber: 42,
      side: 'RIGHT',
      body: 'Test comment',
      commitId: 'abc123'
    });
    console.log('✅ Comment added:', comment);
    
    // Get comments
    console.log('\n4. Getting comments...');
    const comments = await invoke('cmd_local_get_comments', {
      owner: 'test',
      repo: 'test-repo',
      prNumber: 123
    });
    console.log('✅ Comments:', comments);
    
    console.log('\n✅ ALL TESTS PASSED!');
    console.log('\n📁 Check the log file at the path shown in step 1');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
  }
}).catch(err => {
  console.error('Failed to load Tauri API:', err);
});
```

### 4. Check the output

Look for:
- **Storage Directory path** - This is where the database and logs are stored
- **DB Exists** - Should be `true` after first run
- **Log Dir Exists** - Should be `true` after first run

### 5. Find your log file

The console output will show something like:
```
Storage Directory: "C:\\Users\\YourName\\AppData\\Roaming\\com.github-review.app"
Log Directory: "C:\\Users\\YourName\\AppData\\Roaming\\com.github-review.app\\review_logs"
```

Navigate to that directory and check for:
- `reviews.db` - SQLite database
- `review_logs/test-test-repo-123.log` - Log file

## Common Issues

### Issue 1: "Storage not initialized" error

**Cause**: The app failed to initialize storage on startup

**Solution**: Check the terminal output for errors like:
```
Failed to initialize review storage
```

Look for permission errors or disk space issues.

### Issue 2: No log file created

**Cause**: The `write_log` function might not be getting called

**Solution**: 
1. Check the terminal for log messages:
   ```
   Writing log file for test/test-repo#123
   Log file written successfully to ...
   ```

2. Make sure you're calling `cmd_local_add_comment` (which triggers log write)

### Issue 3: Can't find storage directory

**Solution**: Run this in the console:
```javascript
const { invoke } = window.__TAURI__.core;
invoke('cmd_get_storage_info').then(console.log);
```

This will show you exactly where the files are stored.

## Manual Verification

### Check database contents:
```bash
# Install sqlite3 if needed: npm install -g sqlite3

# Find your database path from the storage info
sqlite3 "C:/Users/YourName/AppData/Roaming/com.github-review.app/reviews.db"

# Then run these commands:
sqlite> .tables
sqlite> SELECT * FROM review_metadata;
sqlite> SELECT * FROM review_comments;
sqlite> .quit
```

### Check log file:
```bash
# Navigate to log directory
cd "C:/Users/YourName/AppData/Roaming/com.github-review.app/review_logs"

# List files
ls -la

# View log file
cat test-test-repo-123.log
```

## Expected Log File Format

```
# Review for PR #123
# Repository: test/test-repo
# Created: 2025-11-02T...
# Commit: abc123
# Review Body: Test review
# Total Comments: 1

src/test.ts:
    Line 42 (RIGHT): Test comment
```

## Integration with Your Frontend

Once you confirm the storage is working with the test script, you can integrate it into your React components:

```typescript
// In your PR review component
import { invoke } from '@tauri-apps/api/core';

// Start a review when user clicks "Start Review"
const handleStartReview = async () => {
  try {
    const metadata = await invoke('cmd_local_start_review', {
      owner: prDetail.owner,
      repo: prDetail.repo,
      prNumber: prDetail.number,
      commitId: prDetail.head_sha,
      body: reviewBody || null
    });
    
    setPendingReviewId(metadata.pr_number);
    console.log('Review started, log file will be at:', metadata);
  } catch (error) {
    console.error('Failed to start review:', error);
    alert('Failed to start review: ' + error);
  }
};

// Add a comment when user reviews a line
const handleAddComment = async (filePath, lineNumber, commentBody) => {
  try {
    const comment = await invoke('cmd_local_add_comment', {
      owner: prDetail.owner,
      repo: prDetail.repo,
      prNumber: prDetail.number,
      filePath,
      lineNumber,
      side: 'RIGHT',
      body: commentBody,
      commitId: prDetail.head_sha
    });
    
    console.log('Comment added and log file updated');
    // Refresh your comments list
    loadComments();
  } catch (error) {
    console.error('Failed to add comment:', error);
  }
};

// Load comments when viewing PR
const loadComments = async () => {
  try {
    const comments = await invoke('cmd_local_get_comments', {
      owner: prDetail.owner,
      repo: prDetail.repo,
      prNumber: prDetail.number
    });
    
    setLocalComments(comments);
  } catch (error) {
    console.error('Failed to load comments:', error);
  }
};
```

## Logging

Check the terminal/console for these log messages:

```
Creating review storage at "C:\\Users\\..."
Opening database at "C:\\Users\\...\\reviews.db"
Review storage initialized successfully
Starting review for test/test-repo#123
Writing log file for test/test-repo#123
Log file written successfully to "C:\\Users\\...\\review_logs\\test-test-repo-123.log"
```

If you don't see these messages, the storage initialization failed.
