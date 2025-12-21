# App.tsx Refactoring Plan

## Executive Summary

The `App.tsx` file has been reduced from **9,041 lines** to **7,179 lines** (~20% reduction) through systematic extraction of hooks, components, utilities, and types. This document tracks progress and outlines the next phases of refactoring.

## Current State Analysis (Updated December 2024)

### Metrics
- **Total Lines**: 7,179 (down from 9,041)
- **useState Hooks**: ~65 (reduced from ~100)
- **useRef Hooks**: ~45
- **useCallback Functions**: ~40 (reduced from ~60)
- **useEffect Hooks**: ~45
- **useMemo Hooks**: ~25
- **TanStack Queries**: 5 (prsUnderReviewQuery, pullsQuery, pullDetailQuery, mruOpenPrsQueries, mruClosedPrsQueries)
- **TanStack Mutations**: 0 in App.tsx (all moved to hooks)

### Extracted Modules

#### Types (`src/types/index.ts`) ✅
- RepoRef, PullRequestSummary, PullRequestMetadata
- PullRequestDetail, PullRequestFile, PullRequestComment
- PullRequestReview, PrUnderReview, LocalComment
- ScrollCacheEntry, ScrollCacheState, SourceRestoreState
- ReviewMetadata

#### Constants (`src/constants/index.ts`) ✅
- RETRY_CONFIG, PANE_ZOOM_STEP
- SCROLL_CACHE_KEY, SCROLL_CACHE_TTL_MS, LEGACY_SCROLL_KEY
- SOURCE_RESTORE_TIMEOUT_MS, SOURCE_RESTORE_MAX_ATTEMPTS
- SOURCE_RESTORE_EPSILON, SOURCE_RESTORE_GRACE_MS
- SOURCE_RESTORE_ACTIVATION_GRACE_MS
- MIN_SIDEBAR_WIDTH, MIN_CONTENT_WIDTH

#### Hooks (`src/hooks/`) ✅

| Hook | Lines | Tests | Description |
|------|-------|-------|-------------|
| `useAuth` | 140 | 10 | Authentication state, login/logout mutations |
| `useCommentMutations` | 600 | 45 | All comment/review CRUD operations |
| `useCommentFiltering` | 138 | 30 | Filter comments by file, outdated, author |
| `useFileContents` | 188 | 12 | File content loading with offline cache |
| `useFileNavigation` | 105 | 13 | Browser-like back/forward navigation |
| `useLocalStorage` | 92 | 19 | Generic localStorage persistence |
| `useMarkdownComponents` | 92 | - | ReactMarkdown component overrides |
| `usePaneZoom` | 127 | 16 | Editor zoom controls |
| `useTocSortedFiles` | 373 | 31 | TOC-based file ordering |
| `useViewedFiles` | 110 | 20 | Track viewed files per PR |
| `useMRUList` | (in hooks/index.ts) | - | Most Recently Used list management |

**Total Hook Tests**: 196

#### Utilities (`src/utils/`) ✅

| Utility | Description |
|---------|-------------|
| `helpers.ts` | parseLinePrefix, getImageMimeType, formatFileLabel, formatFileTooltip, formatFilePathWithLeadingEllipsis, isImageFile, isMarkdownFile |
| `scrollCache.ts` | loadScrollCache, pruneScrollCache |

#### Components (`src/components/`) ✅

| Component | Description |
|-----------|-------------|
| `AsyncImage.tsx` | Image loading with base64 fallback |
| `CommentComposer.tsx` | Comment input form |
| `CommentDisplay.tsx` | Single comment rendering |
| `CommentStatus.tsx` | Error/success message display |
| `CommentThreadItem.tsx` | Thread with parent + replies |
| `ConfirmDialog.tsx` | Reusable confirmation modal |
| `MediaViewer.tsx` | Full-screen image viewer |
| `MermaidCode.tsx` | Mermaid diagram rendering |

### What Remains in App.tsx

1. **UI State Management** (~65 useState hooks)
   - Panel collapse states (sidebar, repo, PR, comments)
   - Modal/menu visibility states
   - Form input states (drafts, errors, success flags)
   - Resizing states

2. **Complex Effects** (~45 useEffect hooks)
   - Scroll position restoration logic
   - Menu click-outside handlers
   - Draft auto-save with debouncing
   - PR mode auto-switching

3. **TanStack Queries** (5 queries)
   - `prsUnderReviewQuery` - Local reviews list
   - `pullsQuery` - PR list for repo
   - `pullDetailQuery` - Single PR detail
   - `mruOpenPrsQueries` - MRU repos open PRs
   - `mruClosedPrsQueries` - MRU repos closed PRs

