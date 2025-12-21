# Frontend Test Cases (React/TypeScript)

**Location:** `app/src/`  
**Test Type:** Unit + Integration + E2E  
**Target Coverage:** 75%+  

**IMPORTANT:** All test cases describe CURRENT ACTUAL BEHAVIOR only, not planned features.

---

## Category 1: Offline Cache (`offlineCache.ts`)

### Test Case 1.1: Store PR Data in IndexedDB
**Description:** Save PR details to offline cache  
**Input:** PR object with number 123, owner "facebook", repo "react"  
**Expected Result:** IndexedDB contains entry with key `pr-facebook-react-123`, cachedAt = current timestamp

### Test Case 1.2: Retrieve Cached PR Data
**Description:** Load PR from cache  
**Input:** Query for PR #123  
**Expected Result:** Returns cached PR object if exists and not expired

### Test Case 1.3: Cached Data Expired (> 7 Days)
**Description:** Cache entry older than TTL should be ignored  
**Setup:** Store PR with cachedAt = 8 days ago  
**Input:** Query for expired PR  
**Expected Result:** Returns `null`, cache entry may be deleted by cleanup

### Test Case 1.4: Cached Data Valid (< 7 Days)
**Description:** Fresh cache entry returned  
**Setup:** Store PR with cachedAt = 2 days ago  
**Input:** Query for PR  
**Expected Result:** Returns cached PR object

### Test Case 1.5: Store File Content with SHA
**Description:** Cache file contents with commit SHA  
**Input:** File content, headSha "abc123", baseSha "def456", owner "facebook", repo "react", path "src/App.tsx"  
**Expected Result:** IndexedDB contains file content with SHA keys

### Test Case 1.6: Retrieve File Content - SHA Match
**Description:** Load file if SHA matches  
**Input:** Query with headSha "abc123", baseSha "def456"  
**Expected Result:** Returns cached file content

