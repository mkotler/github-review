/**
 * Tests for useViewedFiles hook.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useViewedFiles } from "../hooks/useViewedFiles";

// Create a fresh localStorage mock for each test
const createLocalStorageMock = (initialData: Record<string, string> = {}) => {
  const store = { ...initialData };
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    getStore: () => store,
  };
};

describe("useViewedFiles hook", () => {
  let mockStorage: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    mockStorage = createLocalStorageMock();
    Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with empty state when no stored data", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.viewedFiles).toEqual({});
      expect(result.current.currentPrViewedFiles).toEqual([]);
    });

    it("should load initial state from localStorage", () => {
      const initialData = { "owner/repo#1": ["file1.ts", "file2.ts"] };
      mockStorage = createLocalStorageMock({
        "viewed-files": JSON.stringify(initialData),
      });
      Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true });

      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.viewedFiles).toEqual(initialData);
      expect(result.current.currentPrViewedFiles).toEqual(["file1.ts", "file2.ts"]);
    });

    it("should handle invalid JSON in localStorage gracefully", () => {
      mockStorage = createLocalStorageMock({
        "viewed-files": "not-valid-json",
      });
      Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true });

      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.viewedFiles).toEqual({});
    });
  });

  describe("prKey", () => {
    it("should generate correct PR key", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "microsoft",
          repo: "vscode",
          selectedPr: 123,
        })
      );

      expect(result.current.prKey).toBe("microsoft/vscode#123");
    });

    it("should return null when owner is missing", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: null,
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.prKey).toBeNull();
    });

    it("should return null when repo is missing", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: null,
          selectedPr: 1,
        })
      );

      expect(result.current.prKey).toBeNull();
    });

    it("should return null when selectedPr is missing", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: null,
        })
      );

      expect(result.current.prKey).toBeNull();
    });
  });

  describe("isFileViewed", () => {
    it("should return true for viewed file", () => {
      const initialData = { "owner/repo#1": ["file1.ts"] };
      mockStorage = createLocalStorageMock({
        "viewed-files": JSON.stringify(initialData),
      });
      Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true });

      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.isFileViewed("file1.ts")).toBe(true);
    });

    it("should return false for unviewed file", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.isFileViewed("file1.ts")).toBe(false);
    });

    it("should return false when prKey is null", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: null,
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.isFileViewed("file1.ts")).toBe(false);
    });
  });

  describe("toggleFileViewed", () => {
    it("should mark file as viewed", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.isFileViewed("file1.ts")).toBe(false);

      act(() => {
        result.current.toggleFileViewed("file1.ts");
      });

      expect(result.current.isFileViewed("file1.ts")).toBe(true);
    });

    it("should mark file as unviewed when already viewed", () => {
      const initialData = { "owner/repo#1": ["file1.ts"] };
      mockStorage = createLocalStorageMock({
        "viewed-files": JSON.stringify(initialData),
      });
      Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true });

      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      expect(result.current.isFileViewed("file1.ts")).toBe(true);

      act(() => {
        result.current.toggleFileViewed("file1.ts");
      });

      expect(result.current.isFileViewed("file1.ts")).toBe(false);
    });

    it("should do nothing when prKey is null", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: null,
          repo: "repo",
          selectedPr: 1,
        })
      );

      act(() => {
        result.current.toggleFileViewed("file1.ts");
      });

      expect(result.current.viewedFiles).toEqual({});
    });

    it("should persist to localStorage", async () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      act(() => {
        result.current.toggleFileViewed("file1.ts");
      });

      await waitFor(() => {
        expect(mockStorage.setItem).toHaveBeenCalled();
      });

      const lastCall = mockStorage.setItem.mock.calls[mockStorage.setItem.mock.calls.length - 1];
      const stored = JSON.parse(lastCall[1]);
      expect(stored["owner/repo#1"]).toContain("file1.ts");
    });
  });

  describe("markAllFilesAsViewed", () => {
    it("should mark all files as viewed", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
          allFilePaths: ["file1.ts", "file2.ts", "file3.ts"],
        })
      );

      act(() => {
        result.current.markAllFilesAsViewed();
      });

      expect(result.current.isFileViewed("file1.ts")).toBe(true);
      expect(result.current.isFileViewed("file2.ts")).toBe(true);
      expect(result.current.isFileViewed("file3.ts")).toBe(true);
    });

    it("should do nothing when prKey is null", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: null,
          repo: "repo",
          selectedPr: 1,
          allFilePaths: ["file1.ts"],
        })
      );

      act(() => {
        result.current.markAllFilesAsViewed();
      });

      expect(result.current.viewedFiles).toEqual({});
    });

    it("should do nothing when allFilePaths is empty", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
          allFilePaths: [],
        })
      );

      act(() => {
        result.current.markAllFilesAsViewed();
      });

      // Should not create an empty entry
      expect(result.current.viewedFiles["owner/repo#1"]).toBeUndefined();
    });
  });

  describe("persistence", () => {
    it("should persist changes to localStorage", async () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      act(() => {
        result.current.toggleFileViewed("file1.ts");
        result.current.toggleFileViewed("file2.ts");
      });

      await waitFor(() => {
        expect(mockStorage.setItem).toHaveBeenCalled();
      });

      const lastCall = mockStorage.setItem.mock.calls[mockStorage.setItem.mock.calls.length - 1];
      const stored = JSON.parse(lastCall[1]);
      expect(stored["owner/repo#1"]).toEqual(["file1.ts", "file2.ts"]);
    });
  });

  describe("multiple PRs", () => {
    it("should track viewed files separately per PR", () => {
      const { result, rerender } = renderHook(
        (props) => useViewedFiles(props),
        {
          initialProps: {
            owner: "owner",
            repo: "repo",
            selectedPr: 1 as number | null,
            allFilePaths: [] as string[],
          },
        }
      );

      // Mark file as viewed in PR #1
      act(() => {
        result.current.toggleFileViewed("file1.ts");
      });

      // Switch to PR #2
      rerender({
        owner: "owner",
        repo: "repo",
        selectedPr: 2,
        allFilePaths: [],
      });

      // File should not be viewed in PR #2
      expect(result.current.isFileViewed("file1.ts")).toBe(false);

      // Mark a different file in PR #2
      act(() => {
        result.current.toggleFileViewed("file2.ts");
      });

      // Switch back to PR #1
      rerender({
        owner: "owner",
        repo: "repo",
        selectedPr: 1,
        allFilePaths: [],
      });

      // Original file should still be viewed
      expect(result.current.isFileViewed("file1.ts")).toBe(true);
      expect(result.current.isFileViewed("file2.ts")).toBe(false);
    });
  });

  describe("setViewedFiles", () => {
    it("should allow direct state updates", () => {
      const { result } = renderHook(() =>
        useViewedFiles({
          owner: "owner",
          repo: "repo",
          selectedPr: 1,
        })
      );

      act(() => {
        result.current.setViewedFiles({
          "owner/repo#1": ["file1.ts", "file2.ts"],
          "other/repo#2": ["file3.ts"],
        });
      });

      expect(result.current.viewedFiles).toEqual({
        "owner/repo#1": ["file1.ts", "file2.ts"],
        "other/repo#2": ["file3.ts"],
      });
    });
  });
});
