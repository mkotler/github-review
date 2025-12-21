/**
 * Tests for usePaneZoom hook.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePaneZoom } from "../hooks/usePaneZoom";
import {
  PANE_ZOOM_DEFAULT,
  PANE_ZOOM_MIN,
  PANE_ZOOM_MAX,
  PANE_ZOOM_STEP,
} from "../constants";

describe("usePaneZoom hook", () => {
  let editorRef: React.RefObject<any>;
  let diffEditorRef: React.RefObject<any>;
  let hoveredPaneRef: React.MutableRefObject<'source' | 'preview' | null>;
  let mockUpdateOptions: ReturnType<typeof vi.fn>;
  let mockModifiedUpdateOptions: ReturnType<typeof vi.fn>;
  let mockOriginalUpdateOptions: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock refs
    mockUpdateOptions = vi.fn();
    mockModifiedUpdateOptions = vi.fn();
    mockOriginalUpdateOptions = vi.fn();

    editorRef = {
      current: {
        updateOptions: mockUpdateOptions,
      },
    };

    diffEditorRef = {
      current: {
        getModifiedEditor: () => ({ updateOptions: mockModifiedUpdateOptions }),
        getOriginalEditor: () => ({ updateOptions: mockOriginalUpdateOptions }),
      },
    };

    hoveredPaneRef = { current: null };
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clean up CSS custom property
    document.documentElement.style.removeProperty("--pane-zoom-scale");
  });

  describe("initialization", () => {
    it("should initialize with default zoom level", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT);
      expect(result.current.isDefaultZoom).toBe(true);
    });

    it("should set CSS custom property on mount", () => {
      renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      expect(
        document.documentElement.style.getPropertyValue("--pane-zoom-scale")
      ).toBe(PANE_ZOOM_DEFAULT.toString());
    });
  });

  describe("resetZoom", () => {
    it("should reset zoom to default level", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      // First, change the zoom level
      act(() => {
        result.current.adjustZoom(0.2);
      });

      expect(result.current.zoomLevel).not.toBe(PANE_ZOOM_DEFAULT);

      // Now reset
      act(() => {
        result.current.resetZoom();
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT);
      expect(result.current.isDefaultZoom).toBe(true);
    });
  });

  describe("adjustZoom", () => {
    it("should increase zoom level by delta", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      act(() => {
        result.current.adjustZoom(PANE_ZOOM_STEP);
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT + PANE_ZOOM_STEP);
      expect(result.current.isDefaultZoom).toBe(false);
    });

    it("should decrease zoom level by negative delta", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      act(() => {
        result.current.adjustZoom(-PANE_ZOOM_STEP);
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT - PANE_ZOOM_STEP);
    });

    it("should clamp zoom at minimum level", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      // Try to zoom way below minimum
      act(() => {
        result.current.adjustZoom(-10);
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_MIN);
    });

    it("should clamp zoom at maximum level", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      // Try to zoom way above maximum
      act(() => {
        result.current.adjustZoom(10);
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_MAX);
    });
  });

  describe("applyCodeZoom", () => {
    it("should update editor font size", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      act(() => {
        result.current.applyCodeZoom(1.5);
      });

      expect(mockUpdateOptions).toHaveBeenCalled();
    });

    it("should update diff editor font sizes", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      act(() => {
        result.current.applyCodeZoom(1.5);
      });

      expect(mockModifiedUpdateOptions).toHaveBeenCalled();
      expect(mockOriginalUpdateOptions).toHaveBeenCalled();
    });

    it("should handle null editor refs gracefully", () => {
      const nullEditorRef = { current: null };
      const nullDiffEditorRef = { current: null };

      const { result } = renderHook(() =>
        usePaneZoom({
          editorRef: nullEditorRef,
          diffEditorRef: nullDiffEditorRef,
          hoveredPaneRef,
        })
      );

      // Should not throw
      expect(() => {
        act(() => {
          result.current.applyCodeZoom(1.5);
        });
      }).not.toThrow();
    });
  });

  describe("keyboard shortcuts", () => {
    it("should zoom in with Ctrl+=", () => {
      hoveredPaneRef.current = "source";

      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      const event = new KeyboardEvent("keydown", {
        key: "=",
        ctrlKey: true,
        bubbles: true,
      });

      act(() => {
        window.dispatchEvent(event);
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT + PANE_ZOOM_STEP);
    });

    it("should zoom out with Ctrl+-", () => {
      hoveredPaneRef.current = "preview";

      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      const event = new KeyboardEvent("keydown", {
        key: "-",
        ctrlKey: true,
        bubbles: true,
      });

      act(() => {
        window.dispatchEvent(event);
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT - PANE_ZOOM_STEP);
    });

    it("should reset zoom with Ctrl+0", () => {
      hoveredPaneRef.current = "source";

      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      // First change zoom
      act(() => {
        result.current.adjustZoom(0.3);
      });

      const event = new KeyboardEvent("keydown", {
        key: "0",
        ctrlKey: true,
        bubbles: true,
      });

      act(() => {
        window.dispatchEvent(event);
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT);
    });

    it("should not zoom when not hovering over a pane", () => {
      hoveredPaneRef.current = null;

      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      const event = new KeyboardEvent("keydown", {
        key: "=",
        ctrlKey: true,
        bubbles: true,
      });

      act(() => {
        window.dispatchEvent(event);
      });

      // Should remain at default since not hovering
      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT);
    });

    it("should not zoom without Ctrl key", () => {
      hoveredPaneRef.current = "source";

      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      const event = new KeyboardEvent("keydown", {
        key: "=",
        ctrlKey: false,
        bubbles: true,
      });

      act(() => {
        window.dispatchEvent(event);
      });

      expect(result.current.zoomLevel).toBe(PANE_ZOOM_DEFAULT);
    });
  });

  describe("CSS custom property", () => {
    it("should update CSS custom property when zoom changes", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      act(() => {
        result.current.adjustZoom(0.2);
      });

      expect(
        document.documentElement.style.getPropertyValue("--pane-zoom-scale")
      ).toBe((PANE_ZOOM_DEFAULT + 0.2).toString());
    });

    it("should clean up CSS custom property on unmount", () => {
      const { unmount } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      unmount();

      expect(
        document.documentElement.style.getPropertyValue("--pane-zoom-scale")
      ).toBe("");
    });
  });

  describe("isDefaultZoom", () => {
    it("should be true when at default zoom", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      expect(result.current.isDefaultZoom).toBe(true);
    });

    it("should be false when zoomed in", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      act(() => {
        result.current.adjustZoom(PANE_ZOOM_STEP);
      });

      expect(result.current.isDefaultZoom).toBe(false);
    });

    it("should be false when zoomed out", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      act(() => {
        result.current.adjustZoom(-PANE_ZOOM_STEP);
      });

      expect(result.current.isDefaultZoom).toBe(false);
    });

    it("should handle floating point comparison", () => {
      const { result } = renderHook(() =>
        usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef })
      );

      // Zoom in and back to almost default (floating point may not be exact)
      act(() => {
        result.current.adjustZoom(0.1);
      });
      act(() => {
        result.current.adjustZoom(-0.1);
      });

      expect(result.current.isDefaultZoom).toBe(true);
    });
  });
});
