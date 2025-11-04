# app/src-tauri/src/main.rs

**Path:** `app/src-tauri/src/main.rs`

**Last Updated:** January 2025

**Lines of Code:** 7

## Capabilities Provided

This is the minimal Rust application entry point for the Tauri desktop application. It serves solely as a bootstrap that delegates all functionality to the library crate (`lib.rs`). The file includes a Windows-specific compiler directive to prevent a console window from appearing in release builds, ensuring a clean user experience on Windows without debug console output. The separation between `main.rs` and `lib.rs` follows Rust best practices, allowing the main application logic to be tested and reused independently of the binary entry point.

## Functions

### main

**Purpose:** Application entry point that immediately delegates to the library's run function.

**Parameters:** None

**Returns:** `()` - Unit type (implicitly, function signature omitted for entry point)

**Side Effects:**
- Calls `app_lib::run()` which initializes and starts the Tauri application
- Blocks until the Tauri application exits
- On Windows release builds: Suppresses console window creation via `windows_subsystem = "windows"` attribute

**Exceptions:** Any panics or errors from `app_lib::run()` will terminate the application

**Dependencies:** app_lib (references the library defined in `lib.rs`)

---

## Compiler Directives

### #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

**Purpose:** Conditionally applies Windows subsystem configuration to prevent console window in release builds.

**Condition:** Applied only when `debug_assertions` is disabled (i.e., in release builds)

**Effect:**
- **Release builds (no debug_assertions):** Application launches with Windows GUI subsystem, no console window appears
- **Debug builds (with debug_assertions):** Application launches with console subsystem, stdout/stderr visible in console for debugging

**Platform:** Windows-specific directive, ignored on macOS and Linux

**Rationale:** During development, console output is valuable for debugging. In production, a console window appearing alongside the GUI would be confusing and unprofessional for end users.

---

## Architecture Notes

### Binary vs Library Separation

This `main.rs` is intentionally minimal, following Rust best practices:

**Binary crate (`main.rs`):**
- Minimal entry point
- Cannot be tested via `cargo test` (entry points are not testable)
- Platform-specific configuration

**Library crate (`lib.rs`):**
- Contains all application logic
- Testable via `cargo test`
- Reusable (could be imported by other binaries or integration tests)
- Houses the `run()` function with full Tauri initialization

This separation enables:
- Unit testing of application logic in `lib.rs`
- Integration testing without running the full GUI
- Potential reuse of core logic in other contexts (e.g., CLI tools, test harnesses)

---

## Dependencies

### Internal Dependencies

- `app_lib` - The library crate defined by `lib.rs` in the same package, which contains the `run()` function

**Package Structure:**
```
app/src-tauri/
├── Cargo.toml          # Defines both bin and lib targets
├── src/
│   ├── main.rs         # Binary entry point (this file)
│   └── lib.rs          # Library with run() function
```

The `app_lib` name is automatically derived from the package name in `Cargo.toml`. When the package is named `app`, the library is accessible as `app_lib::*` to avoid conflicts with the binary name.

---

## Usage Context

This file is compiled to the platform-specific executable:
- **Windows:** `app.exe`
- **macOS:** `app` (within `.app` bundle)
- **Linux:** `app`

When users launch the application, this `main()` function is the process entry point. It immediately hands control to `app_lib::run()`, which:
1. Initializes the Tauri runtime
2. Sets up the WebView with the React frontend
3. Registers all Tauri command handlers
4. Initializes storage systems
5. Starts the event loop

The application runs until the user closes all windows or calls the quit command, at which point `run()` returns and `main()` exits.

---

## Platform-Specific Behavior

### Windows

**Release Build:**
- No console window
- Suitable for distribution to end users
- stdout/stderr are discarded unless redirected

**Debug Build:**
- Console window appears alongside GUI
- stdout/stderr visible for debugging
- tracing logs visible in console

### macOS and Linux

- Compiler directive has no effect
- Terminal behavior depends on how application is launched
- If launched from terminal: stdout/stderr visible
- If launched from GUI (Finder, app launcher): stdout/stderr may be captured in system logs

For production logging on all platforms, the application uses the `tracing` crate which can be configured to write to files or system logging services, independent of console output.
