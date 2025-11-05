# PR Comments Feature

## Overview

The PR Comments feature provides a dedicated interface for viewing and creating pull request-level (issue) comments, separate from file review comments. This allows users to provide general feedback on the entire pull request without targeting specific code lines.

## User Interface

### Access

The PR Comments pane is accessed via a menu in the Files panel:

1. Click the **"…"** menu button in the Files panel header
2. Select **"View PR Comments"** from the dropdown menu
3. The Files list is replaced with the PR Comments view

### Navigation

- **From Files to PR Comments**: Click "…" menu → "View PR Comments"
- **From PR Comments to Files**: Click "…" menu → "View Files"
- **Automatic reset**: Selecting a different PR automatically returns to Files view

The menu intelligently shows only the relevant option:
- When viewing Files: Shows "View PR Comments"
- When viewing PR Comments: Shows "View Files"

### PR Comments View

The PR Comments pane has two modes:

#### 1. Comment List Mode (default when comments exist)

Displays all PR-level comments with:
- Author name and avatar
- Comment timestamp (relative time)
- Comment body with full markdown rendering
- Custom scrollbar matching the application theme

Footer includes:
- **"Add PR Comment"** button to open the composer

#### 2. Comment Composer Mode

Shown when:
- No PR-level comments exist yet (auto-opens)
- User clicks "Add PR Comment" button

Features:
- Full-width textarea: "Share your thoughts on this change…"
- **"Post comment"** button submits immediately to GitHub
- After posting, returns to comment list view
- No border/box styling for clean integration

## Technical Implementation

### State Management

Three boolean state variables control the feature:

```typescript
const [showFilesMenu, setShowFilesMenu] = useState(false);
const [isPrCommentsView, setIsPrCommentsView] = useState(false);
const [isPrCommentComposerOpen, setIsPrCommentComposerOpen] = useState(false);
```

- **showFilesMenu**: Controls visibility of the "…" dropdown menu
- **isPrCommentsView**: Toggles between Files list and PR Comments pane
- **isPrCommentComposerOpen**: Toggles between comment list and composer within PR Comments view

### Comment Filtering

PR-level comments are distinguished from file review comments using the `is_review_comment` field:

```typescript
const prLevelComments = useMemo(() => 
  comments.filter(c => !c.is_review_comment), 
  [comments]
);
```

This ensures only issue-level comments appear in the PR Comments pane, while file-specific review comments remain in the inline file view.

### Data Flow

1. **Loading Comments**: Uses existing `pullDetailQuery` which fetches all comments
2. **Filtering**: `prLevelComments` memo filters for non-review comments
3. **Posting**: Uses existing `submitCommentMutation` which calls `cmd_add_comment`
4. **Auto-refresh**: After posting, mutation invalidates queries and returns to list view

### Component Structure

Located in `App.tsx` starting around line 3130:

```tsx
{isPrCommentsView ? (
  <div className="pr-comments-view">
    {isPrCommentComposerOpen ? (
      // Composer mode
      <div className="pr-comment-composer">
        <form onSubmit={handleCommentSubmit}>
          <textarea />
          <button>Post comment</button>
        </form>
      </div>
    ) : (
      // List mode
      <>
        <div className="pr-comments-list">
          {prLevelComments.map(comment => (
            <div className="pr-comment">
              <div className="pr-comment__header">
                <span className="pr-comment__author">{comment.user.login}</span>
                <span className="pr-comment__date">{relativeTime}</span>
              </div>
              <div className="pr-comment__body">
                <ReactMarkdown>{comment.body}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
        <div className="pr-comments-view__footer">
          <button onClick={() => setIsPrCommentComposerOpen(true)}>
            Add PR Comment
          </button>
        </div>
      </>
    )}
  </div>
) : (
  // Files list view
)}
```

### CSS Styling

Key styles defined in `App.css` starting around line 2037:

- **`.pr-comments-view`**: Flex container for full height
- **`.pr-comments-list`**: Scrollable list with custom scrollbar (6px width, themed)
- **`.pr-comment`**: Individual comment card with background and border
- **`.pr-comment__header`**, **`.pr-comment__author`**, **`.pr-comment__date`**: Comment metadata styling
- **`.pr-comment__body`**: Comment text with markdown rendering
- **`.pr-comments-view__footer`**: Footer with border and background for "Add PR Comment" button
- **`.pr-comment-composer`**: Container for composer mode
- **`.comment-composer--pr-pane`**: Form styling with no border/background (overrides base class)

### Click-Outside Detection

Uses `filesMenuRef` to detect clicks outside the menu:

```typescript
const filesMenuRef = useRef<HTMLDivElement | null>(null);

useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    if (filesMenuRef.current && !filesMenuRef.current.contains(event.target as Node)) {
      setShowFilesMenu(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [showFilesMenu]);
```

### Auto-Navigation on PR Change

When user selects a different PR, the view automatically resets to Files:

```typescript
onClick={() => {
  setSelectedPr(pr.number);
  setSelectedFilePath(null);
  setIsPrCommentsView(false);
  setIsPrCommentComposerOpen(false);
}}
```

