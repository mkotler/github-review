# app/src/App.tsx

**Path:** `app/src/App.tsx`

**Last Updated:** November 2025

**Lines of Code:** 2636

## Capabilities Provided

This is the main React component that implements the complete GitHub pull request review UI. It provides a comprehensive desktop interface for browsing repositories, viewing pull requests, reading file changes with syntax highlighting, composing and managing comments, and submitting reviews. The component integrates Monaco Editor for code viewing with side-by-side diff support, markdown preview with scroll synchronization, local SQLite storage for draft reviews with crash recovery, and full GitHub API integration for PR operations. Key features include OAuth authentication flow, repository and PR navigation, file-level and line-level commenting (both immediate and review-based), local draft comment management, pending review workflows, and AsyncImage component for rendering embedded images in markdown previews.

## Type Definitions

### AuthStatus
User authentication state with GitHub login and avatar URL.

### PullRequestSummary
Lightweight PR listing data (number, title, author, updated timestamp, branch).

### PullRequestDetail
Complete PR data including files with base/head content, comments, reviews, and user-specific filtering.

### PullRequestFile
File change with path, status, additions/deletions, patch, content for both versions, and language.

### PullRequestComment
Unified comment type for both review comments (file-specific) and issue comments (general), with draft state tracking.

### PullRequestReview
Review submission with state (PENDING, APPROVED, CHANGES_REQUESTED, COMMENTED) and ownership flag.

### RepoRef
Repository identifier with owner and repo name.

### FileLanguage
File type for syntax highlighting: "markdown" | "yaml".

---

## Components

### AsyncImage

**Purpose:** Asynchronously loads and renders images embedded in markdown files by fetching content from GitHub via Tauri backend.

**Props:**
- `owner: string` - Repository owner
- `repo: string` - Repository name
- `reference: string` - Git commit SHA or branch reference
- `path: string` - Image file path within repository
- `alt?: string` - Alt text for accessibility

**Behavior:**
- Invokes `cmd_fetch_file_content` Tauri command on mount
- Converts base64 response to data URL with appropriate MIME type
- Determines MIME type from file extension (png, jpg, gif, svg, webp)
- Displays placeholder text if image fetch fails (404)
- Returns null while loading to avoid flicker
- Includes cleanup to cancel fetches on unmount

**Usage:** Integrated with ReactMarkdown's `components` prop to replace `<img>` tags with authenticated image fetching.

---

### App (Main Component)

**Purpose:** Root application component containing all UI state, data fetching, and event handling.

## State Management

### Authentication State
- `authQuery` - TanStack Query for authentication status
- `loginMutation` - OAuth flow mutation
- `logoutMutation` - Logout mutation with cache clearing

### Repository & PR State
- `repoRef` - Currently selected repository (owner/repo)
- `repoInput` - Repository input field value
- `selectedPr` - Currently selected PR number
- `selectedFilePath` - Currently selected file path
- `showClosedPRs` - Toggle for showing closed/all PRs vs open only

### Data Queries
- `pullsQuery` - List of pull requests for selected repository
- `pullDetailQuery` - Detailed PR data with files, comments, reviews

### Comment State
- `commentDraft` - General comment composer text
- `fileCommentDraft` - File comment composer text
- `fileCommentLine` - Selected line number for file comment
- `fileCommentMode` - "single" (immediate) or "review" (pending)
- `fileCommentSide` - "RIGHT" (head) or "LEFT" (base) side of diff
- `fileCommentIsFileLevel` - File-level vs line-level comment flag
- `localComments` - Draft comments stored in SQLite
- `editingComment` - Comment currently being edited

### Review State
- `pendingReviewOverride` - Manually tracked pending review state
- `pendingReview` - Computed current pending review (from server or override)

### UI State
- `isSidebarCollapsed` - Sidebar visibility toggle
- `isRepoPanelCollapsed` - Repository panel collapse state
- `isPrPanelCollapsed` - PR list panel collapse state
- `isInlineCommentOpen` - File comment composer visibility
- `isGeneralCommentOpen` - General comment composer visibility
- `isUserMenuOpen` - User menu dropdown visibility
- `showDiff` - Toggle between single view and side-by-side diff
- `showSourceMenu` - Source view dropdown (HEAD, BASE, Diff)
- `showDeleteConfirm` - Delete confirmation modal state

