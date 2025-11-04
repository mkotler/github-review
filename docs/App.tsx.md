# app/src/App.tsx

**Path:** `app/src/App.tsx`

**Last Updated:** November 2025

**Lines of Code:** 3202

## Capabilities Provided

This is the main React component that implements the complete GitHub pull request review UI. It provides a comprehensive desktop interface for browsing repositories, viewing pull requests, reading file changes with syntax highlighting, composing and managing comments, and submitting reviews.

### Recent Enhancements (November 2025)

- **Most Recently Used (MRU) Repositories**: Dropdown menu next to repository input stores up to 10 recently accessed repositories with auto-load functionality and localStorage persistence
- **Comment Count Badges**: Visual indicators on file list showing number of comments per file (includes both published and pending review comments) with tooltip and click-to-navigate
- **File Viewed Tracking**: Checkbox on each file to mark as viewed with state persisted across sessions by PR in localStorage
- **Auto-Navigate to Pending Review**: Automatically opens comment panel when pending review exists with no published comments to guide user to in-progress work
- **Log Folder Access**: Quick access to review logs via "Open Log Folder" menu item for debugging and recovery The component integrates Monaco Editor for code viewing with side-by-side diff support, markdown preview with scroll synchronization, local SQLite storage for draft reviews with crash recovery, and full GitHub API integration for PR operations. Key features include OAuth authentication flow, repository and PR navigation, file-level and line-level commenting (both immediate and review-based), local draft comment management, pending review workflows, and AsyncImage component for rendering embedded images in markdown previews.

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
- `repoMRU` - Most recently used repositories (up to 10, stored in localStorage)
- `showRepoMRU` - Dropdown visibility toggle for MRU list
- `selectedPr` - Currently selected PR number
- `selectedFilePath` - Currently selected file path
- `showClosedPRs` - Toggle for showing closed/all PRs vs open only
- `prSearchFilter` - Search filter text for PR list (searches number, title, author)
- `viewedFiles` - Map of viewed files by PR (stored in localStorage as `viewed-files`)

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
- `hoveredLineRef` - Currently hovered line number for glyph margin decoration
- `decorationsRef` - Monaco Editor decoration IDs for hover state

---

## Key Functionality

### Authentication Flow
- OAuth login via `cmd_start_github_oauth` opens browser and waits for callback
- Authentication status cached in TanStack Query
- Logout clears auth token from system keyring and all query caches
- User menu displays avatar and login name

### Repository Management
- Repository input validates format (owner/repo)
- MRU dropdown stores last 10 repositories with auto-load on click
- Current repository excluded from MRU list to avoid duplication
- MRU persisted in localStorage as `repo-mru` array
- Fetches PR list on repository selection with pagination (100 PRs per page)
- Displays PR count and refresh button
- Supports filtering open vs all PRs via "..." menu
- Real-time PR search by number, title, or author (no re-fetching)
- Search filter cleared automatically when switching repositories
- "Open Log Folder" menu item opens system file explorer to review logs directory

### Pull Request Viewing
- List view with number, title, author, branch, last updated
- Detail view fetches files, comments, reviews
- Filters "my comments" based on current user login
- Progressive file loading: Shows 50 files immediately (metadata only)
- Background preloading of file contents in toc.yml order
- Auto-selects first file on PR load
- **Comment Count Badges**: Displays number of comments per file in file list with tooltip showing count
  - Includes both published and pending review comments
  - Clickable badges navigate to file and open comment panel
  - Auto-fetches pending review comments from GitHub on PR load for immediate display
- **File Viewed Tracking**: Checkbox on each file marks as viewed
  - State persisted per PR in localStorage as `viewed-files` map
  - Survives browser/app restarts
  - Cleared when PR is closed/completed
- **Auto-Navigate to Pending Review**: When PR loads with pending review and no published comments, automatically opens comment panel to show draft comments

### File Viewing
- Monaco Editor with markdown/yaml syntax highlighting
- Three view modes: HEAD only, BASE only, side-by-side diff
- Diff Editor shows inline changes with color coding
- Markdown preview with scroll synchronization
- Preview supports GitHub Flavored Markdown (GFM), frontmatter, raw HTML (sanitized)
- Inline comment creation via hover-to-reveal "+" buttons on line numbers

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
- Line-level: Select line number and side (LEFT/RIGHT) via hover "+" button on line numbers or manual input
- File-level: Comment on file without specific line (single mode only per GitHub API limitation)
- Dual-button UI: Shows "Post comment" (immediate) and "Add to review" or "Start review" (pending) side-by-side

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
- Repository selector with MRU dropdown (down caret icon)
- PR list with search/filter (clears on repo change)
- File list with comment count badges and viewed checkboxes
- Collapsible sections
- Minimum width: 320px
- Auto-expands when user opens comment composer or clicks inline comment button

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
- Glyph margin: enabled for inline comment buttons

### Diff Editor
- Modified Editor (right): HEAD content
- Original Editor (left): BASE content
- Inline diff view with syntax highlighting
- Scroll sync between modified and original

### Inline Comment Buttons

**Hover Detection:**
- Detects mouse hover over line numbers and glyph margin (left of line numbers)
- Dynamically adds "+" button decoration using Monaco decorations API
- Button appears immediately on hover, disappears when mouse leaves area
- Uses `onMouseMove` event with target type checking (GUTTER_GLYPH_MARGIN and GUTTER_LINE_NUMBERS)

**Click Handling:**
- Detects clicks on glyph margin using `onMouseDown` event
- Extracts clicked line number from event position
- Opens inline comment composer with prefilled line number
- Sets comment side to "RIGHT" (HEAD content) automatically
- Comment composer shows two buttons: "Post comment" (immediate) and "Start review" or "Add to review" (based on pending review state)

**CSS Styling:**
- `.monaco-glyph-margin-plus` class renders "+" character in button
- Button styled with rounded corners, subtle background, and hover effects
- Color scheme matches application theme (blue-gray palette)
- Smooth transitions for hover state and scaling

**State Management:**
- `hoveredLineRef` tracks currently hovered line (null when not hovering)
- `decorationsRef` stores Monaco decoration IDs for cleanup
- Decorations updated via `deltaDecorations` API to add/remove dynamically
- Cleanup on component unmount prevents memory leaks

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

### Performance Optimizations

### Progressive Loading Strategy
- **PR List**: Fetches all PRs via pagination (100 per page) in backend
- **File Metadata**: Loads first 50 files instantly (paths, status, additions/deletions only)
- **File Contents**: Fetched on-demand per file (not upfront), cached permanently by commit SHA
- **Background Preloading**: Automatically prefetches file contents one at a time in toc.yml order
- **Smart Caching**: React Query caches all file contents with `staleTime: Infinity` for instant subsequent access
- **Result**: File list appears in <1 second even for PRs with 100+ files; first file is instant (auto-selected)

### Memoization
- `useMemo` for computed values (sorted files, filtered comments, visible files)
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
- `cmd_open_log_folder` - Open system file explorer to review logs directory
- `cmd_get_pending_review_comments` - Fetch pending review comments from GitHub (for auto-loading on PR load)

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
