# Repository Summary

This document provides a comprehensive map of the GitHub Review Tool codebase, including directory structure and links to detailed per-file documentation.

## Table of Contents

- [Directory Structure](#directory-structure)
- [Frontend Source Files](#frontend-source-files)
- [Backend Source Files](#backend-source-files)
- [Configuration Files](#configuration-files)

## Directory Structure

```
github-review/
├── app/                          # Main application directory
│   ├── src/                      # React frontend source
│   │   ├── App.tsx              # Main application component (3202 LOC)
│   │   ├── App.css              # Application styles
│   │   ├── main.tsx             # React entry point
│   │   └── assets/              # Static assets
│   ├── src-tauri/               # Rust backend source
│   │   ├── src/
│   │   │   ├── lib.rs           # Tauri command handlers and initialization
│   │   │   ├── main.rs          # Rust application entry point
│   │   │   ├── auth.rs          # OAuth authentication and GitHub API client
│   │   │   ├── github.rs        # GitHub API operations
│   │   │   ├── models.rs        # Shared data structures
│   │   │   ├── error.rs         # Error types and handling
│   │   │   ├── storage.rs       # Storage initialization and management
│   │   │   └── review_storage.rs # SQLite review storage implementation
│   │   ├── Cargo.toml           # Rust dependencies
│   │   ├── tauri.conf.json      # Tauri configuration
│   │   └── build.rs             # Build script
│   ├── package.json             # Frontend dependencies and scripts
│   ├── tsconfig.json            # TypeScript configuration
│   ├── vite.config.ts           # Vite bundler configuration
│   └── index.html               # HTML entry point
├── docs/                         # Documentation directory
└── README.md                     # Project overview and quick start
```

## Frontend Source Files

### [app/src/App.tsx](app-src-App.tsx.md)
Primary React application component containing the full UI and business logic for the GitHub review tool. Implements PR listing, file viewing, comment management, markdown preview, and Monaco editor integration. Features include MRU repository dropdown with localStorage persistence, comment count badges on files, file viewed tracking with per-PR state, auto-navigation to pending reviews, and quick access to log folder.

### [app/src/main.tsx](app-src-main.tsx.md)
React application entry point that sets up TanStack Query provider and renders the root App component.

### app/src/App.css
Comprehensive stylesheet with custom variables, component styles, modal dialogs, and responsive layouts. Defines theming for dark UI with blue/gray color scheme.

## Backend Source Files

### [app/src-tauri/src/lib.rs](app-src-tauri-src-lib.rs.md)
Central module that exports all Tauri commands, initializes logging, storage, and wires together the authentication, GitHub API, and storage layers.

### [app/src-tauri/src/main.rs](app-src-tauri-src-main.rs.md)
Tauri application entry point. Minimal file that invokes the `run()` function from lib.rs.

### [app/src-tauri/src/auth.rs](app-src-tauri-src-auth.rs.md)
Implements OAuth 2.0 authentication flow, token management via system keyring, and provides wrappers for GitHub API operations that require authentication.

### [app/src-tauri/src/github.rs](app-src-tauri-src-github.rs.md)
Low-level GitHub REST API client implementation. Handles HTTP requests, SSO challenges, pagination, PR data fetching, comment operations, review management, and file content retrieval.

### [app/src-tauri/src/models.rs](app-src-tauri-src-models.rs.md)
Shared Rust data structures (types) for authentication status, pull requests, files, comments, and reviews. Includes serde serialization for JSON interop with frontend.

### [app/src-tauri/src/error.rs](app-src-tauri-src-error.rs.md)
Centralized error type definitions using `thiserror`. Defines `AppError` enum covering authentication, API, storage, and I/O errors with `Result<T>` type alias.

### [app/src-tauri/src/storage.rs](app-src-tauri-src-storage.rs.md)
Storage subsystem initialization. Creates SQLite database file in app data directory and sets up the schema for review storage.

### [app/src-tauri/src/review_storage.rs](app-src-tauri-src-review-storage.rs.md)
SQLite-backed local review storage implementation. Manages review metadata, comments, log file generation, and provides CRUD operations for draft reviews.

## Configuration Files

### [app/package.json](app-package.json.md)
Frontend package manifest defining dependencies (React, TanStack Query, Monaco Editor, react-markdown), devDependencies (Vite, TypeScript, Tauri CLI), and npm scripts.

### app/tsconfig.json
TypeScript compiler configuration with strict type checking, ES2020 target, and React JSX settings.

### app/vite.config.ts
Vite bundler configuration with React plugin and Tauri-specific build settings for desktop application packaging.

### [app/src-tauri/Cargo.toml](app-src-tauri-Cargo.toml.md)
Rust package manifest defining dependencies (tauri, reqwest, rusqlite, keyring, tokio) and build configuration for both library and binary targets.

### app/src-tauri/tauri.conf.json
Tauri framework configuration including app ID, window settings, security policies, and build options.

---

*Generated documentation for GitHub Review Tool v0.1.0*
