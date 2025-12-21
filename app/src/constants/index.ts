/**
 * Application constants for the GitHub Review application.
 * Extracted from App.tsx for better modularity and reusability.
 */

// =============================================================================
// Query Keys
// =============================================================================

export const AUTH_QUERY_KEY = ["auth-status"] as const;

// =============================================================================
// Retry Configuration
// =============================================================================

/** Retry configuration with exponential backoff for TanStack Query */
export const RETRY_CONFIG = {
  retry: 3,
  retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
};

// =============================================================================
// Zoom Settings
// =============================================================================

export const PANE_ZOOM_DEFAULT = 1;
export const PANE_ZOOM_MIN = 0.5;
export const PANE_ZOOM_MAX = 2;
export const PANE_ZOOM_STEP = 0.1;
export const BASE_EDITOR_FONT_SIZE = 14;

// =============================================================================
// Scroll Cache Settings
// =============================================================================

export const SCROLL_CACHE_KEY = "scroll-cache-v1";
/** 7 days in milliseconds */
export const SCROLL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LEGACY_SCROLL_KEY = "__legacy__";

// =============================================================================
// Source Pane Scroll Restoration Settings
// =============================================================================

/** Timeout for scroll restoration attempts (increased for long files) */
export const SOURCE_RESTORE_TIMEOUT_MS = 5000;
/** Maximum attempts for scroll restoration (increased for long files) */
export const SOURCE_RESTORE_MAX_ATTEMPTS = 50;
/** Epsilon for comparing scroll positions (pixels) */
export const SOURCE_RESTORE_EPSILON = 2;
/** Grace period after successful restore to prevent spurious saves */
export const SOURCE_RESTORE_GRACE_MS = 400;
/** Grace period for activation hold during file changes */
export const SOURCE_RESTORE_ACTIVATION_GRACE_MS = 600;

// =============================================================================
// Layout Constants
// =============================================================================

export const MIN_SIDEBAR_WIDTH = 340;
export const MIN_CONTENT_WIDTH = 480;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Clamps a value between a minimum and maximum.
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