### Layout State
- `splitRatio` - Horizontal split between editor and preview (0-1)
- `sidebarWidth` - Sidebar width in pixels (minimum 320px)
- `isResizing` - Active resize operation flag
- `isSidebarResizing` - Active sidebar resize flag

### Refs
- `editorRef` - Monaco Editor instance reference
- `previewViewerRef` - Markdown preview scroll container
- `workspaceBodyRef` - Main workspace container
- `appShellRef` - Root app container
- `userMenuRef` - User menu dropdown for click-outside detection
- `sourceMenuRef` - Source menu dropdown for click-outside detection
- `isScrollingSyncRef` - Flag to prevent scroll sync loops

---

## Key Functionality

### Authentication Flow
- OAuth login via `cmd_start_github_oauth` opens browser and waits for callback
- Authentication status cached in TanStack Query
- Logout clears auth token from system keyring and all query caches
- User menu displays avatar and login name

### Repository Management
- Repository input validates format (owner/repo)
- Fetches PR list on repository selection
- Displays PR count and refresh button
- Supports filtering open vs all PRs

### Pull Request Viewing
- List view with number, title, author, branch, last updated
- Detail view fetches files, comments, reviews
- Filters "my comments" based on current user login
- Displays file changes grouped by path

### File Viewing
- Monaco Editor with markdown/yaml syntax highlighting
- Three view modes: HEAD only, BASE only, side-by-side diff
- Diff Editor shows inline changes with color coding
- Markdown preview with scroll synchronization
- Preview supports GitHub Flavored Markdown (GFM), frontmatter, raw HTML (sanitized)

### Scroll Synchronization
- Links Monaco Editor scroll position to markdown preview scroll
- Bidirectional sync (scroll either pane, other follows)
- Uses line-to-percentage mapping for Monaco
- Debounced to prevent infinite loops
- Respects user-initiated scrolls vs programmatic scrolls

### Comment Management

**General Comments:**
- Post to PR conversation (not file-specific)
- Submitted immediately as standalone review

**File Comments:**
- Single mode: Post immediately as standalone review comment
- Review mode: Attach to pending review for batch submission
- Line-level: Select line number and side (LEFT/RIGHT)
- File-level: Comment on file without specific line (single mode only per GitHub API limitation)

**Local Draft Comments:**
- Stored in SQLite via `cmd_add_pending_comment`
- Displayed in UI with "DRAFT" badge
- Editable and deletable before submission
- Survive application crashes (log files for recovery)
- Loaded from SQLite when viewing PR

### Review Workflow

**Start Review:**
- Creates pending review via `cmd_start_pending_review`
- Pending review tracked in state and SQLite
- Only one pending review per PR per user (GitHub limitation)

**Add Comments to Review:**
- File comments in "review" mode attach to pending review
- Comments stored locally until review is submitted
- Displayed with "DRAFT" badge in UI

**Submit Review:**
- Posts all draft comments to GitHub via `cmd_submit_review`
- User selects verdict: Approve, Request Changes, or Comment
- Optional review summary comment
- Clears local storage after successful submission
- Refetches PR detail to show submitted review

**Abandon Review:**
- Deletes pending review from GitHub
- Clears local storage
- Marks log file as "ABANDONED"

### Comment Editing & Deletion
- Edit and delete buttons for "my comments"
- Edit updates comment via `cmd_update_review_comment`
- Delete removes comment via `cmd_delete_review_comment`
- Delete confirmation modal for safety
- Refetches PR detail after mutations

### UI Layout

**Sidebar (Resizable):**
- Repository selector
- PR list with search/filter
- Collapsible sections
- Minimum width: 320px

**Main Content Area:**
- Top toolbar: User menu, devtools, file selector, view mode toggle
- Split view: Editor/diff on left, preview on right
- Resizable split ratio (horizontal drag handle)
- Comment composers (inline and general) as overlays

**Comment Display:**
- Comment list below preview
- Groups file comments by file path
- Shows general comments separately
- Draft comments marked visually
- Edit/delete actions for owned comments

---

## Monaco Editor Integration

### Configuration
- Language: "markdown" or "yaml" based on file
- Theme: "vs-dark" (dark mode)
- Read-only: true (viewing, not editing)
- Minimap: disabled
- Line numbers: enabled
- Word wrap: enabled

### Diff Editor
- Modified Editor (right): HEAD content
- Original Editor (left): BASE content
- Inline diff view with syntax highlighting
- Scroll sync between modified and original

---

## Markdown Preview Features

