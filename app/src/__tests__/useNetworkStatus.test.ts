// Category 2: Network Status Hook Tests (useNetworkStatus.ts)
// Tests for online/offline detection

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNetworkStatus } from '../useNetworkStatus';

describe('Network Status Hook - useNetworkStatus.ts', () => {
  // Store original navigator.onLine
  let originalOnLine: boolean;

  beforeEach(() => {
    originalOnLine = navigator.onLine;
  });

  afterEach(() => {
    // Restore navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      writable: true,
    });
  });

  describe('Category 2.1-2.2: Initial Status Detection', () => {
    /**
     * Test Case 2.1: Detect Online Status on Mount
     * Hook initializes with correct online status
     */
    it('should detect online status on mount', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(true);
    });

    /**
     * Test Case 2.2: Detect Offline Status on Mount
     * Initialize with offline status
     */
    it('should detect offline status on mount', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(false);
    });
  });

  describe('Category 2.3-2.4: Network Transitions', () => {
    /**
     * Test Case 2.3: Transition Online → Offline
     * Detect network loss
     */
    it('should detect transition from online to offline', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(true);

      // Simulate offline event
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      expect(result.current.isOnline).toBe(false);
    });

    /**
     * Test Case 2.4: Transition Offline → Online
     * Detect network restored
     */
    it('should detect transition from offline to online', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(false);

      // Simulate online event
      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(result.current.isOnline).toBe(true);
    });
  });

  describe('Category 2.5-2.6: Manual Detection', () => {
    /**
     * Test Case 2.5: Manual Offline Detection via markOffline()
     * Set offline after network error
     */
    it('should allow manual offline detection via markOffline', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(true);

      act(() => {
        result.current.markOffline();
      });

      expect(result.current.isOnline).toBe(false);
    });

    /**
     * Test Case 2.6: Manual Online Detection via markOnline()
     * Set online after successful request
     */
    it('should allow manual online detection via markOnline', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(false);

      act(() => {
        result.current.markOnline();
      });

      expect(result.current.isOnline).toBe(true);
    });
  });

  describe('Category 2.7: Cleanup and Memory', () => {
    /**
     * Test Case 2.7: Cleanup Event Listeners on Unmount
     * No memory leaks
     */
    it('should cleanup event listeners on unmount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useNetworkStatus());

      // Should have added listeners
      expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));

      unmount();

      // Should have removed listeners
      expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    /**
     * Test: markOffline is idempotent when already offline
     */
    it('should be idempotent when marking offline while already offline', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(false);

      act(() => {
        result.current.markOffline();
      });

      // Should still be offline (no change)
      expect(result.current.isOnline).toBe(false);
    });

    /**
     * Test: markOnline is idempotent when already online
     */
    it('should be idempotent when marking online while already online', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(true);

      act(() => {
        result.current.markOnline();
      });

      // Should still be online (no change)
      expect(result.current.isOnline).toBe(true);
    });

    /**
     * Test: Multiple rapid transitions
     */
    it('should handle multiple rapid online/offline transitions', () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(result.current.isOnline).toBe(false);

      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(result.current.isOnline).toBe(true);

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(result.current.isOnline).toBe(false);

      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(result.current.isOnline).toBe(true);
    });

    /**
     * Test: Hook returns stable function references
     */
    it('should return stable function references', () => {
      const { result, rerender } = renderHook(() => useNetworkStatus());

      const firstMarkOffline = result.current.markOffline;
      const firstMarkOnline = result.current.markOnline;

      rerender();

      // Functions should be stable (same reference due to useCallback)
      expect(result.current.markOffline).toBe(firstMarkOffline);
      expect(result.current.markOnline).toBe(firstMarkOnline);
    });
  });
});
