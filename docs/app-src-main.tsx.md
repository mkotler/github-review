# app/src/main.tsx

**Path:** `app/src/main.tsx`

**Last Updated:** November 2025

**Lines of Code:** 16

## Capabilities Provided

This is the React application entry point that initializes the frontend within the Tauri WebView. It configures TanStack Query (React Query) for state management and data fetching, sets up React Strict Mode for development checks, and mounts the root App component to the DOM. The TanStack Query client provides automatic caching, background refetching, and request deduplication for all GitHub API calls made through Tauri commands. This architecture ensures efficient data synchronization between the Rust backend and React frontend without manual cache management.

## Setup and Initialization

### QueryClient Configuration

**Purpose:** Creates a TanStack Query client instance for managing server state throughout the application.

**Configuration:** Uses default settings which include:
- Automatic cache time: 5 minutes (staleTime default)
- Automatic garbage collection: After queries become inactive
- Retry logic: 3 retries with exponential backoff for failed queries
- Refetch on window focus: Enabled by default
- Refetch on reconnect: Enabled by default

**Usage:** All `useQuery` and `useMutation` hooks in the application share this client instance, providing consistent caching and data synchronization behavior.

---

### Root Rendering

**Purpose:** Mounts the React application to the DOM root element.

**Process:**
1. Locates the `#root` div element in `index.html`
2. Creates React 19 root using `createRoot` API (concurrent mode)
3. Wraps application in React.StrictMode for development warnings
4. Wraps application in QueryClientProvider for global state management
5. Renders the main `<App />` component

**React.StrictMode Effects:**
- Runs effects twice in development to detect missing cleanup
- Warns about deprecated APIs and unsafe lifecycle methods
- Warns about legacy string refs and findDOMNode usage
- No effect in production builds

---

## Components

### QueryClientProvider

**Purpose:** Makes the TanStack Query client available to all child components via React context.

**Props:**
- `client={queryClient}` - The global QueryClient instance

**Provider Scope:** All components in the application tree can access the query client via hooks like `useQuery`, `useMutation`, `useQueryClient`

**Usage in Application:**
- `useQuery(['auth-status'])` - Caches authentication state
- `useQuery(['pull-requests', owner, repo])` - Caches PR listings
- `useQuery(['pull-request-detail', owner, repo, number])` - Caches PR details
- `useMutation` - Handles comment submissions, review operations

---

### App Component

**Purpose:** Root application component containing all UI logic, routing, and state management.

**Import:** `import App from "./App"`

**Location:** `./App.tsx` (2636 lines of code)

**Responsibilities:**
- Authentication flow UI
- Repository and PR selection
- File viewer with Monaco Editor
- Markdown preview with scroll synchronization
- Comment management (local and GitHub)
- Review workflow (start, add comments, submit)

---

## Dependencies

### External Libraries

**React 19:**
- `React` - Core library with hooks and component API
- `ReactDOM.createRoot` - Concurrent mode rendering API

**TanStack Query v5:**
- `QueryClient` - Client for managing server state cache
- `QueryClientProvider` - Context provider for sharing client across component tree

### Internal Dependencies

**App Component:**
- `./App` - Main application component (default export)

**Global Styles:**
- `./App.css` - Application-wide CSS styles including Monaco Editor themes

---

## Architecture Notes

### State Management Strategy

**Server State (TanStack Query):**
- Authentication status
- Pull request listings
- Pull request details (files, comments, reviews)
- Pending review comments from SQLite
- All data fetched from Rust backend via Tauri commands

**Client State (React useState):**
- Selected repository (owner/repo)
- Selected PR number
- Selected file path
- Current editor content
- UI state (loading, errors, modal visibility)

**Benefits:**
- Automatic cache invalidation and refetching
- Request deduplication (multiple components can query same data)
- Background updates on window focus
- Optimistic updates for mutations
- Automatic loading and error states

---

### Tauri Bridge Integration

All data fetching goes through Tauri commands:
- `await invoke('cmd_check_auth_status')` - Returns cached auth status
- `await invoke('cmd_list_pull_requests', { owner, repo })` - Returns cached PR list
- `await invoke('cmd_get_pull_request', { owner, repo, number })` - Returns PR details

TanStack Query wraps these calls:
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['pull-requests', owner, repo],
  queryFn: () => invoke('cmd_list_pull_requests', { owner, repo }),
});
```

This provides automatic caching, so switching between PRs doesn't require re-fetching data unnecessarily.

---

### Development vs Production

**Development (npm run tauri dev):**
- React.StrictMode enabled - components render twice to catch side effects
- Hot module replacement (HMR) via Vite
- Development warnings in console
- Source maps enabled

**Production (npm run tauri build):**
- React.StrictMode has no effect (optimizations enabled)
- Minified and bundled JavaScript
- Tree-shaking removes unused code
- No source maps (unless configured)

---

## Entry Point Flow

1. **HTML:** `index.html` contains `<div id="root"></div>`
2. **main.tsx:** This file executes, finds `#root` element
3. **ReactDOM.createRoot:** Creates React 19 concurrent root
4. **React.StrictMode:** Wraps app for development checks
5. **QueryClientProvider:** Makes query client available globally
6. **App:** Main component renders, initializes state
7. **Tauri Commands:** App makes initial queries for auth status
8. **Event Loop:** React handles user interactions, TanStack Query manages data fetching

The application remains mounted until the Tauri window closes or the process terminates.

---

## Global CSS

**Import:** `./App.css`

**Contains:**
- Monaco Editor theme overrides
- Markdown preview styles (from react-markdown)
- Layout and spacing utilities
- Button and form styles
- Loading spinner animations
- Modal and dialog styles

CSS is injected into the document head by Vite during development and bundled in production builds.
