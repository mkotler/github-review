# App.tsx Refactoring Plan

## Executive Summary

The `App.tsx` file is currently **9,041 lines** - a monolithic component that handles authentication, PR browsing, file viewing, commenting, review management, scroll synchronization, offline caching, and UI rendering all in one file. This document outlines a systematic refactoring strategy with the test cases needed to ensure safe extraction.

## Current State Analysis

### Metrics
- **Total Lines**: 9,041
- **useState Hooks**: ~100+
- **useRef Hooks**: ~50+
- **useCallback Functions**: ~60+
- **useEffect Hooks**: ~50+
- **useMemo Hooks**: ~30+
- **TanStack Queries**: 8+ (authQuery, pullsQuery, pullDetailQuery, etc.)
- **TanStack Mutations**: 10+ (login, logout, submitComment, etc.)
- **Helper Components**: 3 (AsyncImage, MermaidCode, CommentThreadItem)

### Identified Feature Areas

1. **Authentication** (lines ~1600-1800)
   - authQuery, loginMutation, logoutMutation
   - OAuth flow, token storage, offline auth caching

2. **Repository Selection** (lines ~4100-4300)
   - repoInput, repoRef state
   - MRU dropdown, repo form submission
   - Local directory mode

3. **PR List Management** (lines ~1700-1900, ~4200-4800)
   - pullsQuery, prsUnderReviewQuery, MRU queries
   - PR filtering, search, state (open/closed/merged)
   - "PRs Under Review" tracking

4. **PR Detail & Files** (lines ~2100-2800)
   - pullDetailQuery, file contents queries
   - TOC parsing, file sorting
   - File filtering (markdown/yaml, viewed/unviewed)

5. **Code Viewing** (lines ~8000-8700)
   - Monaco Editor integration (editor, diff)
   - Glyph margin click handling
   - Zoom controls

6. **Markdown Preview** (lines ~8700-9000)
   - ReactMarkdown rendering
   - Image handling (AsyncImage)
   - Link navigation within PR
   - Mermaid diagram rendering

7. **Scroll Synchronization** (lines ~3400-3800)
   - Source-to-preview sync
   - Preview-to-source sync
   - Scroll position caching/restoration

8. **Comment System** (lines ~2000-2100, ~5000-7000)
   - Comment panel UI
   - Comment threads (parent + replies)
   - File-level vs line-level comments
   - Comment CRUD operations
   - Draft management

9. **Review Workflow** (lines ~4800-5300)
   - Start/show/submit/delete review
   - Local review storage
   - Pending review handling
   - Batch submission

10. **Offline Support** (integrated throughout)
    - Network status detection
    - IndexedDB caching
    - Offline mode UI indicators

11. **UI Layout & Resizing** (lines ~3900-4100, ~8000+)
    - Sidebar collapse/expand
    - Pane resizing
    - Panel accordion behavior

## Refactoring Strategy

### Phase 1: Extract Types and Constants (Low Risk)

**Goal**: Move all type definitions and constants to separate files.

**Files to Create**:
- `src/types/index.ts` - All type definitions
- `src/constants/index.ts` - RETRY_CONFIG, zoom settings, scroll cache settings

**Test Cases Required**: None (pure refactoring, no behavior change)

### Phase 2: Extract Custom Hooks (Medium Risk)

**Goal**: Extract stateful logic into custom hooks.

#### 2.1: useAuth Hook
**Extract**: authQuery, loginMutation, logoutMutation, auth-related effects
**File**: `src/hooks/useAuth.ts`
**Test Cases**:
- [ ] Returns loading state during initial auth check
- [ ] Returns authenticated state with user data when logged in
- [ ] Returns unauthenticated state when not logged in
- [ ] loginMutation triggers OAuth flow
- [ ] logoutMutation clears credentials and redirects
- [ ] Handles offline auth caching correctly
- [ ] Re-validates token on reconnection

#### 2.2: useRepository Hook
**Extract**: repoRef, repoInput, repoMRU, repo form logic
**File**: `src/hooks/useRepository.ts`
**Test Cases**:
- [ ] Parses owner/repo from input correctly
- [ ] Validates format (rejects invalid formats)
- [ ] Updates MRU list on successful load
- [ ] Persists MRU to localStorage
- [ ] Loads MRU from localStorage on mount
- [ ] Handles local directory mode separately

