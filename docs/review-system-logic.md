# Review System Logic: Local vs GitHub Reviews

## Overview

The application supports two types of reviews:
1. **Local Reviews** - Draft reviews stored in SQLite, not yet submitted to GitHub
2. **GitHub Pending Reviews** - Reviews created on GitHub but not yet submitted

## Review Identification

### Local Reviews
- **Storage**: SQLite database via `cmd_local_*` commands
- **ID**: Uses the PR number as the review ID (positive integer)
- **html_url**: `null` (no GitHub URL yet)
- **Not in reviews array**: Local reviews do NOT appear in `prDetail.reviews` from the server
- **Detection**: `!reviews.some(r => r.id === pendingReview.id)` OR `pendingReview.html_url === null`

### GitHub Pending Reviews
- **Storage**: GitHub API
- **ID**: Unique GitHub review ID (positive integer, different from PR number)
- **html_url**: Valid GitHub URL (e.g., `https://github.com/owner/repo/pull/123#pullrequestreview-456`)
- **In reviews array**: Appears in `prDetail.reviews` with `state: "PENDING"` and `is_mine: true`
- **Detection**: `reviews.some(r => r.id === pendingReview.id && r.state === "PENDING" && r.is_mine)`

## Key Operations

### 1. Add Comment

**File**: `submitFileCommentMutation` (lines 1625-1690)

**Logic**:
- Checks `mode` parameter ("single" or "review") or if `pendingReviewId` exists
- **Review mode** (`mode === "review"` OR `pendingReviewId !== null`):
  - Uses `cmd_local_add_comment` to store in SQLite
  - Comment is part of a draft review
- **Single mode**:
  - Uses `cmd_add_comment` to post directly to GitHub
  - Creates immediate published comment

**Current Status**: ✅ Correct
- Properly distinguishes based on mode/pendingReviewId
- Local comments stored with `review_id: pendingReview.id`

### 2. Submit Review

**File**: `submitReviewMutation` (lines 1763-1804)

**Logic**:
```typescript
const isGithubPendingReview = pendingReview && 
  reviews.some(r => r.id === pendingReview.id && r.state === "PENDING" && r.is_mine);

if (isGithubPendingReview) {
  // GitHub: cmd_submit_pending_review
  invoke("cmd_submit_pending_review", { reviewId, number, ... });
} else {
  // Local: cmd_submit_local_review
  invoke("cmd_submit_local_review", { prNumber, ... });
}
```

**Current Status**: ✅ Correct
- Checks if review exists in server's reviews array
- GitHub reviews are submitted via API with review ID
- Local reviews are submitted via SQLite data, creates new GitHub review

**Issue Fixed**: Previously used `pendingReview.id > 0` which failed because local reviews also have positive IDs (PR number)

### 3. Delete Review

**File**: `confirmDeleteReview` (lines 2057-2088)

**Logic**:
```typescript
const isGithubReview = reviews.some(r => 
  r.id === pendingReview.id && 
  r.state === "PENDING" && 
  r.is_mine
);

if (isGithubReview) {
  // GitHub review - use deleteReviewMutation
  deleteReviewMutation.mutate(pendingReview.id);
} else {
  // Local review - clear from database
  invoke("cmd_local_clear_review", { owner, repo, prNumber, prTitle });
}
```

**Current Status**: ✅ Correct
- Uses same detection logic as Submit Review for consistency
- Checks if review exists in server's reviews array
- GitHub reviews deleted via API with review ID
- Local reviews cleared from SQLite database

### 4. Update Comment

**File**: `updateCommentMutation` (lines 1838-1879)

**Logic**:
```typescript
const isLocalComment = editingComment?.url === "#" || !editingComment?.url;

if (isLocalComment) {
  invoke("cmd_local_update_comment", { commentId, body });
} else {
  invoke("cmd_github_update_comment", { owner, repo, commentId, body });
}
```

**Current Status**: ✅ Correct
- Local comments have `url: "#"` (set when converting from SQLite)
- GitHub comments have full URLs
- Properly distinguishes and calls appropriate backend

### 5. Delete Comment

**File**: `deleteCommentMutation` (lines 1885-1925)

**Logic**:
```typescript
const isLocalComment = editingComment?.url === "#" || !editingComment?.url;

if (isLocalComment) {
  invoke("cmd_local_delete_comment", { commentId });
} else {
  invoke("cmd_github_delete_comment", { owner, repo, commentId });
}
```

**Current Status**: ✅ Correct
- Same detection as Update Comment
- Properly routes to local vs GitHub backend

## Review Lifecycle

