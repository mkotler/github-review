# app/src/useNetworkStatus.ts

**Path:** `app/src/useNetworkStatus.ts`  
**Last Updated:** November 2025  
**Lines of Code:** ~50

## Capabilities Provided

This custom React hook provides comprehensive network connectivity detection and management for the GitHub Review Tool's offline support features. It combines browser-native online/offline events with programmatic control to detect both physical network disconnections and HTTP-level connectivity failures.

Key capabilities:

- **Browser Event Detection** - Listens to `window.online` and `window.offline` events
- **Programmatic Control** - Exposes `markOffline()` and `markOnline()` functions for manual state control
- **HTTP Error Integration** - Enables queries to mark offline status when HTTP requests fail
- **Automatic Reconnection** - Supports detection of network recovery through successful requests
- **Console Logging** - Provides visibility into network state changes for debugging

## Hook API

### `useNetworkStatus() -> { isOnline: boolean, markOffline: () => void, markOnline: () => void }`

**Purpose:** Tracks network connectivity status and provides control functions  
**Parameters:** None  
**Returns:** Object with three properties:
- `isOnline: boolean` - Current network status (true = online, false = offline)
- `markOffline: () => void` - Function to programmatically mark as offline
- `markOnline: () => void` - Function to programmatically mark as online

**Side Effects:**
- Registers global `online` and `offline` event listeners on mount
- Cleans up event listeners on unmount
- Logs state transitions to console with emoji indicators
- Initializes with `navigator.onLine` state

**Usage Example:**
```typescript
function App() {
  const { isOnline, markOffline, markOnline } = useNetworkStatus();
  
  // Use isOnline for conditional rendering
  if (!isOnline) {
    return <OfflineIndicator />;
  }
  
  // Use markOffline/markOnline in queries
  try {
    const data = await fetch(...);
    markOnline();
  } catch (error) {
    if (isNetworkError(error)) {
      markOffline();
    }
  }
}
```

---

## State Management