#### 2.3: usePullRequests Hook
**Extract**: pullsQuery, prsUnderReviewQuery, MRU queries, PR filtering
**File**: `src/hooks/usePullRequests.ts`
**Test Cases**:
- [ ] Fetches open PRs for selected repo
- [ ] Fetches closed PRs when showClosedPRs is true
- [ ] Filters PRs by search term (number, title, author)
- [ ] Tracks PRs under review across repos
- [ ] Handles pagination correctly
- [ ] Refetches on manual refresh

#### 2.4: usePullDetail Hook
**Extract**: pullDetailQuery, file contents, comments, reviews
**File**: `src/hooks/usePullDetail.ts`
**Test Cases**:
- [ ] Fetches PR detail when selectedPr changes
- [ ] Returns files with correct status (added, modified, deleted, renamed)
- [ ] Returns comments grouped by file
- [ ] Returns reviews with pending review detection
- [ ] Handles renamed files correctly
- [ ] Caches results for instant re-access

#### 2.5: useFileContents Hook
**Extract**: fileContentsQuery, file preloading logic
**File**: `src/hooks/useFileContents.ts`
**Test Cases**:
- [ ] Fetches content on file selection
- [ ] Returns both head and base content for diff
- [ ] Handles missing content gracefully
- [ ] Uses cache for previously loaded files
- [ ] Falls back to offline cache when offline

#### 2.6: useTocOrdering Hook
**Extract**: tocFilesMetadata, tocContentsQuery, tocFileNameMap, sortedFiles
**File**: `src/hooks/useTocOrdering.ts`
**Test Cases**:
- [ ] Parses toc.yml files correctly
- [ ] Extracts display names from toc entries
- [ ] Orders files according to toc hierarchy
- [ ] Handles nested toc directories
- [ ] Falls back to alphabetical for files not in toc

#### 2.7: useComments Hook
**Extract**: Comment CRUD mutations, local comments, reviewAwareComments
**File**: `src/hooks/useComments.ts`
**Test Cases**:
- [ ] Creates single comment (POST immediately)
- [ ] Creates review comment (stores locally)
- [ ] Updates existing comment
- [ ] Deletes comment (local and GitHub)
- [ ] Merges local and GitHub comments correctly
- [ ] Filters by file path
- [ ] Groups into threads (parent + replies)

#### 2.8: useReview Hook
**Extract**: Review mutations (start, submit, delete), pendingReview state
**File**: `src/hooks/useReview.ts`
**Test Cases**:
- [ ] Starts new local review
- [ ] Resumes existing local review
- [ ] Submits local review to GitHub (batch)
- [ ] Deletes local review
- [ ] Deletes GitHub pending review
- [ ] Handles submission errors gracefully
- [ ] Creates log file on abandon

#### 2.9: useViewedFiles Hook
**Extract**: viewedFiles state, toggle/markAll functions
**File**: `src/hooks/useViewedFiles.ts`
**Test Cases**:
- [ ] Tracks viewed files per PR
- [ ] Persists to localStorage
- [ ] Loads from localStorage on mount
- [ ] toggleFileViewed toggles state correctly
- [ ] markAllFilesAsViewed marks all files

#### 2.10: useDrafts Hook
**Extract**: draftsByFile state, draft persistence logic
**File**: `src/hooks/useDrafts.ts`
**Test Cases**:
- [ ] Stores inline comment drafts per file
- [ ] Stores reply drafts per comment
- [ ] Debounces localStorage writes
- [ ] Loads drafts on mount
- [ ] Clears drafts on successful submit

#### 2.11: useScrollCache Hook
**Extract**: Scroll position caching for file list, source pane, comment panel
**File**: `src/hooks/useScrollCache.ts`
**Test Cases**:
- [ ] Saves scroll position on scroll events
- [ ] Restores scroll position on file change
- [ ] Handles TTL expiration
- [ ] Prunes old entries
- [ ] Works independently per cache type

#### 2.12: usePaneZoom Hook
**Extract**: paneZoomLevel state, zoom functions
**File**: `src/hooks/usePaneZoom.ts`
**Test Cases**:
- [ ] Adjusts zoom level within bounds
- [ ] Resets zoom to default
- [ ] Persists zoom level
- [ ] Applies zoom to Monaco editor

