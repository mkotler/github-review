/**
 * Custom hook for file navigation with history (back/forward).
 * Manages the navigation stack for file selection.
 */

import { useState, useCallback } from "react";

export interface UseFileNavigationReturn {
  /** Currently selected file path */
  selectedFilePath: string | null;
  /** Navigate to a file (adds to history) */
  navigateToFile: (path: string | null) => void;
  /** Navigate back in history */
  goBack: () => void;
  /** Navigate forward in history */
  goForward: () => void;
  /** Whether back navigation is available */
  canGoBack: boolean;
  /** Whether forward navigation is available */
  canGoForward: boolean;
  /** Clear navigation history */
  clearHistory: () => void;
  /** Current position in history stack */
  historyIndex: number;
  /** Total history length */
  historyLength: number;
}

interface NavigationState {
  history: string[];
  index: number;
  selectedFilePath: string | null;
}

/**
 * Hook to manage file navigation with history.
 * Supports back/forward navigation similar to browser history.
 * 
 * @returns File navigation state and controls
 * 
 * @example
 * const { selectedFilePath, navigateToFile, goBack, goForward, canGoBack, canGoForward } = useFileNavigation();
 */
export function useFileNavigation(): UseFileNavigationReturn {
  const [state, setState] = useState<NavigationState>({
    history: [],
    index: -1,
    selectedFilePath: null,
  });

  const navigateToFile = useCallback((path: string | null) => {
    if (path === null) {
      setState((prev) => ({ ...prev, selectedFilePath: null }));
      return;
    }

    setState((prev) => {
      // Truncate forward history and add new path
      const newHistory = [...prev.history.slice(0, prev.index + 1), path];
      return {
        history: newHistory,
        index: newHistory.length - 1,
        selectedFilePath: path,
      };
    });
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.index > 0) {
        const newIndex = prev.index - 1;
        return {
          ...prev,
          index: newIndex,
          selectedFilePath: prev.history[newIndex],
        };
      }
      return prev;
    });
  }, []);

  const goForward = useCallback(() => {
    setState((prev) => {
      if (prev.index < prev.history.length - 1) {
        const newIndex = prev.index + 1;
        return {
          ...prev,
          index: newIndex,
          selectedFilePath: prev.history[newIndex],
        };
      }
      return prev;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setState({
      history: [],
      index: -1,
      selectedFilePath: null,
    });
  }, []);

  return {
    selectedFilePath: state.selectedFilePath,
    navigateToFile,
    goBack,
    goForward,
    canGoBack: state.index > 0,
    canGoForward: state.index < state.history.length - 1,
    clearHistory,
    historyIndex: state.index,
    historyLength: state.history.length,
  };
}

export default useFileNavigation;