This ensures users don't remain in PR Comments view when switching PRs, which could be confusing.

## Backend Integration

### Commands Used

- **`cmd_add_comment`**: Posts a single PR-level comment immediately to GitHub
  - Parameters: `owner`, `repo`, `number`, `body`
  - Returns: Created comment object
  - Used by: `submitCommentMutation`

### Data Models

Comments fetched from GitHub API include:

```typescript
interface Comment {
  id: number;
  body: string;
  user: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  updated_at: string;
  is_review_comment: boolean;  // false for PR-level comments
  html_url: string;
}
```

The `is_review_comment` field is the key discriminator:
- `false`: PR-level (issue) comment - shown in PR Comments pane
- `true`: File review comment - shown inline in file view

## User Workflow

### Viewing PR Comments

1. User opens a pull request
2. User clicks "…" menu in Files panel
3. User selects "View PR Comments"
4. If comments exist: Shows scrollable list of comments
5. If no comments: Auto-opens composer to encourage first comment

### Adding a PR Comment

1. From PR Comments view, click "Add PR Comment" button (or auto-opened if no comments)
2. Type feedback in textarea
3. Click "Post comment"
4. Comment posts immediately to GitHub
5. View returns to comment list showing new comment
6. Query invalidation refreshes all PR data

### Returning to Files

1. Click "…" menu
2. Select "View Files"
3. Files list replaces PR Comments pane

### Switching PRs

1. User clicks different PR in sidebar
2. View automatically resets to Files
3. PR Comments state is cleared

## Design Decisions

### Why Separate from File Comments?

PR-level comments serve a different purpose than inline file review comments:
- **PR Comments**: General feedback, questions about approach, appreciation, meta-discussion
- **File Comments**: Specific code feedback tied to particular lines

Mixing them in the same view creates cognitive load. The separate pane provides clear context.

### Why in Files Menu?

The Files panel is the natural container since:
- It's always visible when reviewing a PR
- It's related to PR content (comments are about the PR)
- It provides symmetry: view files or view comments
- Avoids cluttering the main toolbar

### Why Auto-Open Composer?

When no PR-level comments exist, automatically opening the composer:
- Reduces clicks for first commenter
- Makes the feature discoverable
- Encourages PR-level feedback
- Provides immediate utility

### Why Reset on PR Change?

Automatically returning to Files view when switching PRs:
- Prevents confusion (showing wrong PR's comments)
- Provides consistent starting point
- Matches mental model (new PR = start fresh)
- Reduces state management complexity

### Why No Inline Editing?

PR Comments view is read-only (except for adding new):
- GitHub API supports editing, but complexity isn't justified
- Users can edit on GitHub if needed
- Keeps implementation simple and focused
- Matches review tool scope (create and view, not manage)

## Future Enhancements

Potential improvements not yet implemented:

1. **Edit/Delete PR Comments**: Allow modifying own comments
2. **Comment Reactions**: Show emoji reactions from GitHub
3. **Threaded Replies**: Support for comment threads
4. **Filter by Author**: Show only own comments or specific users
5. **Sort Options**: Newest first, oldest first
6. **Search Comments**: Filter by keyword
7. **Quote Reply**: Copy comment text to composer for reference
8. **Draft Storage**: Save PR comment drafts locally like review comments
9. **Rich Formatting**: Toolbar for markdown shortcuts
10. **Comment Notifications**: Badge count for unread comments

## Related Documentation

- **Review System Logic**: `docs/review-system-logic.md` - Explains local vs GitHub review detection
- **App.tsx Documentation**: `docs/App.tsx.md` - Main component structure
- **Repository Summary**: `docs/summary.md` - Complete codebase map

## Testing Considerations

When testing this feature:

1. **Empty state**: Verify composer auto-opens when no comments exist
2. **List view**: Check multiple comments render correctly with markdown
3. **Post comment**: Ensure comment posts and view returns to list
4. **Menu toggle**: Verify "View PR Comments" / "View Files" toggle works
5. **PR switching**: Confirm view resets to Files when changing PRs
6. **Scrollbar**: Check custom scrollbar appears and matches theme
7. **Click outside**: Verify menu closes when clicking outside
8. **Full width**: Ensure composer textarea/button take full pane width
9. **Filtering**: Confirm only PR-level comments shown (no file comments)
10. **Real-time updates**: Check new comments appear after posting

## Code Locations

### Frontend (App.tsx)

- **State declarations**: Lines 264-268
- **Comment filtering**: Line 485 (`prLevelComments` memo)
- **Submit handler**: Lines 1620-1623 (returns to PR Comments view)
- **PR change handlers**: Lines 1561-1567, 3070-3075 (reset view state)
- **Menu component**: Lines 3095-3128 (Files panel header with dropdown)
- **PR Comments view**: Lines 3130-3226 (list and composer modes)

### Styles (App.css)

- **PR Comments styles**: Lines 2037-2113
- **Scrollbar styling**: Lines 2043-2058
- **Composer override**: Lines 1090-1099

### Backend

- No new backend code required
- Uses existing `cmd_add_comment` command
- Leverages existing comment fetching in `pullDetailQuery`