### Phase 3: Extract UI Components (Medium Risk)

**Goal**: Extract large UI sections into separate components.

#### 3.1: Sidebar Component
**Extract**: Entire sidebar including user menu, repo panel, PR panel, file list
**File**: `src/components/Sidebar/index.tsx`
**Sub-components**:
- `UserMenu.tsx`
- `RepoPanel.tsx`
- `PrPanel.tsx`
- `FileList.tsx`
- `CommentPanel.tsx`

**Test Cases**:
- [ ] Renders user menu with avatar and login
- [ ] Opens/closes user menu dropdown
- [ ] Collapses/expands sidebar
- [ ] Shows repo input form
- [ ] Shows PR list with correct badges
- [ ] Shows file list with viewed checkboxes
- [ ] Shows comment count badges on files
- [ ] Handles file selection

#### 3.2: CommentPanel Component
**Extract**: Comment panel with threads, composer, actions
**File**: `src/components/CommentPanel/index.tsx`
**Sub-components**:
- `CommentThread.tsx`
- `CommentComposer.tsx`
- `ReplyComposer.tsx`
- `ReviewActions.tsx`

**Test Cases**:
- [ ] Renders comment threads correctly
- [ ] Shows reply composer on reply click
- [ ] Shows edit form on edit click
- [ ] Handles comment submission
- [ ] Shows pending review indicator
- [ ] Shows "Submit review" / "Delete review" buttons

#### 3.3: SourcePane Component
**Extract**: Monaco editor pane with toolbar
**File**: `src/components/SourcePane/index.tsx`

**Test Cases**:
- [ ] Renders Monaco editor with correct content
- [ ] Switches between diff and single view
- [ ] Handles glyph margin clicks
- [ ] Applies zoom level
- [ ] Shows correct file path in header

#### 3.4: PreviewPane Component
**Extract**: Markdown preview pane
**File**: `src/components/PreviewPane/index.tsx`

**Test Cases**:
- [ ] Renders markdown content correctly
- [ ] Renders Mermaid diagrams
- [ ] Handles link clicks (internal navigation)
- [ ] Handles image loading (AsyncImage)
- [ ] Shows non-markdown as preformatted text

#### 3.5: MediaViewer Component
**Extract**: Full-screen media viewer modal
**File**: `src/components/MediaViewer/index.tsx`

**Test Cases**:
- [ ] Opens on image click
- [ ] Shows image at full size
- [ ] Closes on ESC key
- [ ] Closes on backdrop click

#### 3.6: Modal Components
**Extract**: Confirmation dialogs
**File**: `src/components/Modal/index.tsx`

**Test Cases**:
- [ ] DeleteCommentModal shows on delete click
- [ ] DeleteReviewModal shows on delete review click
- [ ] SubmitErrorModal shows on submission error

### Phase 4: Extract Services/Utilities (Low Risk)

**Goal**: Extract API calls and utility functions.

#### 4.1: GitHub API Service
**File**: `src/services/github.ts`
**Functions**:
- `fetchPullRequests`
- `fetchPullDetail`
- `fetchFileContents`
- `submitComment`
- `submitReview`
- `updateComment`
- `deleteComment`

**Test Cases**: Already covered by backend tests

#### 4.2: Local Review Service
**File**: `src/services/localReview.ts`
**Functions**:
- `startLocalReview`
- `addLocalComment`
- `updateLocalComment`
- `deleteLocalComment`
- `submitLocalReview`
- `getLocalReviewMetadata`

**Test Cases**: Already covered by backend tests (review_storage.rs)

#### 4.3: Markdown Utilities
**File**: `src/utils/markdown.ts`
**Functions**:
- `parseLinePrefix`
- `formatFileLabel`
- `isMarkdownFile`
- `isImageFile`

**Test Cases**:
- [ ] parseLinePrefix extracts line number from "[Line 42] comment"
- [ ] parseLinePrefix returns original body when no prefix
- [ ] formatFileLabel extracts folder/file from path
- [ ] isMarkdownFile detects .md, .markdown, .mdx
- [ ] isImageFile detects .png, .jpg, .gif, .svg, .webp

