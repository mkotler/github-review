/**
 * Tests for useFileNavigation hook.
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileNavigation } from "../hooks/useFileNavigation";

describe("useFileNavigation hook", () => {
  describe("initial state", () => {
    it("should start with no selected file", () => {
      const { result } = renderHook(() => useFileNavigation());

      expect(result.current.selectedFilePath).toBeNull();
      expect(result.current.canGoBack).toBe(false);
      expect(result.current.canGoForward).toBe(false);
      expect(result.current.historyIndex).toBe(-1);
      expect(result.current.historyLength).toBe(0);
    });
  });

  describe("navigateToFile", () => {
    it("should select a file", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });

      expect(result.current.selectedFilePath).toBe("file1.ts");
      expect(result.current.historyIndex).toBe(0);
      expect(result.current.historyLength).toBe(1);
    });

    it("should build navigation history", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });
      act(() => {
        result.current.navigateToFile("file2.ts");
      });
      act(() => {
        result.current.navigateToFile("file3.ts");
      });

      expect(result.current.selectedFilePath).toBe("file3.ts");
      expect(result.current.historyIndex).toBe(2);
      expect(result.current.historyLength).toBe(3);
      expect(result.current.canGoBack).toBe(true);
      expect(result.current.canGoForward).toBe(false);
    });

    it("should handle navigating to null", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });
      act(() => {
        result.current.navigateToFile(null);
      });

      expect(result.current.selectedFilePath).toBeNull();
    });
  });

  describe("goBack", () => {
    it("should navigate to previous file", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });
      act(() => {
        result.current.navigateToFile("file2.ts");
      });
      act(() => {
        result.current.goBack();
      });

      expect(result.current.selectedFilePath).toBe("file1.ts");
      expect(result.current.historyIndex).toBe(0);
      expect(result.current.canGoBack).toBe(false);
      expect(result.current.canGoForward).toBe(true);
    });

    it("should do nothing when at start of history", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });
      act(() => {
        result.current.goBack();
      });

      expect(result.current.selectedFilePath).toBe("file1.ts");
      expect(result.current.historyIndex).toBe(0);
    });
  });

  describe("goForward", () => {
    it("should navigate to next file after going back", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });
      act(() => {
        result.current.navigateToFile("file2.ts");
      });
      act(() => {
        result.current.goBack();
      });
      act(() => {
        result.current.goForward();
      });

      expect(result.current.selectedFilePath).toBe("file2.ts");
      expect(result.current.historyIndex).toBe(1);
      expect(result.current.canGoForward).toBe(false);
    });

    it("should do nothing when at end of history", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });
      act(() => {
        result.current.goForward();
      });

      expect(result.current.selectedFilePath).toBe("file1.ts");
    });
  });

  describe("history truncation", () => {
    it("should truncate forward history when navigating to new file", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });
      act(() => {
        result.current.navigateToFile("file2.ts");
      });
      act(() => {
        result.current.navigateToFile("file3.ts");
      });
      act(() => {
        result.current.goBack();
      });
      act(() => {
        result.current.goBack();
      });

      // Now at file1, forward history has file2, file3
      expect(result.current.selectedFilePath).toBe("file1.ts");
      expect(result.current.canGoForward).toBe(true);

      // Navigate to new file - should truncate forward history
      act(() => {
        result.current.navigateToFile("file4.ts");
      });

      expect(result.current.selectedFilePath).toBe("file4.ts");
      expect(result.current.historyLength).toBe(2); // file1, file4
      expect(result.current.canGoForward).toBe(false);
    });
  });

  describe("clearHistory", () => {
    it("should reset all navigation state", () => {
      const { result } = renderHook(() => useFileNavigation());

      act(() => {
        result.current.navigateToFile("file1.ts");
      });
      act(() => {
        result.current.navigateToFile("file2.ts");
      });
      act(() => {
        result.current.clearHistory();
      });

      expect(result.current.selectedFilePath).toBeNull();
      expect(result.current.historyIndex).toBe(-1);
      expect(result.current.historyLength).toBe(0);
      expect(result.current.canGoBack).toBe(false);
      expect(result.current.canGoForward).toBe(false);
    });
  });

  describe("back and forward navigation sequence", () => {
    it("should handle complex navigation sequence", () => {
      const { result } = renderHook(() => useFileNavigation());

      // Navigate through files
      act(() => {
        result.current.navigateToFile("a.ts");
      });
      act(() => {
        result.current.navigateToFile("b.ts");
      });
      act(() => {
        result.current.navigateToFile("c.ts");
      });
      act(() => {
        result.current.navigateToFile("d.ts");
      });

      expect(result.current.selectedFilePath).toBe("d.ts");

      // Go back twice
      act(() => {
        result.current.goBack();
      });
      act(() => {
        result.current.goBack();
      });

      expect(result.current.selectedFilePath).toBe("b.ts");

      // Go forward once
      act(() => {
        result.current.goForward();
      });

      expect(result.current.selectedFilePath).toBe("c.ts");

      // Navigate to new file (should truncate d.ts from history)
      act(() => {
        result.current.navigateToFile("e.ts");
      });

      expect(result.current.selectedFilePath).toBe("e.ts");
      expect(result.current.canGoForward).toBe(false);

      // Going back should go to c, then b, then a
      act(() => {
        result.current.goBack();
      });
      expect(result.current.selectedFilePath).toBe("c.ts");

      act(() => {
        result.current.goBack();
      });
      expect(result.current.selectedFilePath).toBe("b.ts");

      act(() => {
        result.current.goBack();
      });
      expect(result.current.selectedFilePath).toBe("a.ts");

      expect(result.current.canGoBack).toBe(false);
    });
  });
});
