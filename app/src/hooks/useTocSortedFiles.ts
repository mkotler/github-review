/**
 * Hook for sorting and filtering PR files based on toc.yml ordering.
 * 
 * This hook handles:
 * - Finding toc.yml files in the PR
 * - Loading toc.yml content (with offline cache support)
 * - Building a map of file paths to display names from toc.yml
 * - Sorting files according to toc.yml order
 * - Filtering files by type and viewed status
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { parse as parseYaml } from "yaml";
import * as offlineCache from "../offlineCache";
import type { PullRequestFile, PullRequestDetail, RepoRef } from "../types";

export interface UseTocSortedFilesOptions {
  files: PullRequestFile[];
  repoRef: RepoRef | null;
  prDetail: PullRequestDetail | null;
  selectedPr: number | null;
  isLocalDirectoryMode: boolean;
  isOnline: boolean;
  markOnline: () => void;
  markOffline: () => void;
  showAllFileTypes: boolean;
  hideReviewedFiles: boolean;
  isFileViewed: (path: string) => boolean;
}

export interface UseTocSortedFilesResult {
  /** Files sorted according to toc.yml order */
  sortedFiles: PullRequestFile[];
  /** Files after applying type and viewed filters */
  filteredSortedFiles: PullRequestFile[];
  /** Map of file paths to display names from toc.yml */
  tocFileNameMap: Map<string, string>;
  /** Whether toc content is loading */
  isLoadingTocContent: boolean;
}

/**
 * Resolves a relative href path based on a base path's segments.
 */