### Internal State
- `isOnline: boolean` - React state tracking current connectivity status
- Initialized with `navigator.onLine` (browser's network interface status)

### State Transitions

**Browser Event → Online:**
- Trigger: `window.addEventListener('online')`
- Action: `setIsOnline(true)`
- Log: `🌐 Network: Browser detected online`

**Browser Event → Offline:**
- Trigger: `window.addEventListener('offline')`
- Action: `setIsOnline(false)`
- Log: `🌐 Network: Browser detected offline`

**Programmatic → Online:**
- Trigger: `markOnline()` called (typically after successful HTTP request)
- Action: `setIsOnline(true)` (only if currently offline)
- Log: `🌐 Network: Detected as online (successful request)`

**Programmatic → Offline:**
- Trigger: `markOffline()` called (typically after HTTP error)
- Action: `setIsOnline(false)` (only if currently online)
- Log: `🌐 Network: Detected as offline (network error)`

---

## Implementation Details

### Browser Event Listeners

The hook registers event listeners on mount and cleans them up on unmount:

```typescript
useEffect(() => {
  const handleOnline = () => {
    console.log('🌐 Network: Browser detected online');
    setIsOnline(true);
  };
  
  const handleOffline = () => {
    console.log('🌐 Network: Browser detected offline');
    setIsOnline(false);
  };
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}, []);
```

**Scope:** Browser `online`/`offline` events detect network interface status (WiFi on/off, Ethernet connected/disconnected) but don't detect HTTP-level failures like DNS errors, firewall blocks, or server downtime.

---

### Programmatic Control Functions

#### `markOffline()`

**Purpose:** Manually mark application as offline (used when HTTP requests fail)  
**Behavior:**
- Checks current state before updating (avoids redundant state changes)
- Only logs and updates if currently online
- Prevents unnecessary re-renders when already offline

**Implementation:**
```typescript
const markOffline = useCallback(() => {
  if (isOnline) {
    console.log('🌐 Network: Detected as offline (network error)');
    setIsOnline(false);
  }
}, [isOnline]);
```

**Usage Context:** Called by React Query queries when detecting network errors:
```typescript
catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const isNetworkError = 
    errorMsg.includes('http error') ||
    errorMsg.includes('error sending request') ||
    errorMsg.includes('fetch') || 
    errorMsg.includes('network');
  
  if (isNetworkError) {
    markOffline();
  }
}
```

---

#### `markOnline()`

**Purpose:** Manually mark application as online (used when HTTP requests succeed)  
**Behavior:**
- Checks current state before updating (avoids redundant state changes)
- Only logs and updates if currently offline
- Enables automatic reconnection detection

**Implementation:**
```typescript
const markOnline = useCallback(() => {
  if (!isOnline) {
    console.log('🌐 Network: Detected as online (successful request)');
    setIsOnline(true);
  }
}, [isOnline]);
```

**Usage Context:** Called by React Query queries on successful requests:
```typescript
try {
  const data = await invoke(...);
  markOnline();  // Successful request = we're online
  return data;
} catch (error) {
  // Handle error
}
```

---

## Integration with React Query

### Network-First Query Pattern

All queries use a "network-first" strategy to enable automatic reconnection detection:

```typescript
const query = useQuery({
  queryFn: async () => {
    // Always try network first, even when marked offline
    try {
      const data = await invoke(...);
      markOnline();  // Success = mark online
      await offlineCache.cache...(data);
      return data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Detect network errors
      const isNetworkError = 
        errorMsg.includes('http error') ||
        errorMsg.includes('error sending request') ||
        errorMsg.includes('fetch') || 
        errorMsg.includes('network') || 
        errorMsg.includes('Failed to invoke') ||
        errorMsg.includes('connection') ||
        errorMsg.includes('timeout');
      
      if (isNetworkError) {
        markOffline();  // Network error = mark offline
        
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

### Reconnection Detection Flow

1. **Offline State:** User is marked offline due to HTTP error
2. **Query Triggered:** User navigates to different PR or file
3. **Network Attempt:** Query tries network first (ignores offline flag)
4. **Success:** If network succeeds, `markOnline()` is called automatically
5. **Result:** User is back online without manual intervention

This approach eliminates the need for polling or manual "Retry" buttons.

---

## UI Integration

### Offline Indicator

The network status is used to conditionally render an offline indicator:

```typescript
{!isOnline && (
  <div 
    className="network-status network-status--offline"
    title="Offline - using cached data"
  >
    <svg className="network-status__icon" viewBox="0 0 24 24">
      <path fill="currentColor" d="M23.64 7c-.45-.34-4.93-4-11.64-4..."/>
    </svg>
    <span className="network-status__text">Offline</span>
  </div>
)}
```

**Behavior:** Only renders when `isOnline === false`, reducing UI clutter when connectivity is available.

### Disabled Features

Direct comment posting is disabled when offline:

```typescript
<button
  disabled={!isOnline}
  onClick={handlePostComment}
>
  Post comment
</button>

{!isOnline && (
  <div className="warning">
    ⚠️ Offline - Direct comments disabled. Use 'Start review' to save comments locally.
  </div>
)}
```

**Rationale:** Direct comments require immediate HTTP POST, which fails when offline. Review workflow uses local storage and doesn't require network access.

---

## Performance Characteristics

- **Memory Usage:** Minimal (single boolean state + 2 event listeners)
- **Re-render Impact:** Low (state changes only on connectivity transitions)
- **Event Overhead:** Negligible (browser events fire rarely, callbacks are memoized)

## Browser Compatibility

### `navigator.onLine` Support
- **Chrome/Edge:** Full support
- **Firefox:** Full support
- **Safari:** Full support (iOS 4+, macOS 10.5+)
- **Tauri WebView:** Guaranteed support

### `online`/`offline` Events
- **Chrome/Edge:** Full support
- **Firefox:** Full support
- **Safari:** Full support (iOS 4.2+, macOS 10.6+)
- **Tauri WebView:** Guaranteed support

## Limitations

### `navigator.onLine` Accuracy

The `navigator.onLine` property and `online`/`offline` events only detect network **interface** status, not actual internet connectivity:

**Detected:**
- ✅ WiFi turned off/on
- ✅ Ethernet cable unplugged/plugged
- ✅ Airplane mode enabled/disabled

**NOT Detected:**
- ❌ Router disconnected from internet (WiFi still on)
- ❌ DNS server failures
- ❌ Firewall blocking HTTP requests
- ❌ API server downtime
- ❌ Authentication failures (401/403)

**Solution:** The hook provides `markOffline()` and `markOnline()` functions to handle HTTP-level failures programmatically. This combination provides comprehensive coverage:
1. Browser events catch interface changes (WiFi off/on)
2. HTTP error detection catches connectivity issues (DNS, firewall, server down)

---

## Testing Recommendations

### Manual Testing Scenarios

**1. WiFi Toggle:**
- Turn off WiFi → Should see offline indicator immediately
- Turn on WiFi → Should see indicator disappear immediately

**2. HTTP Failure:**
- Disconnect router from internet (keep WiFi on)
- Navigate to new PR → Should see offline indicator after HTTP error
- Cached data should load automatically

**3. Reconnection:**
- While marked offline, reconnect internet
- Navigate to different PR → Should automatically detect connection
- Offline indicator should disappear

**4. Airplane Mode:**
- Enable airplane mode → Offline indicator appears
- Disable airplane mode → Indicator disappears
- PRs remain accessible via cache

---

## Dependencies

- `react` - `useState`, `useEffect`, `useCallback` hooks
- Browser APIs - `navigator.onLine`, `window.addEventListener`

---

*Last generated: November 2025*
