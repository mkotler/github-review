/**
 * useViewedFiles hook for managing file viewed state across pull requests.
 * Persists viewed files to localStorage and provides convenient helper functions.
 */

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";

/** Type for the viewed files record (PR key -> array of file paths) */
export type ViewedFilesState = Record<string, string[]>;

export interface UseViewedFilesOptions {
  /** Repository owner */
  owner: string | null;
  /** Repository name */
  repo: string | null;
  /** Selected PR number */
  selectedPr: number | null;
  /** List of all files in the PR */
  allFilePaths?: string[];
  /** Active GitHub environment ID */
  environmentId?: string;
}

export interface UseViewedFilesReturn {
  /** Full record of all viewed files */
  viewedFiles: ViewedFilesState;
  /** Set the full viewed files state */
  setViewedFiles: React.Dispatch<React.SetStateAction<ViewedFilesState>>;
  /** Check if a specific file is viewed */
  isFileViewed: (filePath: string) => boolean;
  /** Toggle the viewed state of a file */
  toggleFileViewed: (filePath: string) => void;
  /** Mark all files in the current PR as viewed */
  markAllFilesAsViewed: () => void;
  /** Get the viewed files for the current PR */
  currentPrViewedFiles: string[];
  /** Get the PR key for the current selection */
  prKey: string | null;
}

/**
 * Hook for managing file viewed state across pull requests.
 * 
 * Features:
 * - Persists viewed files to localStorage per PR
 * - Provides helper functions to check/toggle/mark-all viewed state
 * - Memoizes the current PR's viewed files for performance
 * 
 * @example
 * const { isFileViewed, toggleFileViewed, markAllFilesAsViewed } = useViewedFiles({
 *   owner: repoRef?.owner,
 *   repo: repoRef?.repo,
 *   selectedPr,
 *   allFilePaths: files.map(f => f.path),
 * });
 */
export function useViewedFiles({
  owner,
  repo,
  selectedPr,
  allFilePaths = [],
  environmentId = "github.com",
}: UseViewedFilesOptions): UseViewedFilesReturn {
  const storageKey =
    environmentId === "github.com"
      ? "viewed-files"
      : `viewed-files-${environmentId}`;
  const [viewedFiles, setViewedFiles] = useLocalStorage<ViewedFilesState>({
    key: storageKey,
    defaultValue: {},
  });

  // Compute PR key for current selection
  const prKey = useMemo(() => {
    if (!owner || !repo || !selectedPr) return null;
    return `${owner}/${repo}#${selectedPr}`;
  }, [owner, repo, selectedPr]);

  // Get viewed files for current PR
  const currentPrViewedFiles = useMemo(() => {
    if (!prKey) return [];
    return viewedFiles[prKey] || [];
  }, [prKey, viewedFiles]);

  /** Check if a specific file is viewed */
  const isFileViewed = useCallback(
    (filePath: string): boolean => {
      return currentPrViewedFiles.includes(filePath);
    },
    [currentPrViewedFiles]
  );

  /** Toggle the viewed state of a file */
  const toggleFileViewed = useCallback(
    (filePath: string) => {
      if (!prKey) return;

      setViewedFiles((prev) => {
        const prViewed = prev[prKey] || [];
        const updated = prViewed.includes(filePath)
          ? prViewed.filter((f) => f !== filePath)
          : [...prViewed, filePath];
        return { ...prev, [prKey]: updated };
      });
    },
    [prKey, setViewedFiles]
  );

  /** Mark all files in the current PR as viewed */
  const markAllFilesAsViewed = useCallback(() => {
    if (!prKey || allFilePaths.length === 0) return;

    setViewedFiles((prev) => ({
      ...prev,
      [prKey]: allFilePaths,
    }));
  }, [prKey, allFilePaths, setViewedFiles]);

  return {
    viewedFiles,
    setViewedFiles,
    isFileViewed,
    toggleFileViewed,
    markAllFilesAsViewed,
    currentPrViewedFiles,
    prKey,
  };
}

export default useViewedFiles;
