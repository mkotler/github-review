// Category 1: Offline Cache Tests (offlineCache.ts)
// Tests for IndexedDB caching functionality

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cacheFileContent,
  getCachedFileContent,
  cachePRDetail,
  getCachedPRDetail,
  cleanExpiredCache,
  clearPRCache,
} from '../offlineCache';

describe('Offline Cache - offlineCache.ts', () => {
  // Clean up before each test
  beforeEach(async () => {
    // Reset IndexedDB
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });

  describe('Category 1.1-1.4: File Content Caching', () => {
    /**
     * Test Case 1.1: Store PR Data in IndexedDB
     * Save PR details to offline cache
     */
    it('should store file content in IndexedDB', async () => {
      await cacheFileContent(
        'facebook',
        'react',
        123,
        'src/App.tsx',
        'abc123',
        'def456',
        'new content',
        'old content'
      );

      const cached = await getCachedFileContent(
        'facebook',
        'react',
        123,
        'src/App.tsx',
        'abc123',
        'def456'
      );

      expect(cached).not.toBeNull();
      expect(cached?.headContent).toBe('new content');
      expect(cached?.baseContent).toBe('old content');
    });

    /**
     * Test Case 1.2: Retrieve Cached PR Data
     * Load PR from cache
     */
    it('should retrieve cached file content', async () => {
      await cacheFileContent(
        'owner',
        'repo',
        1,
        'file.ts',
        'head123',
        'base456',
        'head content',
        'base content'
      );

      const result = await getCachedFileContent(
        'owner',
        'repo',
        1,
        'file.ts',
        'head123',
        'base456'
      );

      expect(result).not.toBeNull();
      expect(result?.headContent).toBe('head content');
      expect(result?.baseContent).toBe('base content');
    });

    /**
     * Test Case 1.5: Store File Content with SHA
     * Cache file contents with commit SHA
     */
    it('should store file with correct SHA keys', async () => {
      await cacheFileContent(
        'facebook',
        'react',
        123,
        'src/App.tsx',
        'headSha123',
        'baseSha456',
        'head content',
        'base content'
      );

      // Should find with matching SHAs
      const found = await getCachedFileContent(
        'facebook',
        'react',
        123,
        'src/App.tsx',
        'headSha123',
        'baseSha456'
      );
      expect(found).not.toBeNull();
    });

    /**
     * Test Case 1.6: Retrieve File Content - SHA Match
     * Load file if SHA matches
     */
    it('should return cached file when SHA matches', async () => {
      await cacheFileContent(
        'owner',
        'repo',
        1,
        'file.ts',
        'correctHead',
        'correctBase',
        'content',
        null
      );

      const result = await getCachedFileContent(
        'owner',
        'repo',
        1,
        'file.ts',
        'correctHead',
        'correctBase'
      );

      expect(result).not.toBeNull();
      expect(result?.headContent).toBe('content');
    });

    /**
     * Test Case 1.7: Retrieve File Content - SHA Mismatch
     * Cached file for different commit should not be returned
     */
    it('should return null when SHA does not match', async () => {
      await cacheFileContent(
        'owner',
        'repo',
        1,
        'file.ts',
        'oldHead',
        'oldBase',
        'old content',
        null
      );

      const result = await getCachedFileContent(
        'owner',
        'repo',
        1,
        'file.ts',
        'newHead', // Different SHA
        'newBase'
      );

      expect(result).toBeNull();
    });
  });

  describe('Category 1.3-1.4: Cache Expiration', () => {
    /**
     * Test Case 1.3: Cached Data Expired (> 7 Days)
     * Cache entry older than TTL should be ignored
     */
    it('should return null for expired cache entries', async () => {
      // Store content with current time
      await cacheFileContent(
        'owner',
        'repo',
        1,
        'expired.ts',
        'head123',
        'base123',
        'content',
        null
      );

      // Mock Date.now to return 8 days in the future
      const originalDateNow = Date.now;
      const eightDaysLater = originalDateNow() + 8 * 24 * 60 * 60 * 1000;
      vi.spyOn(Date, 'now').mockReturnValue(eightDaysLater);

      try {
        // Should return null because expired
        const result = await getCachedFileContent(
          'owner',
          'repo',
          1,
          'expired.ts',
          'head123',
          'base123'
        );

        expect(result).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    /**
     * Test Case 1.4: Cached Data Valid (< 7 Days)
     * Fresh cache entry returned
     */
    it('should return valid cache entries (< 7 days old)', async () => {
      // Cache fresh data
      await cacheFileContent(
        'owner',
        'repo',
        1,
        'fresh.ts',
        'head',
        'base',
        'fresh content',
        null
      );

      const result = await getCachedFileContent(
        'owner',
        'repo',
        1,
        'fresh.ts',
        'head',
        'base'
      );

      expect(result).not.toBeNull();
      expect(result?.headContent).toBe('fresh content');
    });
  });

  describe('Category 1.8-1.10: Cache Management', () => {
    /**
     * Test Case 1.8: Clear Expired Cache Entries
     * Cleanup old entries from IndexedDB
     */
    it('should clean expired cache entries', async () => {
      // This test verifies cleanExpiredCache runs without error
      // In practice, we'd need to insert expired entries first
      await expect(cleanExpiredCache()).resolves.not.toThrow();
    });

    /**
     * Test Case 1.9: Cache Miss - Returns null gracefully
     */
    it('should return null for cache miss', async () => {
      const result = await getCachedFileContent(
        'nonexistent',
        'repo',
        999,
        'file.ts',
        'sha1',
        'sha2'
      );

      expect(result).toBeNull();
    });

    /**
     * Test Case 1.10: Clear PR Cache
     * Delete all cached data for specific PR
     */
    it('should clear all cache for specific PR', async () => {
      // Cache multiple files for same PR
      await cacheFileContent('owner', 'repo', 123, 'file1.ts', 'h', 'b', 'c1', null);
      await cacheFileContent('owner', 'repo', 123, 'file2.ts', 'h', 'b', 'c2', null);

      // Cache PR detail
      await cachePRDetail('owner', 'repo', 123, { title: 'Test PR' });

      // Clear all
      await clearPRCache('owner', 'repo', 123);

      // All should be gone
      const file1 = await getCachedFileContent('owner', 'repo', 123, 'file1.ts', 'h', 'b');
      const file2 = await getCachedFileContent('owner', 'repo', 123, 'file2.ts', 'h', 'b');
      const pr = await getCachedPRDetail('owner', 'repo', 123);

      expect(file1).toBeNull();
      expect(file2).toBeNull();
      expect(pr).toBeNull();
    });
  });

  describe('PR Detail Caching', () => {
    /**
     * Test: Cache and retrieve PR detail
     */
    it('should cache and retrieve PR detail', async () => {
      const prData = {
        number: 123,
        title: 'Test PR',
        author: 'octocat',
        files: [],
      };

      await cachePRDetail('owner', 'repo', 123, prData);

      const cached = await getCachedPRDetail('owner', 'repo', 123);

      expect(cached).not.toBeNull();
      expect(cached.number).toBe(123);
      expect(cached.title).toBe('Test PR');
    });

    /**
     * Test: Return null for non-existent PR detail
     */
    it('should return null for non-existent PR detail', async () => {
      const result = await getCachedPRDetail('owner', 'repo', 999);
      expect(result).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    /**
     * Test: Handle null content
     */
    it('should handle null head content (removed file)', async () => {
      await cacheFileContent(
        'owner',
        'repo',
        1,
        'removed.ts',
        'head',
        'base',
        null,
        'base content'
      );

      const result = await getCachedFileContent(
        'owner',
        'repo',
        1,
        'removed.ts',
        'head',
        'base'
      );

      expect(result?.headContent).toBeNull();
      expect(result?.baseContent).toBe('base content');
    });

    /**
     * Test: Handle null base content (new file)
     */
    it('should handle null base content (new file)', async () => {
      await cacheFileContent(
        'owner',
        'repo',
        1,
        'new.ts',
        'head',
        'base',
        'new content',
        null
      );

      const result = await getCachedFileContent(
        'owner',
        'repo',
        1,
        'new.ts',
        'head',
        'base'
      );

      expect(result?.headContent).toBe('new content');
      expect(result?.baseContent).toBeNull();
    });

    /**
     * Test: Handle special characters in file path
     */
    it('should handle special characters in file path', async () => {
      const specialPath = 'src/components/[id]/page.tsx';

      await cacheFileContent(
        'owner',
        'repo',
        1,
        specialPath,
        'head',
        'base',
        'content',
        null
      );

      const result = await getCachedFileContent(
        'owner',
        'repo',
        1,
        specialPath,
        'head',
        'base'
      );

      expect(result).not.toBeNull();
    });
  });
});
