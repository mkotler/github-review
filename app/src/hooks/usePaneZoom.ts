/**
 * usePaneZoom hook for managing pane zoom level.
 * Handles zoom controls, keyboard shortcuts, and mouse wheel zooming.
 */

import { useState, useCallback, useEffect } from "react";
import {
  PANE_ZOOM_DEFAULT,
  PANE_ZOOM_MIN,
  PANE_ZOOM_MAX,
  PANE_ZOOM_STEP,
  BASE_EDITOR_FONT_SIZE,
  clamp,
} from "../constants";

export interface UsePaneZoomOptions {
  /** Reference to the Monaco editor instance */
  editorRef: React.RefObject<any>;
  /** Reference to the Monaco diff editor instance */
  diffEditorRef: React.RefObject<any>;
  /** Reference to track which pane is currently hovered */
  hoveredPaneRef: React.MutableRefObject<'source' | 'preview' | null>;
}

export interface UsePaneZoomReturn {
  /** Current zoom level (1.0 = 100%) */
  zoomLevel: number;
  /** Reset zoom to default level */
  resetZoom: () => void;
  /** Adjust zoom by a delta value */
  adjustZoom: (delta: number) => void;
  /** Apply current zoom to Monaco editors */
  applyCodeZoom: (scale: number) => void;
  /** Check if zoom is at default level */
  isDefaultZoom: boolean;
}

/**
 * Hook for managing pane zoom functionality.
 * 
 * Features:
 * - Ctrl+mouse wheel zooming when hovering over source/preview pane
 * - Ctrl+Plus/Minus keyboard shortcuts for zooming
 * - Ctrl+0 to reset zoom
 * - Automatic application of zoom to Monaco editors
 * - CSS custom property for preview pane scaling
 * 
 * @example
 * const { zoomLevel, resetZoom, adjustZoom, isDefaultZoom } = usePaneZoom({
 *   editorRef,
 *   diffEditorRef,
 *   hoveredPaneRef,
 * });
 */
export function usePaneZoom({
  editorRef,
  diffEditorRef,
  hoveredPaneRef,
}: UsePaneZoomOptions): UsePaneZoomReturn {
  const [zoomLevel, setZoomLevel] = useState(PANE_ZOOM_DEFAULT);

  /** Reset zoom to default level */
  const resetZoom = useCallback(() => {
    setZoomLevel(PANE_ZOOM_DEFAULT);
  }, []);

  /** Adjust zoom by a delta value, clamping to valid range */
  const adjustZoom = useCallback((delta: number) => {
    setZoomLevel((prev) => {
      const next = clamp(
        parseFloat((prev + delta).toFixed(2)),
        PANE_ZOOM_MIN,
        PANE_ZOOM_MAX
      );
      return next;
    });
  }, []);

  /** Apply zoom level to Monaco editor instances */
  const applyCodeZoom = useCallback((scale: number) => {
    const fontSize = Math.round(BASE_EDITOR_FONT_SIZE * scale);
    if (editorRef.current) {
      editorRef.current.updateOptions({ fontSize });
    }
    if (diffEditorRef.current) {
      const modified = diffEditorRef.current.getModifiedEditor?.();
      const original = diffEditorRef.current.getOriginalEditor?.();
      modified?.updateOptions?.({ fontSize });
      original?.updateOptions?.({ fontSize });
    }
  }, [editorRef, diffEditorRef]);

  // Apply zoom to editors when zoom level changes
  useEffect(() => {
    applyCodeZoom(zoomLevel);
  }, [zoomLevel, applyCodeZoom]);

  // Set CSS custom property for preview pane scaling
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--pane-zoom-scale", zoomLevel.toString());
    return () => {
      root.style.removeProperty("--pane-zoom-scale");
    };
  }, [zoomLevel]);

  // Handle mouse wheel zooming
  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !hoveredPaneRef.current) {
        return;
      }
      event.preventDefault();
      adjustZoom(event.deltaY < 0 ? PANE_ZOOM_STEP : -PANE_ZOOM_STEP);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !hoveredPaneRef.current) {
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        adjustZoom(PANE_ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        adjustZoom(-PANE_ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [adjustZoom, resetZoom, hoveredPaneRef]);

  const isDefaultZoom = Math.abs(zoomLevel - PANE_ZOOM_DEFAULT) <= 0.001;

  return {
    zoomLevel,
    resetZoom,
    adjustZoom,
    applyCodeZoom,
    isDefaultZoom,
  };
}

export default usePaneZoom;
