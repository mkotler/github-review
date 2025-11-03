# GitHub Review Tool

A desktop application built with Tauri and React that streamlines the GitHub pull request review process. This tool provides an enhanced interface for reviewing PRs with features like local comment drafting, synchronized source/preview panes, markdown rendering with image support, and crash-resistant local storage for in-progress reviews.

## Key Capabilities

- **OAuth Authentication** - Secure GitHub login via OAuth 2.0 flow with credential storage in system keyring
- **PR Browsing & Viewing** - List and filter pull requests by state (open/closed) with detailed file diffs
- **Enhanced Code Review** - Monaco editor integration with diff view and side-by-side source/preview panes
- **Inline Comment Creation** - Hover over line numbers to reveal "+" buttons for quick line-level commenting
- **Local Review Storage** - SQLite-backed comment drafting with automatic log file generation for crash recovery
- **Comment Management** - Create, edit, and delete comments locally before submitting to GitHub
- **Bidirectional Scroll Sync** - Synchronized scrolling between source code and markdown preview
- **Markdown Preview** - Full GitHub Flavored Markdown support with HTML rendering and repository image fetching
- **Batch Submission** - Submit all review comments atomically as a single GitHub review
- **Review State Management** - Support for APPROVE, REQUEST_CHANGES, COMMENT, and PENDING review states
- **Abandoned Review Tracking** - Preserve log files when reviews are cancelled for audit/email purposes

## Project Structure

See [docs/summary.md](docs/summary.md) for a comprehensive repository map including directory structure and per-file documentation.

## Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Rust** 1.70+ with cargo
- **Tauri CLI** - Install via `npm install -g @tauri-apps/cli`
- **GitHub OAuth App** - Register at https://github.com/settings/developers
  - Note your Client ID and Client Secret

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_ORG/github-review.git
   cd github-review/app
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Configure OAuth credentials**
   ```bash
   cp .env.example src-tauri/.env
   # Edit src-tauri/.env and add your GitHub OAuth credentials
   ```

4. **Build Rust backend** (optional, happens automatically on dev)
   ```bash
   cd src-tauri
   cargo build
   cd ..
   ```

### Run Development Server

```bash
npm run tauri dev
```

This starts the Vite dev server and launches the Tauri application window.

### Using Inline Comments

When viewing a pull request file in the Monaco Editor:
1. **Hover** your mouse over the line numbers or glyph margin (left of line numbers)
2. A **"+" button** will appear next to the line
3. **Click the "+" button** to open the comment composer with the line number pre-filled
4. Choose to **"Post comment"** (immediate) or **"Start review"** / **"Add to review"** (pending review workflow)

### Build for Production

```bash
npm run tauri build
```

The executable will be in `src-tauri/target/release/`.

### Test

> ⚠️ Unknown: No test suite configuration found in package.json or Cargo.toml. Tests may exist but are not discoverable via standard commands.

## Additional Documentation

- [Local Review API](LOCAL_REVIEW_API.md) - Detailed API for local review storage system
- [Debugging Storage](DEBUGGING_STORAGE.md) - Troubleshooting guide for SQLite storage issues
- [Repository Summary](docs/summary.md) - Complete codebase map and file documentation

## Architecture

- **Frontend**: React 19 + TypeScript + Vite
- **Backend**: Tauri 2 (Rust)
- **State Management**: TanStack Query + Zustand
- **Storage**: SQLite via rusqlite
- **Authentication**: OAuth 2.0 with system keyring integration
- **Editor**: Monaco Editor
- **Markdown**: react-markdown with rehype/remark plugins

## License

> ⚠️ Unknown: No LICENSE file found in repository root.