4. **UI Rendering** (~3000 lines of JSX)
   - Login screen
   - Sidebar (user menu, repo panel, PR panel, file list, comment panel)
   - Main workspace (source pane, preview pane)
   - Modals and menus

5. **Monaco Editor Integration** (~400 lines)
   - Editor mount handlers
   - Glyph margin click handlers
   - Scroll synchronization
   - Wheel event handlers for zoom

---

## Next Refactoring Phase: Recommended Changes

### Priority 1: Extract UI State Management

#### 1.1: `useDrafts` Hook (HIGH VALUE)
**Lines to extract**: ~150 lines
**Location**: Lines 2165-2320 in App.tsx

**Extract**:
- `draftsByFile` state
- Draft loading from localStorage
- Draft auto-save effects with debouncing
- Draft restoration effects
- Draft clearing on submit

**Benefits**:
- Removes 6 useEffect hooks from App.tsx
- Consolidates all draft logic
- Makes draft persistence testable

**Test Cases**:
- [ ] Loads drafts from localStorage on mount
- [ ] Saves drafts with 300ms debounce
- [ ] Restores inline draft when file selected
- [ ] Restores file-level draft when composer opens
- [ ] Clears draft after successful submit
- [ ] Handles multiple files' drafts independently

#### 1.2: `useScrollPositions` Hook (HIGH VALUE)
**Lines to extract**: ~200 lines
**Location**: Lines 344-520, 1440-1700

**Extract**:
- `scrollCacheRef` and related refs
- `saveScrollPosition`, `getScrollPosition`, `persistScrollCache`
- `persistSourceScrollPosition`, `shouldSkipSourceScrollSnapshot`
- Source pane scroll restoration logic
- File list scroll restoration logic
- Comment panel scroll restoration logic

**Benefits**:
- Removes complex scroll restoration logic from App.tsx
- Makes scroll behavior testable
- Reduces ref count significantly

**Test Cases**:
- [ ] Saves scroll position on scroll event
- [ ] Restores scroll position on file change
- [ ] Handles TTL expiration
- [ ] Prunes old entries
- [ ] Protects during restore grace period

#### 1.3: `useMenuStates` Hook (MEDIUM VALUE)
**Lines to extract**: ~100 lines
**Location**: Various menu state hooks

**Extract**:
- `isUserMenuOpen`, `toggleUserMenu`, `closeUserMenu`
- `isPrFilterMenuOpen`, `togglePrFilterMenu`, `closePrFilterMenu`
- `showSourceMenu`, `showFilesMenu`, `showCommentPanelMenu`
- Click-outside handlers for all menus

**Benefits**:
- Consolidates 5 similar patterns
- Removes 5 useEffect hooks
- Simpler mental model

### Priority 2: Extract Query Logic

#### 2.1: `usePullRequests` Hook (HIGH VALUE)
**Lines to extract**: ~300 lines
**Location**: Lines 760-950, 2760-3100

**Extract**:
- `prsUnderReviewQuery`
- `mruOpenPrsQueries`, `mruClosedPrsQueries`
- `pullsQuery`
- `enhancedPrsUnderReview` memo
- PR state/metadata caching logic
- PR prefetching logic

**Benefits**:
- Removes 3 queries from App.tsx
- Consolidates all PR list logic
- Makes PR filtering/enhancement testable

**Test Cases**:
- [ ] Fetches PRs under review from backend
- [ ] Fetches PRs from MRU repos
- [ ] Enhances PRs with viewed counts
- [ ] Caches PR metadata
- [ ] Prefetches PR details

#### 2.2: `usePullDetail` Hook (MEDIUM VALUE)
**Lines to extract**: ~150 lines
**Location**: Lines 986-1100

**Extract**:
- `pullDetailQuery`
- Offline caching on fetch
- Auto-cache all files effect
- Force fresh data effect

**Benefits**:
- Separates PR detail fetching
- Makes offline caching testable

### Priority 3: Extract UI Components

#### 3.1: `Sidebar` Component (HIGH VALUE)
**Lines to extract**: ~1200 lines
**Location**: Lines 4050-5800

**Extract**:
- Entire `<aside className="sidebar">` block
- User menu, repo panel, PR panel sections
- File list with all filtering/badges
- Comment panel when inline comments open

**Sub-components to create**:
- `UserMenu.tsx` - Avatar, dropdown, logout button
- `RepoPanel.tsx` - Repo input, MRU dropdown
- `PrPanel.tsx` - PR list, filtering, badges
- `FileList.tsx` - File tree with comment badges

**Benefits**:
- Single largest extraction possible
- Creates reusable sidebar structure
- Enables parallel development

#### 3.2: `SourcePane` Component (MEDIUM VALUE)
**Lines to extract**: ~500 lines
**Location**: Lines 6100-6600