### Plugins
- `remark-gfm` - GitHub Flavored Markdown (tables, strikethrough, task lists)
- `remark-frontmatter` - YAML frontmatter parsing
- `rehype-raw` - Allow raw HTML in markdown
- `rehype-sanitize` - Sanitize HTML to prevent XSS

### Custom Components
- `img` replaced with `AsyncImage` for authenticated image loading
- Handles relative image paths (resolves based on markdown file location)

---

## Error Handling

### API Errors
- GitHub SSO authorization errors displayed with instructions
- Network errors shown in UI with retry options
- Authentication errors redirect to login

### User Feedback
- Success messages for comment submissions (auto-dismiss after 2 seconds)
- Error messages for failed operations (persistent until dismissed)
- Loading states for all async operations
- Confirmation dialogs for destructive actions

---

## Keyboard Shortcuts

**Shift + D:**
- Opens devtools window (for debugging Tauri backend)

---

## Performance Optimizations

### Memoization
- `useMemo` for computed values (sorted files, filtered comments)
- `useCallback` for event handlers to prevent re-renders
- Query caching via TanStack Query (automatic deduplication)

### Conditional Rendering
- Queries disabled when dependencies not met
- Components unmounted when not visible
- Lazy loading of Monaco Editor

### Debouncing
- Scroll sync debounced to prevent excessive updates
- Success/error messages auto-dismiss with timeout

---

## Dependencies

### External Libraries
- `react` - Core framework
- `@tanstack/react-query` - Server state management
- `@tauri-apps/api/core` - Tauri command invocation
- `react-markdown` - Markdown rendering
- `remark-gfm` - GitHub Flavored Markdown
- `remark-frontmatter` - YAML frontmatter support
- `rehype-raw` - Raw HTML support
- `rehype-sanitize` - HTML sanitization
- `@monaco-editor/react` - Monaco Editor wrapper
- `yaml` - YAML parsing for frontmatter

### Tauri Commands Used

**Authentication:**
- `cmd_check_auth_status` - Get current auth state
- `cmd_start_github_oauth` - Start OAuth flow
- `cmd_logout` - Clear auth token

**Pull Requests:**
- `cmd_list_pull_requests` - Fetch PR list
- `cmd_get_pull_request` - Fetch PR details with files and comments

**Comments:**
- `cmd_submit_general_comment` - Post general comment
- `cmd_submit_file_comment` - Post file comment (single or review mode)
- `cmd_update_review_comment` - Edit existing comment
- `cmd_delete_review_comment` - Delete comment

**Reviews:**
- `cmd_start_pending_review` - Create pending review
- `cmd_submit_review` - Submit pending review with verdict
- `cmd_delete_pending_review` - Delete pending review from GitHub
- `cmd_abandon_pending_review` - Abandon review (marks log file)

**Local Storage:**
- `cmd_add_pending_comment` - Store draft comment in SQLite
- `cmd_update_pending_comment` - Update draft comment
- `cmd_delete_pending_comment` - Delete draft comment
- `cmd_get_pending_review_comments` - Fetch draft comments for review
- `cmd_get_review_metadata` - Fetch review metadata

**Utilities:**
- `cmd_fetch_file_content` - Fetch file content (for AsyncImage)
- `cmd_open_devtools` - Open devtools window

---

## Architecture Patterns

### Container/Presenter Pattern
- App component acts as container with all state and logic
- Minimal presentational components (AsyncImage only)
- All UI rendering inline in App component

### Query-Based Data Flow
1. User selects repository → Query fetches PR list
2. User selects PR → Query fetches PR details
3. Data cached automatically by TanStack Query
4. Mutations update cache optimistically or refetch

### Local-First Comments
1. User starts review → Creates pending review in GitHub + SQLite
2. User adds comments → Stored in SQLite (draft)
3. User submits review → Posts all comments to GitHub, clears SQLite
4. Log files preserve history for crash recovery

---

## Known Limitations

### GitHub API Constraints
- Cannot start review with file-level comment via REST API (requires line selection)
- Only one pending review per user per PR
- SSO authorization may be required for organization repositories

### UI Constraints
- Monaco Editor does not support touch gestures
- Large diffs may cause performance issues
- Markdown preview does not support all GitHub-specific features

---

## Future Enhancement Opportunities
- Multi-file comment composers
- Keyboard navigation for PR list
- Comment threading visualization
- Syntax highlighting for more languages
- Drag-and-drop image uploads
- Markdown editing mode
- PR creation and updating
- Branch management