### Creating a Local Review

1. User clicks "Start review" button
2. `startReviewMutation` calls `cmd_local_start_review`
3. Creates fake review object:
   ```typescript
   {
     id: prDetail.number,  // PR number as ID
     state: "PENDING",
     html_url: null,       // No GitHub URL yet
     is_mine: true
   }
   ```
4. Sets as `pendingReviewOverride`

### Loading Local Comments

1. When opening file comments or showing review
2. `loadLocalComments()` calls `cmd_local_get_comments`
3. Converts to `PullRequestComment[]` format with:
   - `url: "#"` (marker for local comments)
   - `is_draft: true`
   - `review_id: pendingReview.id` (PR number)

### GitHub Pending Review

1. Created via GitHub web UI "Start a review"
2. Fetched in `prDetail.reviews` array
3. Has unique GitHub review ID
4. `pendingReviewFromServer` finds it via `state === "PENDING" && is_mine`
5. Comments fetched via `cmd_get_pending_review_comments`

## Best Practices for Detection

### Recommended Check Order

1. **For reviews**:
   ```typescript
   // Most reliable: check server reviews array
   const isGithubReview = reviews.some(r => 
     r.id === pendingReview.id && 
     r.state === "PENDING" && 
     r.is_mine
   );
   ```

2. **For comments**:
   ```typescript
   // Check URL marker
   const isLocalComment = comment.url === "#" || !comment.url;
   ```

3. **For review existence**:
   ```typescript
   // Check html_url as fallback
   const hasGithubUrl = pendingReview.html_url !== null;
   ```

## Known Edge Cases

1. **PR number collision**: Local review uses PR number as ID. If GitHub review ID happens to equal PR number, collision could occur. This is unlikely but possible.
   - **Mitigation**: Always check `reviews.some()` for GitHub reviews

2. **Transitioning local to GitHub**: When local review is submitted, it becomes a GitHub review
   - Old local review ID (PR number) is replaced by new GitHub review ID
   - Comments are re-associated with new review ID
   - Local SQLite data is cleared

3. **Multiple pending reviews**: GitHub only allows one pending review per user per PR
   - Application enforces this through `pendingReviewFromServer` finding single review
   - Local reviews can coexist with GitHub pending reviews (user must choose)

## Backend Commands

### Local Storage (SQLite)
- `cmd_local_start_review` - Initialize local review
- `cmd_local_add_comment` - Add comment to local review
- `cmd_local_get_comments` - Retrieve local comments
- `cmd_local_update_comment` - Update local comment
- `cmd_local_delete_comment` - Delete local comment
- `cmd_local_clear_review` - Delete entire local review
- `cmd_submit_local_review` - Submit local review to GitHub

### GitHub API
- `cmd_add_comment` - Post single comment immediately
- `cmd_get_pending_review_comments` - Fetch pending review comments
- `cmd_submit_pending_review` - Submit existing GitHub review
- `cmd_delete_review` - Delete GitHub review
- `cmd_github_update_comment` - Update GitHub comment
- `cmd_github_delete_comment` - Delete GitHub comment

## Summary

All three major review operations now use **consistent detection logic**:

| Operation | Detection Method | Status |
|-----------|-----------------|--------|
| Submit Review | `reviews.some()` check | ✅ Correct |
| Delete Review | `reviews.some()` check | ✅ Correct |
| Add Comment | mode/pendingReviewId | ✅ Correct |
| Update Comment | URL marker | ✅ Correct |
| Delete Comment | URL marker | ✅ Correct |

The system reliably distinguishes between local and GitHub reviews/comments across all operations.

## Recommended Future Improvements

1. **Use negative IDs for local reviews** instead of PR number to avoid potential collision
   - Change `startReviewMutation` to use `-1` or `-prDetail.number`
   - Update all detection logic to check `id < 0`
   - This would simplify detection to a single check: `pendingReview.id < 0`

2. **Consolidate detection logic** into reusable helper functions:
   ```typescript
   const isGithubPendingReview = (review) => 
     reviews.some(r => r.id === review.id && r.state === "PENDING" && r.is_mine);
   
   const isLocalComment = (comment) => 
     comment.url === "#" || !comment.url;
   ```

3. **Add validation** to prevent operations on wrong review type:
   - Verify review exists in `reviews` array before GitHub API operations
   - Check SQLite for local data before local operations
   - Provide clear error messages when detection fails

4. **Add logging** for debugging review type detection:
   - Log which path is taken (local vs GitHub) for each operation
   - Include review ID and detection criteria in logs
   - Helps troubleshoot edge cases in production
