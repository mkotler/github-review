# app/package.json

**Path:** `app/package.json`

**Last Updated:** November 2025

**Package Version:** 0.1.0

## Purpose

This is the Node.js package manifest for the React/TypeScript frontend of the Tauri application. It defines project metadata, npm scripts for development and build workflows, production dependencies for the React UI, and development dependencies for the TypeScript/Vite build toolchain. The configuration uses ES modules ("type": "module") and integrates with Tauri CLI for desktop application bundling.

## Package Metadata

- **name:** "app" - Package identifier
- **version:** "0.1.0" - Semantic version
- **private:** true - Prevents npm registry publication
- **type:** "module" - Uses ES modules (import/export)

## Scripts

### dev
`npm run dev` - Starts Vite development server with HMR

### build
`npm run build` - TypeScript compilation + Vite production bundle

### preview
`npm run preview` - Serves production build locally

### tauri
`npm run tauri` - Proxy to Tauri CLI commands

## Production Dependencies

**UI Framework:**
- react (^19.1.0) - Core library
- react-dom (^19.1.0) - DOM renderer

**State Management:**
- @tanstack/react-query (^5.90.5) - Server state and caching
- zustand (^5.0.8) - Lightweight state management

**Tauri:**
- @tauri-apps/api (^2) - Backend communication
- @tauri-apps/plugin-opener (^2) - URL opener

**Code Editor:**
- @monaco-editor/react (^4.7.0) - React wrapper
- monaco-editor (^0.54.0) - VS Code editor core

**Markdown:**
- react-markdown (^10.1.0) - Markdown renderer
- remark-gfm (^4.0.1) - GitHub Flavored Markdown
- remark-frontmatter (^5.0.0) - YAML frontmatter
- rehype-raw (^7.0.0) - Raw HTML support
- rehype-sanitize (^6.0.0) - XSS prevention
- yaml (^2.8.1) - YAML parsing

**Utilities:**
- clsx (^2.1.1) - Conditional className utility

## Development Dependencies

**Build Tools:**
- vite (^7.0.4) - Fast build tool
- @vitejs/plugin-react (^4.6.0) - React Fast Refresh

**TypeScript:**
- typescript (~5.8.3) - Type checking
- @types/react (^19.1.8) - React types
- @types/react-dom (^19.1.6) - ReactDOM types

**CSS:**
- tailwindcss (^4.1.16) - Utility CSS framework
- postcss (^8.5.6) - CSS processing
- autoprefixer (^10.4.21) - Vendor prefixes

**Tauri:**
- @tauri-apps/cli (^2) - Build and bundle CLI

## Build Pipeline

### Development
1. `npm run tauri dev`
2. Executes `npm run dev` (Vite)
3. Compiles Rust backend
4. Opens window with HMR

### Production
1. `npm run tauri build`
2. Executes `npm run build` (TypeScript + Vite)
3. Compiles Rust in release mode
4. Creates platform installer
