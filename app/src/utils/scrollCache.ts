/**
 * Scroll cache utilities for persisting and restoring scroll positions.
 * Extracted from App.tsx for better modularity and testability.
 */

import {
  ScrollCacheEntry,
  ScrollCacheCollection,
  ScrollCacheState,
} from "../types";
import {
  SCROLL_CACHE_KEY,
  SCROLL_CACHE_TTL_MS,
  LEGACY_SCROLL_KEY,
} from "../constants";

/**
 * Type guard to check if a value is a valid ScrollCacheEntry.
 */
export const isScrollCacheEntry = (value: unknown): value is ScrollCacheEntry => {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as ScrollCacheEntry).position === "number" &&
    typeof (value as ScrollCacheEntry).updatedAt === "number",
  );
};

/**
 * Normalizes a value to a ScrollCacheCollection.
 * Handles legacy single-entry format conversion.
 */
export const normalizeCollection = (value: unknown): ScrollCacheCollection | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  // Handle legacy single-entry format
  if (isScrollCacheEntry(value)) {
    return { [LEGACY_SCROLL_KEY]: value };
  }

  const result: ScrollCacheCollection = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isScrollCacheEntry(entry)) {
      result[key] = entry;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

/**
 * Loads the scroll cache from sessionStorage.
 */
export const loadScrollCache = (): ScrollCacheState => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const stored = window.sessionStorage.getItem(SCROLL_CACHE_KEY);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const normalized = {
      fileList: normalizeCollection((parsed as ScrollCacheState).fileList),
      fileComments: normalizeCollection((parsed as ScrollCacheState).fileComments),
      sourcePane: normalizeCollection((parsed as ScrollCacheState).sourcePane),
    };
    return normalized;
  } catch (error) {
    return {};
  }
};

/**
 * Prunes expired entries from a scroll cache collection.
 */
export const pruneCollection = (collection?: ScrollCacheCollection): ScrollCacheCollection | undefined => {
  if (!collection) {
    return undefined;
  }
  const now = Date.now();
  const entries: ScrollCacheCollection = {};
  for (const [key, entry] of Object.entries(collection)) {
    if (now - entry.updatedAt <= SCROLL_CACHE_TTL_MS) {
      entries[key] = entry;
    }
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
};

/**
 * Prunes all expired entries from the entire scroll cache.
 */
export const pruneScrollCache = (cache: ScrollCacheState): ScrollCacheState => {
  const pruned = {
    fileList: pruneCollection(cache.fileList),
    fileComments: pruneCollection(cache.fileComments),
    sourcePane: pruneCollection(cache.sourcePane),
  };
  return pruned;
};

/**
 * Saves the scroll cache to sessionStorage.
 */
export const saveScrollCache = (cache: ScrollCacheState): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const pruned = pruneScrollCache(cache);
    window.sessionStorage.setItem(SCROLL_CACHE_KEY, JSON.stringify(pruned));
  } catch (error) {
    // Silently fail if sessionStorage is not available
    console.warn("Failed to save scroll cache:", error);
  }
};
