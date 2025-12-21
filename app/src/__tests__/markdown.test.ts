/**
 * Tests for markdown utilities.
 */

import { describe, it, expect } from "vitest";
import {
  parseLinePrefix,
  formatFileLabel,
  formatFileTooltip,
  formatFilePathWithLeadingEllipsis,
  isImageFile,
  isMarkdownFile,
  getImageMimeType,
  resolveRelativePath,
  extractAnchorId,
} from "../utils/markdown";
import type { PullRequestFile } from "../types";

describe("markdown utilities", () => {
  describe("parseLinePrefix", () => {
    it("extracts line number from [Line #] prefix", () => {
      const result = parseLinePrefix("[Line 42] This is a comment");
      expect(result.hasLinePrefix).toBe(true);
      expect(result.lineNumber).toBe(42);
      expect(result.remainingBody).toBe("This is a comment");
    });

    it("handles [Line #] with no space after", () => {
      const result = parseLinePrefix("[Line 100]Comment text");
      expect(result.hasLinePrefix).toBe(true);
      expect(result.lineNumber).toBe(100);
      expect(result.remainingBody).toBe("Comment text");
    });

    it("returns original body when no prefix", () => {
      const result = parseLinePrefix("Just a regular comment");
      expect(result.hasLinePrefix).toBe(false);
      expect(result.lineNumber).toBeNull();
      expect(result.remainingBody).toBe("Just a regular comment");
    });

    it("handles empty string", () => {
      const result = parseLinePrefix("");
      expect(result.hasLinePrefix).toBe(false);
      expect(result.lineNumber).toBeNull();
      expect(result.remainingBody).toBe("");
    });

    it("does not match Line prefix without brackets", () => {
      const result = parseLinePrefix("Line 42 is important");
      expect(result.hasLinePrefix).toBe(false);
      expect(result.remainingBody).toBe("Line 42 is important");
    });

    it("does not match [Line #] in middle of text", () => {
      const result = parseLinePrefix("See [Line 42] for details");
      expect(result.hasLinePrefix).toBe(false);
      expect(result.remainingBody).toBe("See [Line 42] for details");
    });
  });

  describe("formatFileLabel", () => {
    it("returns Table of Contents for toc.yml files", () => {
      expect(formatFileLabel("docs/toc.yml")).toBe("Table of Contents");
      expect(formatFileLabel("folder/TOC.YML")).toBe("Table of Contents");
    });

    it("uses tocNameMap when available", () => {
      const tocMap = new Map([
        ["docs/intro.md", "Introduction"],
        ["docs/getting-started.md", "Getting Started"],
      ]);
      expect(formatFileLabel("docs/intro.md", tocMap)).toBe("Introduction");
    });

    it("formats as folder/filename for paths with at least 2 segments", () => {
      expect(formatFileLabel("docs/guides/tutorial.md")).toBe("guides/tutorial.md");
      expect(formatFileLabel("src/components/App.tsx")).toBe("components/App.tsx");
    });

    it("returns path as-is for single segment", () => {
      expect(formatFileLabel("README.md")).toBe("README.md");
    });

    it("handles root-level files", () => {
      expect(formatFileLabel("file.md")).toBe("file.md");
    });
  });

  describe("formatFileTooltip", () => {
    it("includes status when present", () => {
      const file: PullRequestFile = {
        path: "docs/file.md",
        status: "modified",
        additions: 10,
        deletions: 5,
        language: "markdown",
      };
      expect(formatFileTooltip(file)).toBe("docs/file.md - MODIFIED");
    });

    it("returns just path when no status", () => {
      const file: PullRequestFile = {
        path: "docs/file.md",
        status: "",
        additions: 0,
        deletions: 0,
        language: "markdown",
      };
      expect(formatFileTooltip(file)).toBe("docs/file.md");
    });
  });

  describe("formatFilePathWithLeadingEllipsis", () => {
    it("returns path as-is when under maxLength", () => {
      expect(formatFilePathWithLeadingEllipsis("short/path.md", 50)).toBe("short/path.md");
    });

    it("truncates with leading ellipsis when over maxLength", () => {
      const longPath = "very/long/path/to/deeply/nested/file/structure/document.md";
      const result = formatFilePathWithLeadingEllipsis(longPath, 30);
      expect(result.startsWith("...")).toBe(true);
      expect(result.length).toBe(30);
    });

    it("uses default maxLength of 200", () => {
      const shortPath = "docs/file.md";
      expect(formatFilePathWithLeadingEllipsis(shortPath)).toBe(shortPath);
    });
  });

  describe("isImageFile", () => {
    it("returns true for image language", () => {
      const file: PullRequestFile = {
        path: "image.png",
        status: "added",
        additions: 0,
        deletions: 0,
        language: "image",
      };
      expect(isImageFile(file)).toBe(true);
    });

    it("returns false for non-image language", () => {
      const file: PullRequestFile = {
        path: "file.md",
        status: "added",
        additions: 0,
        deletions: 0,
        language: "markdown",
      };
      expect(isImageFile(file)).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isImageFile(null)).toBe(false);
      expect(isImageFile(undefined)).toBe(false);
    });
  });

  describe("isMarkdownFile", () => {
    it("returns true for markdown language", () => {
      const file: PullRequestFile = {
        path: "file.txt",
        status: "added",
        additions: 0,
        deletions: 0,
        language: "markdown",
      };
      expect(isMarkdownFile(file)).toBe(true);
    });

    it("returns true for .md extension", () => {
      const file: PullRequestFile = {
        path: "file.md",
        status: "added",
        additions: 0,
        deletions: 0,
        language: "unknown",
      };
      expect(isMarkdownFile(file)).toBe(true);
    });

    it("returns true for .markdown extension", () => {
      const file: PullRequestFile = {
        path: "file.markdown",
        status: "added",
        additions: 0,
        deletions: 0,
        language: "unknown",
      };
      expect(isMarkdownFile(file)).toBe(true);
    });

    it("returns true for .mdx extension", () => {
      const file: PullRequestFile = {
        path: "file.mdx",
        status: "added",
        additions: 0,
        deletions: 0,
        language: "unknown",
      };
      expect(isMarkdownFile(file)).toBe(true);
    });

    it("returns false for non-markdown files", () => {
      const file: PullRequestFile = {
        path: "file.tsx",
        status: "added",
        additions: 0,
        deletions: 0,
        language: "typescript",
      };
      expect(isMarkdownFile(file)).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isMarkdownFile(null)).toBe(false);
      expect(isMarkdownFile(undefined)).toBe(false);
    });
  });

  describe("getImageMimeType", () => {
    it("returns correct MIME type for known extensions", () => {
      expect(getImageMimeType("image.png")).toBe("image/png");
      expect(getImageMimeType("photo.jpg")).toBe("image/jpeg");
      expect(getImageMimeType("photo.jpeg")).toBe("image/jpeg");
      expect(getImageMimeType("animation.gif")).toBe("image/gif");
      expect(getImageMimeType("icon.svg")).toBe("image/svg+xml");
      expect(getImageMimeType("modern.webp")).toBe("image/webp");
    });

    it("defaults to image/png for unknown extensions", () => {
      expect(getImageMimeType("image.unknown")).toBe("image/png");
      expect(getImageMimeType("noextension")).toBe("image/png");
    });

    it("handles case-insensitive extensions", () => {
      expect(getImageMimeType("IMAGE.PNG")).toBe("image/png");
      expect(getImageMimeType("photo.JPG")).toBe("image/jpeg");
    });
  });

  describe("resolveRelativePath", () => {
    it("resolves ./ paths", () => {
      expect(resolveRelativePath("./sibling.md", "docs/current.md")).toBe("docs/sibling.md");
    });

    it("resolves ../ paths", () => {
      expect(resolveRelativePath("../parent.md", "docs/nested/current.md")).toBe("docs/parent.md");
    });

    it("resolves multiple ../ paths", () => {
      expect(resolveRelativePath("../../root.md", "docs/deep/nested/current.md")).toBe("docs/root.md");
    });

    it("resolves paths without prefix", () => {
      expect(resolveRelativePath("relative.md", "docs/current.md")).toBe("docs/relative.md");
    });

    it("handles absolute paths", () => {
      expect(resolveRelativePath("/absolute/path.md", "docs/current.md")).toBe("absolute/path.md");
    });

    it("removes anchor from path", () => {
      expect(resolveRelativePath("./file.md#section", "docs/current.md")).toBe("docs/file.md");
    });

    it("handles URL-encoded characters", () => {
      expect(resolveRelativePath("./my%20file.md", "docs/current.md")).toBe("docs/my file.md");
    });

    it("handles nested folder navigation", () => {
      expect(resolveRelativePath("subfolder/file.md", "docs/current.md")).toBe("docs/subfolder/file.md");
    });
  });

  describe("extractAnchorId", () => {
    it("extracts anchor from URL", () => {
      expect(extractAnchorId("file.md#section")).toBe("section");
      expect(extractAnchorId("#anchor-only")).toBe("anchor-only");
    });

    it("returns null when no anchor", () => {
      expect(extractAnchorId("file.md")).toBeNull();
      expect(extractAnchorId("https://example.com/path")).toBeNull();
    });

    it("handles anchors with special characters", () => {
      expect(extractAnchorId("file.md#section-name")).toBe("section-name");
      expect(extractAnchorId("file.md#section_name")).toBe("section_name");
    });
  });
});