### Test Case 1.7: Retrieve File Content - SHA Mismatch
**Description:** Cached file for different commit should not be returned  
**Setup:** Cache file with headSha "abc123"  
**Input:** Query with headSha "xyz789"  
**Expected Result:** Returns `null` (SHA doesn't match)

### Test Case 1.8: Clear Expired Cache Entries
**Description:** Cleanup old entries from IndexedDB  
**Setup:** Store 5 PRs, 3 expired, 2 valid  
**Input:** Call `cleanExpiredCache()`  
**Expected Result:** 3 expired entries deleted, 2 remain

### Test Case 1.9: Cache Miss - Database Access Error
**Description:** Handle IndexedDB errors gracefully  
**Setup:** Simulate IndexedDB failure  
**Input:** Query for PR  
**Expected Result:** Returns `null` or throws caught error, app continues

### Test Case 1.10: Clear PR Cache
**Description:** Delete all cached data for specific PR  
**Input:** Call `clearPRCache("facebook", "react", 123)`  
**Expected Result:** PR detail and all file contents for PR #123 deleted

---

## Category 2: Network Status Hook (`useNetworkStatus.ts`)

### Test Case 2.1: Detect Online Status on Mount
**Description:** Hook initializes with correct online status  
**Setup:** Browser online (`navigator.onLine = true`)  
**Expected Result:** `isOnline = true`

### Test Case 2.2: Detect Offline Status on Mount
**Description:** Initialize with offline status  
**Setup:** Browser offline (`navigator.onLine = false`)  
**Expected Result:** `isOnline = false`

### Test Case 2.3: Transition Online → Offline
**Description:** Detect network loss  
**Setup:** Start online  
**Action:** Fire `offline` event  
**Expected Result:** `isOnline` changes to `false`

### Test Case 2.4: Transition Offline → Online
**Description:** Detect network restored  
**Setup:** Start offline  
**Action:** Fire `online` event  
**Expected Result:** `isOnline` changes to `true`

### Test Case 2.5: Manual Offline Detection via markOffline()
**Description:** Set offline after network error  
**Setup:** isOnline = true  
**Action:** Call `markOffline()`  
**Expected Result:** `isOnline = false`

### Test Case 2.6: Manual Online Detection via markOnline()
**Description:** Set online after successful request  
**Setup:** isOnline = false  
**Action:** Call `markOnline()`  
**Expected Result:** `isOnline = true`

### Test Case 2.7: Cleanup Event Listeners on Unmount
**Description:** No memory leaks  
**Action:** Mount and unmount hook 10 times  
**Expected Result:** No lingering event listeners

---

## Category 3: Component - Comment Submission Form

### Test Case 3.1: Render Comment Form
**Description:** Display comment editor  
**Expected Output:** Textarea, line number input, submit button visible

### Test Case 3.2: Type in Comment Editor - No Lag (After Debounce Fix)
**Description:** Typing is responsive  
**Action:** Type 100 characters rapidly  
**Expected Result:** All characters appear immediately, draft saved to localStorage 300ms after typing stops

### Test Case 3.3: Submit Comment - Validation Error
**Description:** Empty comment not allowed  
**Action:** Click submit with empty textarea  
**Expected Result:** Error message "Add your feedback before submitting"

### Test Case 3.4: Submit Comment - Success Feedback
**Description:** Show success message  
**Action:** Submit valid comment  
**Mock:** Success response from Tauri  
**Expected Result:** Success message displayed, form cleared

### Test Case 3.5: Submit Comment - Error Feedback
**Description:** Show error message  
**Action:** Submit comment  
**Mock:** Error response from Tauri  
**Expected Result:** Error message displayed, comment not cleared (can retry)

### Test Case 3.6: Toggle Between Single and Review Mode
**Description:** Switch submission mode  
**Action:** Click "Add to review" button  
**Expected Result:** Comment saved to review, can continue adding more

### Test Case 3.7: Ctrl+Enter Shortcut Submits
**Description:** Keyboard shortcut  
**Action:** Type comment, press Ctrl+Enter  
**Expected Result:** Comment submitted (same as clicking submit button)

### Test Case 3.8: Line Number Auto-Populated from Glyph Click
**Description:** Click line glyph fills line number  
**Action:** Click glyph on line 42 in Monaco editor  
**Expected Result:** Line number input = "42", comment form opens

### Test Case 3.9: File-Level Comment (No Line Number)
**Description:** Submit comment without line number  
**Action:** Clear line number field  
**Expected Result:** Comment submitted as file-level comment

### Test Case 3.10: Edit Existing Comment
**Description:** Load comment for editing  
**Setup:** Click edit on comment #123  
**Expected Result:** Form pre-filled with comment body, line number, submit button = "Update"

---

## Category 4: Component - File List

### Test Case 4.1: Render File List
**Description:** Display all PR files  
**Input:** PR with 10 files  
**Expected Output:** 10 file items rendered with names and paths

### Test Case 4.2: Highlight Selected File
**Description:** Active file visually distinct  
**Setup:** File "src/app.ts" selected  
**Expected Output:** File has "selected" CSS class, different background color

### Test Case 4.3: Show Viewed Files Indicator
**Description:** Viewed files have checkmark  
**Setup:** 5 files viewed  
**Expected Output:** 5 files show checkmark icon

### Test Case 4.4: Show Comment Count Badge
**Description:** Files with comments show count  
**Setup:** "src/app.ts" has 3 comments  
**Expected Output:** Badge with "3" next to file name

### Test Case 4.5: Filter Files by Type (Markdown/YAML only)
**Description:** Show only markdown/yaml files when filter enabled  
**Action:** Uncheck "Show all file types"  
**Input:** Files: ["app.ts", "README.md", "config.yaml", "styles.css"]  
**Expected Output:** Only "README.md" and "config.yaml" visible

### Test Case 4.6: Hide Reviewed Files
**Description:** Filter out viewed files  
**Action:** Check "Hide reviewed files"  
**Setup:** 5 files viewed out of 10 total  
**Expected Output:** Only 5 unviewed files visible

### Test Case 4.7: Click File Loads Content
**Description:** Navigate to file  
**Action:** Click "src/utils.ts"  
**Expected Result:** `selectedFilePath = "src/utils.ts"`, content loads in Monaco editor

### Test Case 4.8: File Navigation History - Back/Forward Buttons
**Description:** Navigate through file history  
**Setup:** Visited file1 → file2 → file3, currently at file3  
**Action:** Click back button  
**Expected Result:** Navigate to file2, forward button enabled

### Test Case 4.9: Files with Draft Show Draft Icon
**Description:** Unsaved drafts indicated  
**Setup:** Draft exists for "src/app.ts" in localStorage  
**Expected Output:** Draft icon (pencil) shown next to file name

### Test Case 4.10: Scroll Position Cached Per File
**Description:** Restore scroll when returning to file  
**Setup:** Scroll file list to position 200px, switch to different file, return  
**Expected Result:** File list scroll restored to 200px

---

## Category 5: Component - Comment Thread

### Test Case 5.1: Render Comment Thread
**Description:** Display parent comment + replies  
**Input:** Comment with 3 replies  
**Expected Output:** 4 comments rendered (1 parent + 3 replies), replies indented

### Test Case 5.2: Collapse Comment Thread
**Description:** Hide replies  
**Action:** Click collapse button  
**Expected Result:** Replies hidden, button text shows reply count

### Test Case 5.3: Expand Comment Thread
**Description:** Show replies  
**Setup:** Thread collapsed  
**Action:** Click expand button  
**Expected Result:** Replies visible

### Test Case 5.4: Render Outdated Comment (Grayed Out)
**Description:** Old comments visually distinct  
**Input:** Comment with outdated = true  
**Expected Output:** Comment has opacity 0.6, badge label "Outdated"

### Test Case 5.5: Hide Outdated Comments (Filter)
**Description:** Toggle outdated visibility  
**Action:** Check "Hide outdated comments"  
**Expected Result:** Outdated comments not rendered

### Test Case 5.6: Show Only My Comments (Filter)
**Description:** Filter by author  
**Setup:** 10 comments, 4 from current user (is_mine = true)  
**Action:** Check "Show only my comments"  
**Expected Result:** Only 4 comments visible

### Test Case 5.7: Render Pending Review Comment Badge
**Description:** Draft comments styled with badge  
**Input:** Comment with is_draft = true  
**Expected Output:** Badge label "Pending" with pinkish-red background (rgba(255, 157, 160, 0.18))

### Test Case 5.8: Click Edit on Comment
**Description:** Load comment into editor  
**Action:** Click edit icon on own comment  
**Expected Result:** Comment form opens with comment body pre-filled

### Test Case 5.9: Click Delete on Comment
**Description:** Confirm deletion  
**Action:** Click delete icon on own comment  
**Expected Result:** Confirmation dialog appears "Delete this comment?"

### Test Case 5.10: Reply to Comment
**Description:** Open reply composer  
**Action:** Click reply button  
**Expected Result:** Reply textarea appears below comment

### Test Case 5.11: Context Menu on Comment
**Description:** Right-click shows options  
**Action:** Right-click on own comment  
**Expected Output:** Context menu with "Edit" and "Delete" options

### Test Case 5.12: Context Menu - Reply Option
**Description:** Right-click on any comment shows Reply  
**Action:** Right-click on any non-draft comment  
**Expected Output:** Context menu includes "Reply" option

---

## Category 6: Component - PR List

### Test Case 6.1: Render PR List
**Description:** Display PRs from "PRs Under Review" list  
**Input:** 5 PRs with pending reviews  
**Expected Output:** 5 PR items rendered with titles

### Test Case 6.2: Highlight Selected PR
**Description:** Active PR visually distinct  
**Setup:** PR #123 selected  
**Expected Output:** PR has "selected" CSS class

### Test Case 6.3: Show PR Status Badge
**Description:** Open/closed indicators  
**Input:** PR with state = "open"  
**Expected Output:** Status indicator showing PR is open

### Test Case 6.4: Show PR Metadata (Author, Date)
**Description:** Display PR info  
**Input:** PR by "octocat" updated 2 days ago  
**Expected Output:** Author and date information displayed

### Test Case 6.5: Filter PRs by Search Text
**Description:** Search PR titles  
**Action:** Type "fix bug" in search input  
**Input:** PRs: ["Fix bug #1", "Add feature", "Fix bug #2"]  
**Expected Output:** Only "Fix bug #1" and "Fix bug #2" visible

### Test Case 6.6: Filter PRs by State (Open/Closed Menu)
**Description:** PR filter menu with state options  
**Action:** Open filter menu, select "Show closed PRs"  
**Expected Result:** Filter applied, closed PRs shown

### Test Case 6.7: Click PR Loads Details
**Description:** Navigate to PR  
**Action:** Click PR #123  
**Expected Result:** PR details loaded via TanStack Query, file list populated

### Test Case 6.8: MRU Repo Persisted
**Description:** Most recently used repos saved  
**Action:** Load repo "facebook/react"  
**Expected Result:** Repo added to MRU list in localStorage (repo-mru key)

### Test Case 6.9: MRU Repo List Displayed
**Description:** Quick access to recent repos  
**Setup:** MRU = ["facebook/react", "microsoft/vscode"]  
**Action:** Click repo dropdown  
**Expected Output:** Dropdown shows 2 recent repos

### Test Case 6.10: Query MRU Repos for Pending Reviews
**Description:** Automatically fetch pending reviews from recent repos  
**Setup:** MRU contains 3 repos  
**Expected Result:** TanStack Query fetches open PRs from all 3 MRU repos

---

## Category 7: Monaco Editor Integration

### Test Case 7.1: Initialize Monaco DiffEditor
**Description:** Editor loads with correct configuration  
**Input:** File with head and base content  
**Expected Result:** Monaco DiffEditor rendered showing diff

### Test Case 7.2: DiffEditor Shows Changes
**Description:** Side-by-side diff display  
**Input:** Base and head content different  
**Expected Result:** Added lines highlighted in green, removed lines in red

### Test Case 7.3: Monaco Read-Only Mode
**Description:** Editor cannot be edited  
**Expected Result:** Cannot type in editor, cursor shows but no modifications allowed

### Test Case 7.4: Monaco Line Number Click Adds Glyph
**Description:** Click line gutter to add comment  
**Action:** Click line 50 gutter  
**Expected Result:** Comment glyph appears in gutter, comment form opens with line = 50

### Test Case 7.5: Monaco Decorations - Comment Glyphs
**Description:** Show comment indicators in gutter  
**Setup:** 3 comments on lines 10, 20, 30  
**Expected Result:** 3 glyph decorations (+ icons) in editor gutter

### Test Case 7.6: Monaco Scroll Position Restoration
**Description:** Restore scroll when switching back to file  
**Setup:** Scroll editor to line 100, switch files, switch back  
**Expected Result:** Editor scroll restored to line 100 (cached in localStorage, 7 day TTL)

### Test Case 7.7: Monaco Settings - Minimap Disabled
**Description:** Minimap not shown  
**Expected Result:** Monaco editor renders without minimap (minimap.enabled = false)

### Test Case 7.8: Monaco Settings - Word Wrap Enabled
**Description:** Lines wrap at viewport edge  
**Expected Result:** Long lines wrap (wordWrap = "on")

### Test Case 7.9: Monaco Language Auto-Detection
**Description:** Set language based on file extension  
**Input:** File "app.tsx"  
**Expected Result:** Monaco language = "typescript"

### Test Case 7.10: Monaco Ctrl+F Find Widget
**Description:** Built-in find functionality  
**Action:** Press Ctrl+F in editor  
**Expected Result:** Monaco's native find widget appears

---

## Category 8: TanStack Query Integration

### Test Case 8.1: Query Auth Status
**Description:** Fetch authentication status on mount  
**Mock:** Tauri `cmd_get_auth_status` returns authenticated user  
**Expected Result:** `authQuery.data.authenticated = true`

### Test Case 8.2: Query PR List
**Description:** Fetch PRs with caching  
**Action:** Call `useQuery` for pull requests  
**Mock:** Tauri `cmd_list_pull_requests` returns array  
**Expected Result:** PRs cached, subsequent fetches use cache

### Test Case 8.3: Query PR Detail
**Description:** Fetch single PR with files and comments  
**Action:** Select PR #123  
**Mock:** Tauri `cmd_get_pull_request` returns PR detail  
**Expected Result:** PR detail cached with key `["pull-request", owner, repo, 123]`

### Test Case 8.4: Query Invalidation - After Comment Submission
**Description:** Refetch PR after posting comment  
**Action:** Submit comment via mutation  
**Expected Result:** PR query invalidated, refetched automatically, new comment appears

### Test Case 8.5: Mutation - Submit Comment
**Description:** Use mutation for comment submission  
**Action:** Call `postCommentMutation.mutate()`  
**Mock:** Tauri command succeeds  
**Expected Result:** Mutation triggers, onSuccess callback fires, queries invalidated

### Test Case 8.6: Mutation - Login
**Description:** OAuth login mutation  
**Action:** Call `loginMutation.mutate()`  
**Mock:** Tauri `cmd_start_github_oauth` returns auth status  
**Expected Result:** Auth query data updated, user logged in

### Test Case 8.7: Mutation - Logout
**Description:** Logout clears cached data  
**Action:** Call `logoutMutation.mutate()`  
**Expected Result:** Auth query cleared, all PR queries removed from cache

### Test Case 8.8: Query - PRs Under Review
**Description:** Fetch PRs with pending reviews from database  
**Mock:** Tauri `cmd_get_prs_under_review` returns array  
**Expected Result:** Cached list of PRs currently being reviewed

### Test Case 8.9: Parallel Queries - MRU Repos
**Description:** Fetch PRs from multiple repos simultaneously  
**Setup:** MRU contains 3 repos  
**Expected Result:** `useQueries` fetches from all 3 repos in parallel

### Test Case 8.10: Query Stale Time and Refetch
**Description:** Background refetch after staleTime  
**Setup:** PR cached, staleTime elapsed  
**Action:** Component re-renders  
**Expected Result:** Cached data shown, background refetch initiated

---

## Category 9: Local Directory Mode UI

### Test Case 9.1: Enter Local Folder Path
**Description:** User types local path  
**Action:** Enter "C:/Users/me/docs"  
**Mock:** Tauri `cmd_load_local_directory` returns markdown files  
**Expected Result:** Files listed, mode = local directory

### Test Case 9.2: Browse for Local Folder
**Description:** Click browse button  
**Action:** Click "Browse..."  
**Mock:** Tauri file picker dialog  
**Expected Result:** File picker opens, selected path loaded

### Test Case 9.3: Local Folder - MRU Persisted
**Description:** Recent local directories saved  
**Action:** Load directory "C:/docs"  
**Expected Result:** Path added to `local-dir-mru` in localStorage

### Test Case 9.4: Local Folder - Comments Saved to Database
**Description:** Comments stored locally, not posted to GitHub  
**Action:** Add comment in local folder mode  
**Mock:** Tauri `cmd_local_add_comment` stores to SQLite  
**Expected Result:** Comment saved locally, no GitHub API call

### Test Case 9.5: Local Folder - Review Submission
**Description:** Submit queued comments as local review  
**Action:** Click "Submit Review" in local mode  
**Mock:** Tauri `cmd_submit_local_review` generates log file  
**Expected Result:** Review log file created, comments exported

---

## Category 10: Review Management UI

### Test Case 10.1: Start New Review
**Description:** Create pending review  
**Action:** Click "Start Review" button  
**Mock:** Tauri `cmd_start_review` creates review in database  
**Expected Result:** Review mode enabled, comments queue to review

### Test Case 10.2: Add Comment to Review
**Description:** Queue comment in review  
**Action:** Add comment with "Add to review" mode  
**Mock:** Tauri `cmd_add_comment_to_review` saves to SQLite  
**Expected Result:** Comment saved locally, badge shows pending count

### Test Case 10.3: Review Summary - Fetch Pending Comments
**Description:** Load queued comments for current PR  
**Mock:** Tauri `cmd_get_pending_review_comments` returns array  
**Expected Result:** List of pending comments displayed with file/line info

### Test Case 10.4: Edit Review Comment Before Submission
**Description:** Modify queued comment  
**Action:** Click edit on pending comment  
**Expected Result:** Comment loaded in editor, can update body/line

### Test Case 10.5: Delete Review Comment Before Submission
**Description:** Remove queued comment  
**Action:** Click delete on pending comment  
**Mock:** Tauri `cmd_delete_comment_from_review` removes from database  
**Expected Result:** Comment removed from pending list

### Test Case 10.6: Submit Review - Batch Submission
**Description:** Post all queued comments at once  
**Action:** Click "Submit Review"  
**Mock:** Tauri `cmd_batch_submit_comments` posts to GitHub  
**Expected Result:** Progress indicator shows submission, all comments posted

### Test Case 10.7: Submit Review - Partial Failure Handling
**Description:** Some comments fail during batch  
**Mock:** Tauri returns partial success (e.g., 3 of 5 succeeded)  
**Expected Result:** Error message shows which comments failed, failed comments remain in queue

### Test Case 10.8: Delete Pending GitHub Review
**Description:** Delete review not yet submitted  
**Action:** Click "Delete Review"  
**Mock:** Tauri `cmd_delete_review` calls GitHub API  
**Expected Result:** Review deleted from GitHub, local comments cleared

### Test Case 10.9: Resume Review After App Restart
**Description:** Restore pending review from database  
**Setup:** Queued comments in SQLite  
**Action:** Close and reopen app, load same PR  
**Expected Result:** Pending review automatically loaded with all comments

---

## Category 11: Offline Mode Integration

### Test Case 11.1: App Starts Offline
**Description:** No network on launch  
**Setup:** Browser offline (`navigator.onLine = false`)  
**Expected Result:** Offline indicator shown, cached data loaded if available

### Test Case 11.2: Load Cached PR Offline
**Description:** View PR without network  
**Setup:** PR #123 cached in IndexedDB, offline  
**Action:** Select PR #123  
**Expected Result:** PR loads from cache, banner shows "Viewing cached data (offline)"

### Test Case 11.3: Cannot Submit Comment Offline
**Description:** Submit disabled when offline  
**Setup:** Offline mode detected  
**Expected Result:** Submit button disabled or shows error "You're offline"

### Test Case 11.4: Add Comment to Review Offline (Allowed)
**Description:** Can queue comments offline  
**Setup:** Offline mode  
**Action:** Add comment with "Add to review"  
**Expected Result:** Comment saved to SQLite, can submit when online

### Test Case 11.5: Go Online Mid-Session
**Description:** Network restored  
**Setup:** Start offline, cached PR loaded  
**Action:** Network comes back (`online` event)  
**Expected Result:** Offline indicator hides, PR refetched in background

### Test Case 11.6: Cache Miss Offline
**Description:** No cached data available  
**Setup:** Offline, PR #999 not in IndexedDB  
**Action:** Try to select PR #999  
**Expected Result:** Error message "Cannot load PR offline without cached data"

---

## Category 12: Integration Tests

### Test Case 12.1: Complete Comment Submission Flow
**Description:** End-to-end single comment  
**Steps:**
1. User selects file "src/app.ts"
2. Types comment "Looks good!"
3. Enters line number "42"
4. Clicks "Post comment"
5. Mock Tauri succeeds
6. Success message shown
7. Comment appears in thread
8. Draft deleted from localStorage

**Expected Result:** Comment posted successfully, UI updated

### Test Case 12.2: Complete Review Flow
**Description:** Add multiple comments to review  
**Steps:**
1. Click "Start Review"
2. Add 3 comments across different files
3. Verify all 3 saved to database
4. Click "Submit Review"
5. Mock batch submission succeeds
6. Progress shows 1/3 → 2/3 → 3/3
7. Success message displayed
8. All comments visible in UI

**Expected Result:** Batch review submitted successfully

### Test Case 12.3: Draft Persistence Across Sessions
**Description:** Drafts survive app restart  
**Steps:**
1. Type partial comment "This is a test..."
2. Navigate to different file
3. Close app
4. Reopen app, navigate to same PR + file
5. Verify draft restored "This is a test..."

**Expected Result:** Draft persisted in localStorage, restored on reload

---

## Category 13: Scroll Synchronization (`useScrollSync.ts`)

### Test Case 13.1: Scroll Source → Preview Syncs
**Description:** Monaco scroll updates preview  
**Action:** Scroll Monaco to line 100  
**Expected Result:** Preview pane scrolls to corresponding position

### Test Case 13.2: Scroll Preview → Source Syncs
**Description:** Preview scroll updates Monaco  
**Action:** Scroll preview to 50% down  
**Expected Result:** Monaco scrolls to corresponding line

### Test Case 13.3: Parse Anchors from Markdown
**Description:** Build anchor map from headings, HRs, code blocks  
**Input:** Markdown with `# H1`, `## H2`, `---`, ` ```code``` `  
**Expected Result:** Anchor positions calculated for sync

### Test Case 13.4: Sync with Hidden Lines (YAML Frontmatter)
**Description:** Adjust for hidden YAML front matter  
**Input:** Markdown with frontmatter (lines 1-5 hidden in preview)  
**Action:** Scroll to line 10 in Monaco  
**Expected Result:** Preview syncs to effective line 5 (adjusted)

### Test Case 13.5: Sync with Images - Height Compensation
**Description:** Account for stretched images  
**Input:** Markdown with large image  
**Action:** Scroll past image  
**Expected Result:** Sync compensates for actual rendered image height

### Test Case 13.6: Edge Snapping - Top
**Description:** Snap to top when near beginning  
**Action:** Scroll to line 2  
**Expected Result:** Preview snaps to 0px scroll

### Test Case 13.7: Edge Snapping - Bottom
**Description:** Snap to bottom when near end  
**Action:** Scroll to last line  
**Expected Result:** Preview snaps to maximum scroll

### Test Case 13.8: Prevent Feedback Loop
**Description:** Disable sync during programmatic scroll  
**Action:** Sync triggers preview scroll, which would trigger editor scroll  
**Expected Result:** Feedback flag prevents infinite loop

---

## Test Execution Notes

### Mocking Strategy

- **Tauri Commands:** Mock `window.__TAURI__.invoke()` in tests
- **IndexedDB:** Use `fake-indexeddb` for in-memory database
- **localStorage:** Jest automatic mocks
- **Network:** Mock `navigator.onLine` and window events

### Test Data Fixtures

Create `app/src/__tests__/fixtures/`:
- `samplePR.ts` - PR object with files, comments
- `sampleUser.ts` - GitHub user data
- `sampleComments.ts` - Various comment types

### Coverage Targets

- **offlineCache.ts**: 90%+
- **useNetworkStatus.ts**: 95%+
- **App.tsx**: 70%+ (due to size)
- **useScrollSync.ts**: 85%+

---

**Total Frontend Test Cases:** 95  
**Estimated Implementation Time:** 3 weeks  
**Coverage Target:** 75%+ line coverage

**Note:** Custom hook extraction (Categories 3-8 from original document) represents future refactoring work and is NOT included in current test cases. Monaco toggle features (minimap/word wrap), error boundaries, accessibility features, and responsive design are NOT currently implemented.
