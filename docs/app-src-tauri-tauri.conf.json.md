# app/src-tauri/tauri.conf.json

**Path:** `app/src-tauri/tauri.conf.json`

**Last Updated:** November 2025

**Version:** 0.1.0

## Purpose

This is the Tauri configuration file that defines desktop application metadata, build pipeline integration, window settings, and bundle options. It orchestrates the frontend (React/Vite) and backend (Rust) build processes, configures application window appearance, and specifies platform-specific bundle settings.

## Application Metadata

- **productName:** "app" - Application display name
- **version:** "0.1.0" - Semantic version (should match package.json and Cargo.toml)
- **identifier:** "com.mkotler.app" - Unique reverse-DNS identifier (macOS bundle ID, Windows AppData)

## Build Configuration

### beforeDevCommand
`npm run dev` - Starts Vite dev server before development mode

### devUrl
`http://localhost:1420` - Frontend dev server URL (must match Vite port)

### beforeBuildCommand
`npm run build` - Builds frontend before creating production bundle

### frontendDist
`../dist` - Frontend build output directory (relative path, must match Vite output)

## Window Configuration

**Initial Window:**
- **title:** "app"
- **width:** 800 pixels
- **height:** 600 pixels
- **maximized:** true (starts fullscreen)

## Security

**CSP:** null (disabled)
- Production should enable Content Security Policy
- Example: `"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"`

## Bundle Settings

**active:** true - Enables packaging
**targets:** "all" - Creates all platform-specific installers

**Icons:**
- 32x32.png
- 128x128.png
- 128x128@2x.png (HiDPI)
- icon.icns (macOS)
- icon.ico (Windows)

## Build Output

### Development
`src-tauri/target/debug/app` - Executable with debug symbols

### Production
`src-tauri/target/release/bundle/` - Platform installers:
- Windows: MSI, NSIS
- macOS: DMG, APP
- Linux: DEB, AppImage, RPM

## Runtime Behavior

### Development Mode
1. Executes `npm run dev` (Vite server)
2. Compiles Rust in debug mode
3. Opens window loading `devUrl`
4. HMR updates frontend

### Production Build
1. Executes `npm run build` (TypeScript + Vite)
2. Compiles Rust in release mode
3. Embeds frontend from `frontendDist`
4. Creates platform installers
