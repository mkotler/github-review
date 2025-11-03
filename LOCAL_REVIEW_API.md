# Local Review Storage API

This document describes the new Tauri commands for managing pending reviews locally with database persistence and log file redundancy.

## Overview

The local review storage system allows you to:
- Create and manage pending reviews entirely on your local machine
- Store comments in a SQLite database for crash recovery
- Automatically generate human-readable log files for each review
- Edit or delete comments before submitting
- Abandon reviews (marks log file, clears database)
- Submit all comments to GitHub in a single API call

## Storage Locations

- **Database**: `{app_data_dir}/reviews.db`
- **Log Files**: `{app_data_dir}/review_logs/{owner}-{repo}-{pr_number}.log`
  - Subsequent reviews after abandonment: `{owner}-{repo}-{pr_number}-1.log`, etc.

## Log File Format

```
# Review for PR #{pr_number}
# Repository: {owner}/{repo}
# Created: {timestamp}
# Commit: {commit_id}
# Review Body: {optional body text}
# Total Comments: {count}

{file_path}:
    Line {line_number} ({side}): {comment body}
    Line {line_number} ({side}): {comment body}

{another_file_path}:
    Line {line_number} ({side}): {comment body}
```

## Tauri Commands

### 1. Start a Local Review

```typescript
import { invoke } from '@tauri-apps/api/core';

interface ReviewMetadata {
  owner: string;
  repo: string;
  pr_number: number;
  commit_id: string;
  body?: string;
  created_at: string;
  log_file_index: number;
}

const metadata = await invoke<ReviewMetadata>('cmd_local_start_review', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123,
  commitId: 'abc123...',
  body: 'Overall review comment' // optional
});
```

**Note**: If a review already exists for this PR, it returns the existing metadata instead of creating a new one.

### 2. Add a Comment

```typescript
interface ReviewComment {
  id: number;
  owner: string;
  repo: string;
  pr_number: number;
  file_path: string;
  line_number: number;
  side: string; // "LEFT" or "RIGHT"
  body: string;
  commit_id: string;
  created_at: string;
  updated_at: string;
}

const comment = await invoke<ReviewComment>('cmd_local_add_comment', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123,
  filePath: 'src/main.ts',
  lineNumber: 42,
  side: 'RIGHT',
  body: 'This looks good!',
  commitId: 'abc123...'
});
```

**Side effects**: Updates the log file immediately.

### 3. Update an Existing Comment

```typescript
const updatedComment = await invoke<ReviewComment>('cmd_local_update_comment', {
  commentId: 5,
  body: 'Updated comment text'
});
```

**Side effects**: Updates the log file immediately.

### 4. Delete a Comment

```typescript
await invoke('cmd_local_delete_comment', {
  commentId: 5
});
```

**Side effects**: Updates the log file immediately (comment removed).

### 5. Get All Comments for a Review

```typescript
const comments = await invoke<ReviewComment[]>('cmd_local_get_comments', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123
});
```

Comments are returned sorted by file path and line number.

### 6. Get Review Metadata

```typescript
const metadata = await invoke<ReviewMetadata | null>('cmd_local_get_review_metadata', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123
});
```

Returns `null` if no review exists.

### 7. Abandon a Review

```typescript
await invoke('cmd_local_abandon_review', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123
});
```

**Effects**:
- Prepends abandonment notice to the log file
- Deletes review and all comments from the database
- Log file is preserved for email/manual submission
- Next review for this PR will create a new log file with `-1` suffix

### 8. Submit Review to GitHub

```typescript
await invoke('cmd_submit_local_review', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123,
  event: 'APPROVE', // or 'REQUEST_CHANGES', 'COMMENT', or omit for PENDING
  body: 'Final review summary' // optional, overrides metadata body
});
```

**Process**:
1. Retrieves all comments from local storage
2. Creates a single GitHub review with all comments via API
3. On success, clears the review from local database
4. Log file remains unchanged

**Events**:
- `"APPROVE"` - Approve the pull request
- `"REQUEST_CHANGES"` - Request changes
- `"COMMENT"` - Submit review as comment only
- Omit or empty - Submit as pending review (GitHub limitation: only 1 pending review per user)

### 9. Clear a Review (Internal Use)

```typescript
await invoke('cmd_local_clear_review', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123
});
```

Silently removes review from database without modifying log file. Primarily used internally after successful submission.

## Workflow Examples

### Basic Review Workflow

```typescript
// 1. Start a review
const metadata = await invoke('cmd_local_start_review', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123,
  commitId: prDetail.head_sha
});

// 2. Add comments as user reviews files
await invoke('cmd_local_add_comment', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123,
  filePath: 'src/app.ts',
  lineNumber: 10,
  side: 'RIGHT',
  body: 'Great implementation!',
  commitId: prDetail.head_sha
});

// 3. Edit a comment if needed
await invoke('cmd_local_update_comment', {
  commentId: comment.id,
  body: 'Even better implementation!'
});

// 4. Submit to GitHub
await invoke('cmd_submit_local_review', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123,
  event: 'APPROVE',
  body: 'LGTM! Great work.'
});
```

### Abandon and Restart

```typescript
// User decides not to submit this review
await invoke('cmd_local_abandon_review', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123
});

// Later, start a new review (creates new log file with -1 suffix)
await invoke('cmd_local_start_review', {
  owner: 'microsoft',
  repo: 'vscode',
  prNumber: 123,
  commitId: newCommitSha
});
```

## Error Handling

All commands return `Promise<T>` and may throw string errors:

```typescript
try {
  await invoke('cmd_local_add_comment', { ... });
} catch (error) {
  console.error('Failed to add comment:', error);
  // Show user-friendly error message
}
```

Common errors:
- `"Storage not initialized"` - Internal error, shouldn't happen
- `"No pending review found"` - Call `cmd_local_start_review` first
- `"Lock poisoned"` - Database corruption, restart app
- Database/IO errors - Check disk space and permissions

## Integration with Existing Code

You can now replace the old pending review workflow:

**Old way** (created review on GitHub immediately):
```typescript
const review = await invoke('cmd_start_pending_review', { ... });
// Then add comments directly to GitHub
```

**New way** (store locally, submit when ready):
```typescript
const metadata = await invoke('cmd_local_start_review', { ... });
// Add comments locally
await invoke('cmd_local_add_comment', { ... });
// Submit all at once
await invoke('cmd_submit_local_review', { ... });
```

## Benefits

1. **Crash Recovery**: Comments survive application crashes
2. **Email Fallback**: Log files can be sent via email if submission fails
3. **Edit Before Submit**: Full flexibility to modify comments
4. **Atomic Submission**: All comments submitted in one API call
5. **Audit Trail**: Log files preserve review history
6. **Abandonment Support**: Can cancel reviews without trace on GitHub
