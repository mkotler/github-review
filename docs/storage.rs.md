# app/src-tauri/src/storage.rs

**Path:** `app/src-tauri/src/storage.rs`

**Last Updated:** January 2025

**Lines of Code:** 38

## Capabilities Provided

This module provides secure credential storage for the GitHub OAuth access token using the operating system's native credential management system. On Windows, it uses the Windows Credential Manager; on macOS, it uses the Keychain; and on Linux, it uses the Secret Service API. The module abstracts away platform-specific differences through the `keyring` crate, providing three simple functions: store, read, and delete. The implementation gracefully handles the "no entry" case for reading and deletion, treating missing entries as success rather than errors. This ensures the OAuth token persists across application restarts without requiring users to re-authenticate.

## Functions

### store_token

**Purpose:** Stores the GitHub OAuth access token in the system's secure credential storage.

**Parameters:**
- `token: &str` - GitHub OAuth access token to store securely

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:**
- Creates or updates entry in system credential manager with service name "github-review" and account name "github-token"
- On Windows: Stored in Windows Credential Manager under "Generic Credentials"
- On macOS: Stored in macOS Keychain
- On Linux: Stored via Secret Service API (GNOME Keyring or KDE Wallet)

**Exceptions:**
- `AppError::Keyring` - If credential manager access fails or permissions are insufficient

**Dependencies:** keyring::Entry, SERVICE_NAME, ACCOUNT_NAME constants

---

### read_token

**Purpose:** Retrieves the stored GitHub OAuth access token from secure storage.

**Parameters:** None

**Returns:** `AppResult<Option<String>>` - Some(token) if stored, None if no token exists, or error if access fails

**Side Effects:** Reads from system credential manager

**Exceptions:**
- `AppError::Keyring` - If credential manager access fails (excluding NoEntry, which returns Ok(None))

**Dependencies:** keyring::Entry, KeyringError, SERVICE_NAME, ACCOUNT_NAME constants

**Notes:** Distinguishes between "no entry exists" (returns Ok(None)) and "error accessing storage" (returns Err). This enables clean authentication status checks without treating missing tokens as errors.

---

### delete_token

**Purpose:** Removes the GitHub OAuth access token from secure storage (used during logout).

**Parameters:** None

**Returns:** `AppResult<()>` - Unit type on success

**Side Effects:** Deletes entry from system credential manager

**Exceptions:**
- `AppError::Keyring` - If credential manager access fails (excluding NoEntry, which returns Ok(()))

**Dependencies:** keyring::Entry, KeyringError, SERVICE_NAME, ACCOUNT_NAME constants

**Notes:** Idempotent - succeeds even if no token exists, enabling safe logout operations without checking existence first.

---

## Constants

### SERVICE_NAME

**Value:** `"github-review"`

**Purpose:** Service identifier for the credential entry, used to namespace credentials in the system credential manager

**Usage:** Combined with ACCOUNT_NAME to create unique credential entry

---

### ACCOUNT_NAME

**Value:** `"github-token"`

**Purpose:** Account identifier for the credential entry, distinguishes this credential from other potential credentials for the same service

**Usage:** Combined with SERVICE_NAME to create unique credential entry

---

## Dependencies

### External Crates

- `keyring` - Cross-platform secure credential storage (Entry, Error types)

### Internal Dependencies

- `crate::error` - AppError, AppResult types for error handling

### Usage Context

This module is used by:
- `auth.rs` - Stores token after successful OAuth flow, reads token for authentication checks, deletes token on logout
- `lib.rs` - Indirectly through auth.rs for all authenticated operations

### Platform Support

**Windows:**
- Uses Windows Credential Manager
- Credentials stored under "Generic Credentials"
- Accessible via Control Panel > Credential Manager

**macOS:**
- Uses macOS Keychain
- Credentials stored in login keychain
- Accessible via Keychain Access.app

**Linux:**
- Uses Secret Service API (freedesktop.org specification)
- Requires GNOME Keyring, KDE Wallet, or compatible implementation
- May prompt for keyring unlock on first access

### Security Considerations

- Tokens are stored encrypted at rest by the OS credential manager
- Access is restricted to the current user account
- No plaintext token storage in files or environment variables
- Token is never logged or included in error messages
