/**
 * Tests for scroll cache utilities.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isScrollCacheEntry,
  normalizeCollection,
  loadScrollCache,
  pruneCollection,
  pruneScrollCache,
  saveScrollCache,
} from "../utils/scrollCache";
import { LEGACY_SCROLL_KEY, SCROLL_CACHE_TTL_MS } from "../constants";

describe("scrollCache utilities", () => {
  describe("isScrollCacheEntry", () => {
    it("returns true for valid entries", () => {
      expect(isScrollCacheEntry({ position: 100, updatedAt: Date.now() })).toBe(true);
      expect(isScrollCacheEntry({ position: 0, updatedAt: 0 })).toBe(true);
    });

    it("returns false for invalid entries", () => {
      expect(isScrollCacheEntry(null)).toBe(false);
      expect(isScrollCacheEntry(undefined)).toBe(false);
      expect(isScrollCacheEntry({})).toBe(false);
      expect(isScrollCacheEntry({ position: 100 })).toBe(false);
      expect(isScrollCacheEntry({ updatedAt: Date.now() })).toBe(false);
      expect(isScrollCacheEntry({ position: "100", updatedAt: Date.now() })).toBe(false);
      expect(isScrollCacheEntry("string")).toBe(false);
      expect(isScrollCacheEntry(123)).toBe(false);
    });
  });

  describe("normalizeCollection", () => {
    it("returns undefined for null/undefined", () => {
      expect(normalizeCollection(null)).toBeUndefined();
      expect(normalizeCollection(undefined)).toBeUndefined();
    });

    it("returns undefined for non-objects", () => {
      expect(normalizeCollection("string")).toBeUndefined();
      expect(normalizeCollection(123)).toBeUndefined();
    });

    it("converts legacy single-entry format", () => {
      const entry = { position: 100, updatedAt: Date.now() };
      const result = normalizeCollection(entry);
      expect(result).toEqual({ [LEGACY_SCROLL_KEY]: entry });
    });

    it("normalizes collection format", () => {
      const now = Date.now();
      const collection = {
        "file1.md": { position: 100, updatedAt: now },
        "file2.md": { position: 200, updatedAt: now },
      };
      const result = normalizeCollection(collection);
      expect(result).toEqual(collection);
    });

    it("filters out invalid entries", () => {
      const now = Date.now();
      const collection = {
        valid: { position: 100, updatedAt: now },
        invalid: { position: "bad" },
        alsoInvalid: null,
      };
      const result = normalizeCollection(collection);
      expect(result).toEqual({
        valid: { position: 100, updatedAt: now },
      });
    });

    it("returns undefined for empty collection after filtering", () => {
      const collection = {
        invalid: { position: "bad" },
      };
      expect(normalizeCollection(collection)).toBeUndefined();
    });
  });

  describe("pruneCollection", () => {
    it("returns undefined for undefined input", () => {
      expect(pruneCollection(undefined)).toBeUndefined();
    });

    it("keeps entries within TTL", () => {
      const now = Date.now();
      const collection = {
        recent: { position: 100, updatedAt: now - 1000 },
      };
      const result = pruneCollection(collection);
      expect(result).toEqual(collection);
    });

    it("removes entries older than TTL", () => {
      const now = Date.now();
      const collection = {
        recent: { position: 100, updatedAt: now - 1000 },
        old: { position: 200, updatedAt: now - SCROLL_CACHE_TTL_MS - 1000 },
      };
      const result = pruneCollection(collection);
      expect(result).toEqual({
        recent: { position: 100, updatedAt: now - 1000 },
      });
    });

    it("returns undefined when all entries are expired", () => {
      const now = Date.now();
      const collection = {
        old: { position: 100, updatedAt: now - SCROLL_CACHE_TTL_MS - 1000 },
      };
      expect(pruneCollection(collection)).toBeUndefined();
    });
  });

  describe("pruneScrollCache", () => {
    it("prunes all sections", () => {
      const now = Date.now();
      const old = now - SCROLL_CACHE_TTL_MS - 1000;
      
      const cache = {
        fileList: {
          recent: { position: 100, updatedAt: now },
          old: { position: 200, updatedAt: old },
        },
        fileComments: {
          old: { position: 300, updatedAt: old },
        },
        sourcePane: {
          recent: { position: 400, updatedAt: now },
        },
      };

      const result = pruneScrollCache(cache);
      expect(result.fileList).toEqual({
        recent: { position: 100, updatedAt: now },
      });
      expect(result.fileComments).toBeUndefined();
      expect(result.sourcePane).toEqual({
        recent: { position: 400, updatedAt: now },
      });
    });
  });

  describe("loadScrollCache", () => {
    beforeEach(() => {
      // Mock sessionStorage
      vi.stubGlobal("sessionStorage", {
        getItem: vi.fn(),
        setItem: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns empty object when no cache exists", () => {
      (sessionStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
      expect(loadScrollCache()).toEqual({});
    });

    it("returns empty object for invalid JSON", () => {
      (sessionStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("invalid json");
      expect(loadScrollCache()).toEqual({});
    });

    it("returns empty object for non-object JSON", () => {
      (sessionStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('"string"');
      expect(loadScrollCache()).toEqual({});
    });

    it("loads and normalizes valid cache", () => {
      const now = Date.now();
      const cache = {
        fileList: {
          "file.md": { position: 100, updatedAt: now },
        },
      };
      (sessionStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cache));
      
      const result = loadScrollCache();
      expect(result.fileList).toEqual(cache.fileList);
    });
  });

  describe("saveScrollCache", () => {
    beforeEach(() => {
      vi.stubGlobal("sessionStorage", {
        getItem: vi.fn(),
        setItem: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("saves pruned cache to sessionStorage", () => {
      const now = Date.now();
      const cache = {
        fileList: {
          "file.md": { position: 100, updatedAt: now },
        },
      };

      saveScrollCache(cache);

      expect(sessionStorage.setItem).toHaveBeenCalledWith(
        "scroll-cache-v1",
        expect.any(String)
      );

      const savedValue = (sessionStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const parsed = JSON.parse(savedValue);
      expect(parsed.fileList).toEqual(cache.fileList);
    });

    it("handles sessionStorage errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      (sessionStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Storage full");
      });

      // Should not throw
      expect(() => saveScrollCache({})).not.toThrow();
      consoleSpy.mockRestore();
    });
  });
});
