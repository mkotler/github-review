# app/src/offlineCache.ts

**Path:** `app/src/offlineCache.ts`  
**Last Updated:** November 2025  
**Lines of Code:** ~200

## Capabilities Provided

This module provides an IndexedDB-based persistent cache for offline support in the GitHub Review Tool. It enables users to access previously viewed pull requests and files even without an active internet connection, making the application usable in environments with intermittent connectivity (e.g., airplanes, remote locations).

Key capabilities:

- **File Content Caching** - Stores both head and base versions of file contents indexed by repository, PR number, and commit SHAs
- **PR Detail Caching** - Stores complete pull request metadata including comments and reviews
- **Automatic Expiration** - 7-day cache lifetime with automatic cleanup on application startup
- **SHA-based Validation** - Ensures cached file contents match expected commit SHAs
- **Per-PR Cache Management** - Ability to clear all cached data for specific pull requests

## Database Schema

### Database Configuration
- **Name:** `github-review-cache`
- **Version:** 1
- **Expiration Policy:** 7 days from cache timestamp

### Object Stores

#### `fileContents`
**Key Path:** Compound key `[owner, repo, prNumber, filePath]`  
**Indexes:**
- `cachedAt` - Timestamp index for expiration cleanup
- `pr` - Compound index `[owner, repo, prNumber]` for PR-level queries

**Stored Data:**
```typescript
{
  owner: string,
  repo: string,
  prNumber: number,
  filePath: string,
  headSha: string,
  baseSha: string,
  headContent: string | null,
  baseContent: string | null,
  cachedAt: number  // Unix timestamp
}
```

#### `prDetails`
**Key Path:** Compound key `[owner, repo, prNumber]`  
**Indexes:**
- `cachedAt` - Timestamp index for expiration cleanup

**Stored Data:**
```typescript
{
  owner: string,
  repo: string,
  prNumber: number,
  data: string,  // JSON-stringified PullRequestDetail
  cachedAt: number  // Unix timestamp
}
```

## Functions

### `openDB() -> Promise<IDBDatabase>`

**Purpose:** Opens or creates the IndexedDB database with schema initialization  
**Parameters:** None  
**Returns:** Promise resolving to IDBDatabase instance  
**Side Effects:**  
- Creates object stores if database doesn't exist
- Logs database opening at console level
- Registers upgrade handler for schema changes

**Implementation Notes:**  
- Uses `onupgradeneeded` callback to create object stores on first run
- Sets up compound key paths for efficient querying
- Creates indexes for expiration cleanup and PR-level operations

---

### `cacheFileContent(...) -> Promise<void>`

**Purpose:** Stores file contents in IndexedDB for offline access  
**Parameters:**
- `owner: string` - Repository owner
- `repo: string` - Repository name
- `prNumber: number` - Pull request number
- `filePath: string` - File path within repository
- `headSha: string` - Commit SHA for head version
- `baseSha: string` - Commit SHA for base version
- `headContent: string | null` - File content at head SHA (null for deleted files)
- `baseContent: string | null` - File content at base SHA (null for added files)

**Returns:** Promise resolving when cache operation completes  
**Side Effects:**
- Opens IndexedDB connection
- Stores file content with current timestamp
- Logs caching operation at console level

**Exceptions:**
- Rejects promise if database operation fails
- Logs errors to console

**Usage Example:**
```typescript
await offlineCache.cacheFileContent(
  'microsoft', 'vscode', 12345,
  'src/main.ts',
  'abc123', 'def456',
  headFileContent, baseFileContent
);
```

---

### `getCachedFileContent(...) -> Promise<{ headContent: string | null; baseContent: string | null } | null>`

**Purpose:** Retrieves cached file contents with SHA validation and expiration check  
**Parameters:**
- `owner: string` - Repository owner
- `repo: string` - Repository name
- `prNumber: number` - Pull request number
- `filePath: string` - File path within repository
- `headSha: string` - Expected commit SHA for head version
- `baseSha: string` - Expected commit SHA for base version

**Returns:** 
- Object with `{ headContent, baseContent }` if cache hit and valid
- `null` if cache miss, expired, or SHA mismatch

**Side Effects:**
- Opens IndexedDB connection
- Logs cache hit/miss at console level

**Validation Logic:**
1. Checks if cached entry exists
2. Verifies cached timestamp is within 7-day window
3. Validates headSha and baseSha match expected values
4. Returns null if any validation fails

**Usage Example:**
```typescript
const cached = await offlineCache.getCachedFileContent(
  'microsoft', 'vscode', 12345,
  'src/main.ts', 'abc123', 'def456'
);
if (cached) {
  console.log('Using cached file content');
  return cached;
}
```

---

### `cachePRDetail(...) -> Promise<void>`

**Purpose:** Stores complete pull request details in cache  
**Parameters:**
- `owner: string` - Repository owner
- `repo: string` - Repository name
- `prNumber: number` - Pull request number
- `prDetail: PullRequestDetail` - Complete PR object to cache

**Returns:** Promise resolving when cache operation completes  
**Side Effects:**
- Opens IndexedDB connection
- Serializes PR detail object to JSON string
- Stores with current timestamp
- Logs caching operation at console level

**Implementation Notes:**
- PR detail is stored as JSON string rather than structured data
- Includes all nested data (files, comments, reviews)
- Timestamp used for expiration calculation

