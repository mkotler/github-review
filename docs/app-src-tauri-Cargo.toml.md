# app/src-tauri/Cargo.toml

**Path:** `app/src-tauri/Cargo.toml`

**Last Updated:** November 2025

**Package Version:** 0.1.0

## Purpose

This is the Cargo manifest for the Rust backend of the Tauri application. It defines package metadata, library configuration for Tauri integration, build dependencies for compile-time code generation, and runtime dependencies for GitHub API integration, OAuth authentication, secure storage, SQLite database, and async I/O.

## Package Metadata

- **name:** "app"
- **version:** "0.1.0"
- **edition:** "2021" (Rust 2021 edition)

## Library Configuration

**name:** "app_lib"
- Unique library name to avoid Windows linking conflicts (cargo issue #8519)

**crate-type:** ["staticlib", "cdylib", "rlib"]
- Multiple types for cross-platform Tauri bundling

## Build Dependencies

**tauri-build (2)** - Build-time code generation and asset embedding

## Runtime Dependencies

### Core Framework
- **tauri (2)** - Desktop application framework
- **tauri-plugin-opener (2)** - URL opener plugin

### Serialization
- **serde (1)** - Serialization framework with derive macros
- **serde_json (1)** - JSON support

### HTTP Client
- **reqwest (0.12)** - Async HTTP client with rustls-tls (no OpenSSL)

### Cryptography
- **rand (0.8)** - Random number generation for OAuth
- **sha2 (0.10)** - SHA-256 hashing for PKCE
- **base64 (0.22)** - Base64 encoding

### OAuth & Config
- **url (2)** - URL parsing
- **dotenvy (0.15)** - .env file loading

### Secure Storage
- **keyring (2)** - Cross-platform credential storage (Windows Credential Manager, macOS Keychain, Linux Secret Service)

### Error Handling
- **thiserror (1)** - Derive macros for error types

### Async Runtime
- **tokio (1)** - Async runtime with features: macros, rt-multi-thread, sync, time, fs

### System Integration
- **open (5)** - Opens URLs in system browser

### Logging
- **tracing (0.1)** - Structured logging
- **tracing-subscriber (0.3)** - Logging backend with fmt and env-filter

### Database
- **rusqlite (0.32)** - SQLite with bundled feature (no system dependency)
- **chrono (0.4)** - Date/time library

## Security Features

- rustls-tls instead of OpenSSL (memory-safe TLS)
- OS-level credential encryption via keyring
- Bundled SQLite (consistent version, no external dependencies)

## Build Process

### Development
`cargo build` - Debug mode with symbols

### Production
`cargo build --release` - Optimized release build