#### 4.4: File Navigation Utilities
**File**: `src/utils/navigation.ts`
**Functions**:
- `resolveRelativePath`
- `formatFilePathWithEllipsis`

**Test Cases**:
- [ ] resolveRelativePath handles ../
- [ ] resolveRelativePath handles ./
- [ ] resolveRelativePath handles absolute paths
- [ ] formatFilePathWithEllipsis truncates long paths

### Phase 5: Integration Testing (High Priority)

**Goal**: Create integration tests that verify the complete user flows work correctly.

#### 5.1: Authentication Flow
**Test Cases**:
- [ ] User can log in via OAuth
- [ ] User session persists across page reload
- [ ] User can log out
- [ ] Offline user can view cached PRs

#### 5.2: PR Browsing Flow
**Test Cases**:
- [ ] User can enter repo and load PRs
- [ ] User can filter PRs by search
- [ ] User can select a PR and see files
- [ ] User can switch between open/closed PRs

#### 5.3: File Viewing Flow
**Test Cases**:
- [ ] User can select a file and see content
- [ ] User can toggle diff view
- [ ] User can mark file as viewed
- [ ] User can navigate via file links

#### 5.4: Comment Flow
**Test Cases**:
- [ ] User can add a single comment
- [ ] User can start a review and add comments
- [ ] User can edit own comment
- [ ] User can delete own comment
- [ ] User can reply to a comment
- [ ] User can submit review

#### 5.5: Offline Flow
**Test Cases**:
- [ ] User can view cached PR when offline
- [ ] User can add comments to local review when offline
- [ ] App shows offline indicator correctly
- [ ] App recovers when connection returns

## Recommended Extraction Order

### Week 1: Foundation
1. Extract types (`src/types/index.ts`)
2. Extract constants (`src/constants/index.ts`)
3. Extract `useAuth` hook
4. Extract `useRepository` hook

### Week 2: Data Layer
5. Extract `usePullRequests` hook
6. Extract `usePullDetail` hook
7. Extract `useFileContents` hook
8. Extract `useTocOrdering` hook

### Week 3: Comment System
9. Extract `useComments` hook
10. Extract `useReview` hook
11. Extract `useDrafts` hook

### Week 4: UI Components - Sidebar
12. Extract `Sidebar` component
13. Extract `UserMenu`, `RepoPanel`, `PrPanel`
14. Extract `FileList` component

### Week 5: UI Components - Main
15. Extract `CommentPanel` and sub-components
16. Extract `SourcePane` component
17. Extract `PreviewPane` component

### Week 6: Polish
18. Extract remaining utilities
19. Extract `Modal` components
20. Add integration tests

## Risk Mitigation

### Before Each Extraction:
1. Ensure all related tests pass
2. Document the current behavior
3. Create a feature branch

### During Extraction:
1. Extract one piece at a time
2. Run tests after each change
3. Verify UI manually

### After Extraction:
1. Run full test suite
2. Manual QA of affected features
3. Review for regressions

## Test Coverage Goals

| Area | Current Tests | Target Tests |
|------|--------------|--------------|
| Types/Constants | 0 | 0 (type-only) |
| useAuth | 0 | 10 |
| useRepository | 0 | 8 |
| usePullRequests | 0 | 8 |
| usePullDetail | 0 | 8 |
| useFileContents | 0 | 6 |
| useTocOrdering | 0 | 6 |
| useComments | 0 | 10 |
| useReview | 0 | 10 |
| useViewedFiles | 0 | 6 |
| useDrafts | 0 | 8 |
| useScrollCache | 0 | 6 |
| UI Components | 0 | 20 |
| Integration | 0 | 15 |
| **Total New** | **0** | **~121** |

## Summary

This refactoring plan breaks down the monolithic App.tsx into:
- **12+ custom hooks** for stateful logic
- **10+ UI components** for rendering
- **4+ utility modules** for shared functions
- **~121 new test cases** for confidence

The phased approach ensures that:
1. Each extraction is small and testable
2. Existing functionality is preserved
3. Progress is incremental and reversible
4. The final architecture is maintainable and scalable

## Next Steps

1. Review and approve this plan
2. Prioritize which hooks/components to extract first based on immediate needs
3. Create test stubs for the first extraction target
4. Begin Phase 1 (types and constants)