**Usage Example:**
```typescript
await offlineCache.cachePRDetail(
  'microsoft', 'vscode', 12345,
  pullRequestDetailObject
);
```

---

### `getCachedPRDetail(...) -> Promise<PullRequestDetail | null>`

**Purpose:** Retrieves and deserializes cached pull request details with expiration check  
**Parameters:**
- `owner: string` - Repository owner
- `repo: string` - Repository name
- `prNumber: number` - Pull request number

**Returns:**
- `PullRequestDetail` object if cache hit and not expired
- `null` if cache miss or expired

**Side Effects:**
- Opens IndexedDB connection
- Parses JSON string to object
- Logs cache hit/miss at console level

**Validation Logic:**
1. Checks if cached entry exists
2. Verifies cached timestamp is within 7-day window
3. Parses JSON string to object
4. Returns null if validation or parsing fails

**Usage Example:**
```typescript
const cachedPR = await offlineCache.getCachedPRDetail(
  'microsoft', 'vscode', 12345
);
if (cachedPR) {
  console.log('Using cached PR details');
  return cachedPR;
}
```

---

### `cleanExpiredCache() -> Promise<void>`

**Purpose:** Removes all cache entries older than 7 days from both object stores  
**Parameters:** None  
**Returns:** Promise resolving when cleanup completes  
**Side Effects:**
- Opens IndexedDB connection
- Scans both `fileContents` and `prDetails` stores
- Deletes entries with `cachedAt` timestamp older than 7 days
- Logs cleanup statistics at console level

**Implementation Notes:**
- Called automatically on application startup (via useEffect in App.tsx)
- Uses cursor-based iteration for efficient scanning
- Calculates expiration threshold as `Date.now() - (7 * 24 * 60 * 60 * 1000)`
- Performs deletes in transaction for data consistency

**Usage Example:**
```typescript
// Called once on app mount
useEffect(() => {
  offlineCache.cleanExpiredCache();
}, []);
```

---

### `clearPRCache(...) -> Promise<void>`

**Purpose:** Removes all cached data for a specific pull request  
**Parameters:**
- `owner: string` - Repository owner
- `repo: string` - Repository name
- `prNumber: number` - Pull request number

**Returns:** Promise resolving when deletion completes  
**Side Effects:**
- Opens IndexedDB connection
- Deletes PR detail entry from `prDetails` store
- Deletes all file content entries from `fileContents` store using compound index
- Logs deletion statistics at console level

**Implementation Notes:**
- Uses `pr` compound index for efficient file content lookup
- Useful for forcing cache refresh or managing storage
- Does not affect other PRs in cache

**Usage Example:**
```typescript
// Clear cache when user refreshes a PR
await offlineCache.clearPRCache('microsoft', 'vscode', 12345);
```

---

## Integration with App

### Auto-Cache on PR Load

When a pull request is opened while online, all files are automatically cached in the background:

```typescript
useEffect(() => {
  if (!prDetail || !repoRef || !selectedPr || !isOnline) return;
  
  const cacheAllFiles = async () => {
    for (const file of prDetail.files) {
      const [headContent, baseContent] = await invoke("cmd_get_file_contents", ...);
      await offlineCache.cacheFileContent(...);
    }
  };
  
  cacheAllFiles();
}, [prDetail, repoRef, selectedPr, isOnline]);
```

### Query Integration Pattern

All React Query queries follow this pattern for offline support:

```typescript
const query = useQuery({
  queryFn: async () => {
    // Always try network first (enables reconnection detection)
    try {
      const data = await invoke(...);
      markOnline();
      await offlineCache.cache...(data);
      return data;
    } catch (error) {
      // Detect network errors
      if (isNetworkError(error)) {
        markOffline();
        // Fall back to cache
        const cached = await offlineCache.getCached...();
        if (cached) return cached;
        throw new Error('Network unavailable and no cached data');
      }
      throw error;
    }
  }
});
```

### Startup Cleanup

Expired cache entries are automatically removed on application launch:

```typescript
useEffect(() => {
  offlineCache.cleanExpiredCache();
}, []);
```

## Performance Characteristics

- **Write Performance:** O(log n) for insertions due to indexed storage
- **Read Performance:** O(1) for key-based lookups, O(log n) for index scans
- **Storage Limits:** Browser-dependent (typically 50MB-1GB+)
- **Memory Usage:** Minimal - IndexedDB operates on disk with small in-memory buffer

## Error Handling

All functions follow consistent error handling:

1. Catch and log IndexedDB errors to console
2. Reject promises with error details
3. Gracefully degrade by returning null on read failures
4. Network detection relies on these failures to trigger offline mode

## Browser Compatibility

- **Chrome/Edge:** Full support (Chromium-based)
- **Firefox:** Full support
- **Safari:** Full support (iOS 10+, macOS 10.12+)
- **Tauri WebView:** Guaranteed support (uses platform WebView)

## Constants

- `DB_NAME` - `'github-review-cache'`
- `DB_VERSION` - `1`
- `CACHE_EXPIRY_DAYS` - `7`
- `CACHE_EXPIRY_MS` - `7 * 24 * 60 * 60 * 1000` (7 days in milliseconds)

---

*Last generated: November 2025*