function resolveHref(href: string, baseSegments: string[]): string {
  const sanitized = href.split("#")[0].split("?")[0];
  const segments = sanitized.split("/");
  const resolved = [...baseSegments];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

/**
 * Gets the directory depth of a path.
 */
function getPathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

export function useTocSortedFiles(options: UseTocSortedFilesOptions): UseTocSortedFilesResult {
  const {
    files,
    repoRef,
    prDetail,
    selectedPr,
    isLocalDirectoryMode,
    isOnline,
    markOnline,
    markOffline,
    showAllFileTypes,
    hideReviewedFiles,
    isFileViewed,
  } = options;

  // Find all toc.yml files if they exist
  const tocFilesMetadata = useMemo(() => {
    return files.filter((file) => file.path.toLowerCase().endsWith("toc.yml"));
  }, [files]);

  // Load all toc.yml content
  const tocContentsQuery = useQuery({
    queryKey: [
      "toc-contents",
      repoRef?.owner,
      repoRef?.repo,
      tocFilesMetadata.map((f) => f.path).join(","),
      prDetail?.base_sha,
      prDetail?.head_sha,
    ],
    queryFn: async () => {
      if (tocFilesMetadata.length === 0 || !prDetail || !repoRef) {
        return new Map<string, string>();
      }

      // In local directory mode, TOC contents are already embedded in `head_content`.
      if (isLocalDirectoryMode) {
        const contentMap = new Map<string, string>();
        for (const tocFile of tocFilesMetadata) {
          const content = tocFile.head_content ?? "";
          if (content) {
            contentMap.set(tocFile.path, content);
          }
        }
        return contentMap;
      }

      if (!selectedPr) return new Map<string, string>();

      const contentMap = new Map<string, string>();

      for (const tocFile of tocFilesMetadata) {
        try {
          const [headContent, baseContent] = await invoke<[string | null, string | null]>(
            "cmd_get_file_contents",
            {
              owner: repoRef.owner,
              repo: repoRef.repo,
              filePath: tocFile.path,
              baseSha: prDetail.base_sha,
              headSha: prDetail.head_sha,
              status: tocFile.status,
            }
          );

          markOnline();
          await offlineCache.cacheFileContent(
            repoRef.owner,
            repoRef.repo,
            selectedPr,
            tocFile.path,
            prDetail.head_sha,
            prDetail.base_sha,
            headContent,
            baseContent
          );

          const content = headContent ?? baseContent ?? "";
          if (content) {
            contentMap.set(tocFile.path, content);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const isNetworkError =
            errorMsg.includes("http error") ||
            errorMsg.includes("error sending request") ||
            errorMsg.includes("fetch") ||
            errorMsg.includes("network") ||
            errorMsg.includes("Failed to invoke") ||
            errorMsg.includes("connection") ||
            errorMsg.includes("timeout");

          if (isNetworkError) {
            console.log("🌐 Network error detected for toc.yml:", errorMsg);
            markOffline();

            const cached = await offlineCache.getCachedFileContent(
              repoRef.owner,
              repoRef.repo,
              selectedPr,
              tocFile.path,
              prDetail.head_sha,
              prDetail.base_sha
            );
            if (cached) {
              console.log(`📦 Loaded ${tocFile.path} from offline cache`);
              const content = cached.headContent ?? cached.baseContent ?? "";
              if (content) {
                contentMap.set(tocFile.path, content);
              }
            }
          }
        }
      }

      return contentMap;
    },
    enabled: Boolean(tocFilesMetadata.length > 0 && prDetail && repoRef),
    staleTime: Infinity,
    retry: (failureCount, error) => {
      if (!isOnline && error instanceof Error && error.message.includes("No cached data available")) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Build a map of file paths to display names from all toc.yml files
  const tocFileNameMap = useMemo(() => {
    const map = new Map<string, string>();

    if (!tocContentsQuery.data || tocContentsQuery.data.size === 0) {
      return map;
    }

    for (const [tocPath, content] of tocContentsQuery.data.entries()) {
      if (!content.trim()) {
        continue;
      }

      const baseSegments = tocPath.split("/").slice(0, -1);

      const collectFileNames = (node: unknown) => {
        if (Array.isArray(node)) {
          for (const item of node) {
            collectFileNames(item);
          }
          return;
        }

        if (!node || typeof node !== "object") {
          return;
        }

        const entry = node as Record<string, unknown>;
        const href = entry.href;
        const name = entry.name;

        if (typeof href === "string" && typeof name === "string") {
          const resolvedPath = resolveHref(href, baseSegments);
          map.set(resolvedPath, name);
        }

        if (entry.items) {
          collectFileNames(entry.items);
        }
      };

      try {
        const cleanContent = content.replace(/^\uFEFF/, "");
        const parsed = parseYaml(cleanContent);
        collectFileNames(parsed);
      } catch (error) {
        console.warn(`Failed to parse ${tocPath} for file names`, error);
      }
    }

    return map;
  }, [tocContentsQuery.data]);

  // Sort files according to toc.yml order
  const sortedFiles = useMemo(() => {
    if (files.length === 0) {
      return [] as PullRequestFile[];
    }

    const originalOrder = [...files];

    // Build a map of directory -> toc file for that directory
    const tocByDirectory = new Map<string, PullRequestFile>();
    for (const tocFile of tocFilesMetadata) {
      const dir = tocFile.path.split("/").slice(0, -1).join("/");
      tocByDirectory.set(dir, tocFile);
    }

    // Build a map of directory -> ordered file paths from that toc
    const orderedPathsByToc = new Map<string, string[]>();

    if (tocContentsQuery.data) {
      for (const [tocPath, content] of tocContentsQuery.data.entries()) {
        if (!content.trim()) {
          continue;
        }

        const baseSegments = tocPath.split("/").slice(0, -1);
        const dir = baseSegments.join("/");
        const orderedPaths: string[] = [];

        const collectMarkdownPaths = (node: unknown) => {
          if (Array.isArray(node)) {
            for (const item of node) {
              collectMarkdownPaths(item);
            }
            return;
          }

          if (!node || typeof node !== "object") {
            return;
          }

          const entry = node as Record<string, unknown>;
          const href = entry.href;
          if (typeof href === "string") {
            const resolvedPath = resolveHref(href, baseSegments);
            if (resolvedPath.toLowerCase().endsWith(".md")) {
              orderedPaths.push(resolvedPath);
            }
          }

          if (entry.items) {
            collectMarkdownPaths(entry.items);
          }
        };

        try {
          const cleanContent = content.replace(/^\uFEFF/, "");
          const parsed = parseYaml(cleanContent);
          collectMarkdownPaths(parsed);
          orderedPathsByToc.set(dir, orderedPaths);
        } catch (error) {
          console.warn(`Failed to parse ${tocPath}`, error);
        }
      }
    }

    // Helper to get the governing toc directory for a file
    const getGoverningTocDir = (filePath: string): string | null => {
      const fileDir = filePath.split("/").slice(0, -1).join("/");

      // Check if this directory has a toc
      if (tocByDirectory.has(fileDir)) {
        return fileDir;
      }

      // Check parent directories
      let currentDir = fileDir;
      while (currentDir.includes("/")) {
        const parentDir = currentDir.split("/").slice(0, -1).join("/");
        if (tocByDirectory.has(parentDir)) {
          return parentDir;
        }
        currentDir = parentDir;
      }

      // Check root directory
      if (tocByDirectory.has("")) {
        return "";
      }

      return null;
    };

    const seen = new Set<string>();
    const ordered: PullRequestFile[] = [];

    // Group files by their governing toc directory
    const filesByTocDir = new Map<string | null, PullRequestFile[]>();

    for (const file of originalOrder) {
      const tocDir = getGoverningTocDir(file.path);
      if (!filesByTocDir.has(tocDir)) {
        filesByTocDir.set(tocDir, []);
      }
      filesByTocDir.get(tocDir)!.push(file);
    }

    // Sort toc directories by depth and then alphabetically
    const sortedTocDirs = Array.from(tocByDirectory.keys()).sort((a, b) => {
      const depthA = getPathDepth(a);
      const depthB = getPathDepth(b);
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      return a.localeCompare(b);
    });

    // Process each toc directory in order
    for (const tocDir of sortedTocDirs) {
      const tocFile = tocByDirectory.get(tocDir);
      if (tocFile && !seen.has(tocFile.path)) {
        ordered.push(tocFile);
        seen.add(tocFile.path);
      }

      // Add files governed by this toc in the order specified
      const filesInThisDir = filesByTocDir.get(tocDir) || [];
      const orderedPaths = orderedPathsByToc.get(tocDir) || [];

      // First add files in toc order
      for (const path of orderedPaths) {
        let matchingFile = filesInThisDir.find((file) => file.path === path);

        // Try suffix matching if exact match not found
        if (!matchingFile) {
          matchingFile = filesInThisDir.find(
            (file) => file.path.endsWith(path) || path.endsWith(file.path)
          );
        }

        if (matchingFile && !seen.has(matchingFile.path)) {
          ordered.push(matchingFile);
          seen.add(matchingFile.path);
        }
      }

      // Then add any remaining files from this directory (not in toc)
      for (const file of filesInThisDir) {
        if (!seen.has(file.path)) {
          ordered.push(file);
          seen.add(file.path);
        }
      }
    }

    // Finally add any files not governed by any toc
    const ungoverned = filesByTocDir.get(null) || [];
    for (const file of ungoverned) {
      if (!seen.has(file.path)) {
        ordered.push(file);
        seen.add(file.path);
      }
    }

    return ordered;
  }, [files, tocFilesMetadata, tocContentsQuery.data]);

  // Apply file type filtering
  const filteredSortedFiles = useMemo(() => {
    let filtered = sortedFiles;

    // Filter by file type
    if (!showAllFileTypes) {
      filtered = filtered.filter((f) => f.language === "markdown" || f.language === "yaml");
    }

    // Filter out reviewed files if option is enabled
    if (hideReviewedFiles) {
      filtered = filtered.filter((f) => !isFileViewed(f.path));
    }

    return filtered;
  }, [sortedFiles, showAllFileTypes, hideReviewedFiles, isFileViewed]);

  return {
    sortedFiles,
    filteredSortedFiles,
    tocFileNameMap,
    isLoadingTocContent: tocContentsQuery.isLoading,
  };
}
