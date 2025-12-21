/**
 * Helper utilities for the GitHub Review application.
 * Includes file formatting, path handling, comment conversion, and review helpers.
 * Extracted from App.tsx for better modularity and testability.
 */

import type { PullRequestFile, LocalComment, PullRequestComment, PullRequestReview } from "../types";

/**
 * Parses the [Line #] prefix from file-level comments.
 * This prefix is added when converting line-level comments to file-level format.
 */
export function parseLinePrefix(body: string): {
  hasLinePrefix: boolean;
  lineNumber: number | null;
  remainingBody: string;
} {
  const match = body.match(/^\[Line (\d+)\]\s*/);
  if (match) {
    return {
      hasLinePrefix: true,
      lineNumber: parseInt(match[1], 10),
      remainingBody: body.slice(match[0].length),
    };
  }
  return {
    hasLinePrefix: false,
    lineNumber: null,
    remainingBody: body,
  };
}

/**
 * Formats a file path for display, extracting folder/filename.
 * Optionally uses display names from toc.yml.
 */
export function formatFileLabel(
  path: string,
  tocNameMap?: Map<string, string>
): string {
  // Check if path contains toc.yml
  if (path.toLowerCase().includes("toc.yml")) {
    return "Table of Contents";
  }

  // Check if we have a display name from toc.yml
  const tocName = tocNameMap?.get(path);
  if (tocName) {
    return tocName;
  }

  // Fallback to default formatting (folder/filename)
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const folder = segments[segments.length - 2];
    const fileName = segments[segments.length - 1];
    return `${folder}/${fileName}`;
  }
  return path;
}

/**
 * Formats a file path with tooltip including status.
 */
export function formatFileTooltip(file: PullRequestFile): string {
  const status = file.status ? file.status.toUpperCase() : "";
  return status ? `${file.path} - ${status}` : file.path;
}

/**
 * Formats a file path with leading ellipsis if it exceeds maxLength.
 */
export function formatFilePathWithLeadingEllipsis(
  path: string,
  maxLength: number = 200
): string {
  if (path.length <= maxLength) {
    return path;
  }
  return `...${path.slice(-(maxLength - 3))}`;
}

/**
 * Checks if a file is an image based on its language property.
 */
export function isImageFile(file: PullRequestFile | null | undefined): boolean {
  return file?.language === "image";
}

/**
 * Checks if a file is a markdown file based on language or extension.
 */
export function isMarkdownFile(file: PullRequestFile | null | undefined): boolean {
  if (!file) return false;
  if (file.language === "markdown") return true;
  const path = (file.path ?? "").toLowerCase();
  return path.endsWith(".md") || path.endsWith(".markdown") || path.endsWith(".mdx");
}

/**
 * Gets the MIME type for an image based on its file extension.
 */
export function getImageMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return mimeTypes[ext || ""] || "image/png";
}

/**
 * Resolves a relative path based on a base file path.
 * Handles ./, ../, and absolute paths.
 */
export function resolveRelativePath(
  href: string,
  currentFilePath: string
): string {
  // Remove anchor/hash from path
  let resolvedPath = href;
  const hashIndex = resolvedPath.indexOf("#");
  if (hashIndex !== -1) {
    resolvedPath = resolvedPath.substring(0, hashIndex);
  }

  // Decode URL-encoded characters (e.g., %20 for spaces)
  try {
    resolvedPath = decodeURIComponent(resolvedPath);
  } catch (e) {
    // If decoding fails, use the original path
    console.warn("Failed to decode URL path:", resolvedPath, e);
  }

  if (
    resolvedPath.startsWith("./") ||
    resolvedPath.startsWith("../") ||
    !resolvedPath.startsWith("/")
  ) {
    // Relative path - resolve based on current file location
    const fileDir = currentFilePath.substring(
      0,
      currentFilePath.lastIndexOf("/")
    );
    const parts = fileDir.split("/").filter(Boolean);

    const pathParts = resolvedPath.split("/");
    for (const part of pathParts) {
      if (part === "..") {
        parts.pop();
      } else if (part !== "." && part !== "") {
        parts.push(part);
      }
    }

    return parts.join("/");
  } else {
    // Absolute path - remove leading slash
    return resolvedPath.substring(1);
  }
}

/**
 * Extracts the anchor ID from a URL or href.
 */
export function extractAnchorId(href: string): string | null {
  const hashIndex = href.indexOf("#");
  if (hashIndex !== -1) {
    return href.substring(hashIndex + 1);
  }
  return null;
}

/**
 * Generates a slug ID from heading text for anchor links.
 * Handles special characters, dashes, and normalizes whitespace.
 */
export function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[–—]/g, '-')      // Replace en-dash and em-dash with hyphen
    .replace(/[^\w\s-]/g, '')    // Remove non-word characters except whitespace and hyphens
    .replace(/\s+/g, '-')        // Replace whitespace with hyphens
    .replace(/-{3,}/g, '--');    // Collapse 3+ consecutive hyphens to double hyphen
}

/**
 * Converts a LocalComment (from Tauri backend) to a PullRequestComment.
 * Used for displaying local review comments in the UI.
 */
export function convertLocalComment(
  lc: LocalComment,
  options: {
    author: string;
    reviewId: number;
    isDraft: boolean;
  }
): PullRequestComment {
  return {
    id: lc.id,
    body: lc.body,
    author: options.author,
    created_at: lc.created_at,
    url: "#", // Local comments don't have URLs yet
    path: lc.file_path,
    line: lc.line_number === 0 ? null : lc.line_number,
    side: lc.side,
    is_review_comment: true,
    is_draft: options.isDraft,
    state: null,
    is_mine: true,
    review_id: options.reviewId,
    in_reply_to_id: lc.in_reply_to_id,
  };
}

/**
 * Converts an array of LocalComment objects to PullRequestComment objects.
 */
export function convertLocalComments(
  localComments: LocalComment[],
  options: {
    author: string;
    reviewId: number;
    isDraft: boolean;
  }
): PullRequestComment[] {
  return localComments.map((lc) => convertLocalComment(lc, options));
}

/**
 * Creates a local pending review object for a PR.
 * Used when starting a new local review or loading existing local comments.
 */
export function createLocalReview(options: {
  prNumber: number;
  author: string;
  commitId: string;
}): PullRequestReview {
  return {
    id: options.prNumber,
    state: "PENDING",
    author: options.author,
    submitted_at: null,
    body: null,
    html_url: null,
    commit_id: options.commitId,
    is_mine: true,
  };
}
