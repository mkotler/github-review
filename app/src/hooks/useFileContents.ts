/**
 * useFileContents hook - Manages file content loading with offline caching.
 * 
 * This hook handles:
 * - Looking up file metadata from PR details
 * - Loading file contents from GitHub API
 * - Caching content for offline access
 * - Falling back to cache when offline
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { PullRequestDetail, PullRequestFile, RepoRef } from "../types";
import * as offlineCache from "../offlineCache";

export interface UseFileContentsOptions {
  /** The currently selected file path */
  selectedFilePath: string | null;
  /** Repository reference (owner/repo) */
  repoRef: RepoRef | null;
  /** PR details including files list */
  prDetail: PullRequestDetail | null;
  /** Selected PR number */
  selectedPr: number | null;
  /** Whether this is local directory mode (skip network requests) */
  isLocalDirectoryMode: boolean;
  /** Current online status */
  isOnline: boolean;
  /** Callback to mark app as online */
  markOnline: () => void;
  /** Callback to mark app as offline */
  markOffline: () => void;
  /** Active local directory path (for query key) */
  activeLocalDir: string | null;
}

export interface FileContents {
  headContent: string | null;
  baseContent: string | null;
}

export interface UseFileContentsResult {
  /** The selected file with content loaded (or null if not selected/loading) */
  selectedFile: PullRequestFile | null;
  /** The selected file's metadata without content */
  selectedFileMetadata: PullRequestFile | null;
  /** Raw file contents data */
  fileContents: FileContents | null;
  /** Whether file contents are currently loading */
  isLoading: boolean;
  /** Whether there was an error loading file contents */
  isError: boolean;
  /** Error message if loading failed */
  error: Error | null;
}

/**
 * Hook for loading file contents with offline caching support.
 * 
 * Behavior:
 * 1. In local directory mode, returns file metadata directly (content already embedded)
 * 2. In PR mode, fetches content from GitHub API with network-first strategy
 * 3. Caches successful fetches for offline access
 * 4. Falls back to cache when network is unavailable
 */
export function useFileContents(options: UseFileContentsOptions): UseFileContentsResult {
  const {
    selectedFilePath,
    repoRef,
    prDetail,
    selectedPr,
    isLocalDirectoryMode,
    isOnline,
    markOnline,
    markOffline,
    activeLocalDir,
  } = options;

  // Look up file metadata from PR files list
  const selectedFileMetadata = useMemo(() => {
    if (!prDetail || !selectedFilePath) return null;
    return prDetail.files.find((file: PullRequestFile) => file.path === selectedFilePath) ?? null;
  }, [prDetail, selectedFilePath]);

  // Fetch file contents on demand when a file is selected
  const fileContentsQuery = useQuery({
    queryKey: [
      "file-contents",
      repoRef?.owner,
      repoRef?.repo,
      selectedFilePath,
      prDetail?.base_sha,
      prDetail?.head_sha,
      activeLocalDir,
    ],
    queryFn: async (): Promise<FileContents | null> => {
      if (!selectedFileMetadata || !prDetail || !repoRef || !selectedPr) return null;
      
      // Always try network first (to detect coming back online)
      try {
        const [headContent, baseContent] = await invoke<[string | null, string | null]>("cmd_get_file_contents", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          filePath: selectedFilePath,
          baseSha: prDetail.base_sha,
          headSha: prDetail.head_sha,
          status: selectedFileMetadata.status,
          previousFilename: selectedFileMetadata.previous_filename ?? null,
        });
        
        // Successful network request - mark online
        markOnline();
        
        // Cache the result
        await offlineCache.cacheFileContent(
          repoRef.owner,
          repoRef.repo,
          selectedPr,
          selectedFilePath!,
          prDetail.head_sha,
          prDetail.base_sha,
          headContent,
          baseContent
        );
        
        return { headContent, baseContent };
      } catch (error) {
        // Check if it's a network error (Tauri invoke errors or HTTP errors)
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isNetworkError = 
          errorMsg.includes('http error') ||
          errorMsg.includes('error sending request') ||
          errorMsg.includes('fetch') || 
          errorMsg.includes('network') || 
          errorMsg.includes('Failed to invoke') ||
          errorMsg.includes('connection') ||
          errorMsg.includes('timeout');
        
        if (isNetworkError) {
          console.log('🌐 Network error detected:', errorMsg);
          markOffline();
          
          // Try cache as fallback
          const cached = await offlineCache.getCachedFileContent(
            repoRef.owner,
            repoRef.repo,
            selectedPr,
            selectedFilePath!,
            prDetail.head_sha,
            prDetail.base_sha
          );
          if (cached) {
            console.log(`📦 Loaded file ${selectedFilePath} from offline cache (after network error)`);
            return cached;
          }
          throw new Error('Network unavailable and no cached data. Data will load when connection is restored.');
        }
        throw error;
      }
    },
    enabled: Boolean(selectedFileMetadata && prDetail && repoRef && !isLocalDirectoryMode),
    staleTime: Infinity, // File contents don't change for a given SHA
    retry: (failureCount, error) => {
      // Don't retry if offline and no cache available
      if (!isOnline && error instanceof Error && error.message.includes('No cached data available')) {
        return false;
      }
      // Otherwise use normal retry logic
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Merge file metadata with loaded content
  const selectedFile = useMemo(() => {
    if (!selectedFileMetadata) return null;
    if (!fileContentsQuery.data) return selectedFileMetadata;
    return {
      ...selectedFileMetadata,
      head_content: fileContentsQuery.data.headContent,
      base_content: fileContentsQuery.data.baseContent,
    };
  }, [selectedFileMetadata, fileContentsQuery.data]);

  return {
    selectedFile,
    selectedFileMetadata,
    fileContents: fileContentsQuery.data ?? null,
    isLoading: fileContentsQuery.isLoading,
    isError: fileContentsQuery.isError,
    error: fileContentsQuery.error ?? null,
  };
}