**Extract**:
- Source pane header with toolbar
- Monaco Editor wrapper
- DiffEditor wrapper
- Glyph margin handlers
- Scroll sync handlers

**Benefits**:
- Isolates Monaco complexity
- Makes editor behavior testable

#### 3.3: `PreviewPane` Component (MEDIUM VALUE)
**Lines to extract**: ~300 lines
**Location**: Lines 6700-7000

**Extract**:
- Preview pane header
- ReactMarkdown wrapper
- Non-markdown pre display
- Image handling

**Benefits**:
- Separates preview rendering
- Simplifies markdown customization

### Priority 4: Simplify Remaining Logic

#### 4.1: Flatten Review State Management
**Current complexity**: pendingReview, pendingReviewOverride, pendingReviewFromServer, hasLocalPendingReview
**Opportunity**: Consolidate into single review state object

#### 4.2: Reduce Panel State Variables
**Current**: 8 separate boolean states for panel visibility
**Opportunity**: Single `panelState` object or reducer

#### 4.3: Extract Form Handlers
**Current**: Multiple inline form handlers with similar patterns
**Opportunity**: Create reusable form handling utilities

---

## Updated Test Coverage

| Area | Current Tests | Target Tests | Status |
|------|--------------|--------------|--------|
| Types/Constants | 0 | 0 | ✅ N/A |
| useAuth | 10 | 10 | ✅ Complete |
| useCommentMutations | 45 | 45 | ✅ Complete |
| useCommentFiltering | 30 | 30 | ✅ Complete |
| useFileContents | 12 | 12 | ✅ Complete |
| useFileNavigation | 13 | 13 | ✅ Complete |
| useLocalStorage | 19 | 19 | ✅ Complete |
| usePaneZoom | 16 | 16 | ✅ Complete |
| useTocSortedFiles | 31 | 31 | ✅ Complete |
| useViewedFiles | 20 | 20 | ✅ Complete |
| useNetworkStatus | 11 | 11 | ✅ Complete |
| **Hooks Subtotal** | **226** | **226** | ✅ |
| useDrafts | 0 | 8 | ⏳ Planned |
| useScrollPositions | 0 | 10 | ⏳ Planned |
| useMenuStates | 0 | 6 | ⏳ Planned |
| usePullRequests | 0 | 10 | ⏳ Planned |
| usePullDetail | 0 | 6 | ⏳ Planned |
| Sidebar Component | 0 | 15 | ⏳ Planned |
| SourcePane Component | 0 | 10 | ⏳ Planned |
| PreviewPane Component | 0 | 8 | ⏳ Planned |
| **Total** | **226** | **299** |

---

## Recommended Next Session Tasks

### Option A: Focus on State Extraction (Reduces complexity)
1. Extract `useDrafts` hook (~2 hours)
2. Extract `useScrollPositions` hook (~3 hours)
3. Extract `useMenuStates` hook (~1 hour)

**Expected result**: -450 lines, -15 effects, more testable

### Option B: Focus on Query Extraction (Reduces coupling)
1. Extract `usePullRequests` hook (~3 hours)
2. Extract `usePullDetail` hook (~2 hours)

**Expected result**: -450 lines, cleaner data flow

### Option C: Focus on UI Extraction (Biggest visual impact)
1. Extract `Sidebar` component with sub-components (~4 hours)

**Expected result**: -1200 lines, reusable components

---

## Summary

### Progress Made
- **Lines reduced**: 9,041 → 7,179 (20% reduction)
- **Hooks extracted**: 11 custom hooks
- **Components extracted**: 8 reusable components
- **Tests added**: 226 new tests (all passing)
- **Mutations moved**: All 6 comment/review mutations now in hooks

### Remaining Work
- **Lines remaining**: 7,179
- **Target**: ~3,000 lines (core App orchestration only)
- **Estimated additional extractions**: 4-6 more hooks, 3-4 more components
- **Estimated tests to add**: ~73 more tests

### Architecture Vision
```
App.tsx (~3000 lines)
├── Orchestrates state between extracted modules
├── Handles top-level routing/layout
└── Minimal direct DOM rendering

hooks/ (~2000 lines)
├── useAuth, useCommentMutations, useCommentFiltering
├── useFileContents, useFileNavigation, useLocalStorage
├── usePaneZoom, useTocSortedFiles, useViewedFiles
├── useDrafts, useScrollPositions, useMenuStates (new)
└── usePullRequests, usePullDetail (new)

components/ (~2000 lines)
├── Sidebar/ (UserMenu, RepoPanel, PrPanel, FileList)
├── SourcePane/, PreviewPane/
├── AsyncImage, CommentThreadItem, ConfirmDialog
└── MediaViewer, MermaidCode
```
