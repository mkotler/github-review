/**
 * Tests for helper utilities.
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
  generateHeadingId,
  convertLocalComment,
  convertLocalComments,
  createLocalReview,
} from "../utils/helpers";
import type { PullRequestFile, LocalComment } from "../types";

describe("helper utilities", () => {
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

  describe("generateHeadingId", () => {
    it("converts text to lowercase", () => {
      expect(generateHeadingId("Hello World")).toBe("hello-world");
      expect(generateHeadingId("UPPERCASE")).toBe("uppercase");
    });

    it("replaces spaces with hyphens", () => {
      expect(generateHeadingId("hello world")).toBe("hello-world");
      expect(generateHeadingId("multiple   spaces")).toBe("multiple-spaces");
    });

    it("removes special characters", () => {
      expect(generateHeadingId("hello!world")).toBe("helloworld");
      expect(generateHeadingId("test@example#com")).toBe("testexamplecom");
    });

    it("handles en-dash and em-dash", () => {
      expect(generateHeadingId("hello–world")).toBe("hello-world");
      expect(generateHeadingId("hello—world")).toBe("hello-world");
    });

    it("collapses multiple consecutive hyphens to double hyphen", () => {
      expect(generateHeadingId("hello---world")).toBe("hello--world");
      expect(generateHeadingId("test----case")).toBe("test--case");
    });

    it("preserves existing hyphens and underscores", () => {
      expect(generateHeadingId("hello-world")).toBe("hello-world");
      expect(generateHeadingId("hello_world")).toBe("hello_world");
    });
  });

  describe("convertLocalComment", () => {
    const createLocalComment = (overrides: Partial<LocalComment> = {}): LocalComment => ({
      id: 1,
      owner: "testowner",
      repo: "testrepo",
      pr_number: 123,
      file_path: "src/test.ts",
      line_number: 42,
      side: "RIGHT" as const,
      body: "Test comment",
      commit_id: "abc123",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      in_reply_to_id: null,
      ...overrides,
    });

    const defaultOptions = {
      author: "testuser",
      reviewId: 999,
      isDraft: true,
    };

    it("converts basic local comment properties", () => {
      const localComment = createLocalComment();
      const result = convertLocalComment(localComment, defaultOptions);

      expect(result.id).toBe(1);
      expect(result.body).toBe("Test comment");
      expect(result.author).toBe("testuser");
      expect(result.path).toBe("src/test.ts");
      expect(result.line).toBe(42);
      expect(result.side).toBe("RIGHT");
      expect(result.is_review_comment).toBe(true);
      expect(result.is_mine).toBe(true);
      expect(result.review_id).toBe(999);
    });

    it("converts line_number 0 to null", () => {
      const localComment = createLocalComment({ line_number: 0 });
      const result = convertLocalComment(localComment, defaultOptions);

      expect(result.line).toBeNull();
    });

    it("preserves null line_number", () => {
      const localComment = createLocalComment({ line_number: null });
      const result = convertLocalComment(localComment, defaultOptions);

      expect(result.line).toBeNull();
    });

    it("uses isDraft option correctly", () => {
      const localComment = createLocalComment();
      
      const draftResult = convertLocalComment(localComment, { ...defaultOptions, isDraft: true });
      expect(draftResult.is_draft).toBe(true);

      const nonDraftResult = convertLocalComment(localComment, { ...defaultOptions, isDraft: false });
      expect(nonDraftResult.is_draft).toBe(false);
    });

    it("preserves in_reply_to_id", () => {
      const localComment = createLocalComment({ in_reply_to_id: 456 });
      const result = convertLocalComment(localComment, defaultOptions);

      expect(result.in_reply_to_id).toBe(456);
    });

    it("sets url to placeholder", () => {
      const localComment = createLocalComment();
      const result = convertLocalComment(localComment, defaultOptions);

      expect(result.url).toBe("#");
    });

    it("sets state to null", () => {
      const localComment = createLocalComment();
      const result = convertLocalComment(localComment, defaultOptions);

      expect(result.state).toBeNull();
    });
  });

  describe("convertLocalComments", () => {
    const createLocalComment = (id: number): LocalComment => ({
      id,
      owner: "testowner",
      repo: "testrepo",
      pr_number: 123,
      file_path: `src/file${id}.ts`,
      line_number: id * 10,
      side: "RIGHT" as const,
      body: `Comment ${id}`,
      commit_id: "abc123",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      in_reply_to_id: null,
    });

    it("converts empty array", () => {
      const result = convertLocalComments([], {
        author: "testuser",
        reviewId: 999,
        isDraft: true,
      });

      expect(result).toEqual([]);
    });

    it("converts multiple comments", () => {
      const localComments = [createLocalComment(1), createLocalComment(2), createLocalComment(3)];
      const result = convertLocalComments(localComments, {
        author: "testuser",
        reviewId: 999,
        isDraft: true,
      });

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[2].id).toBe(3);
      expect(result[0].path).toBe("src/file1.ts");
      expect(result[1].path).toBe("src/file2.ts");
      expect(result[2].path).toBe("src/file3.ts");
    });

    it("applies same options to all comments", () => {
      const localComments = [createLocalComment(1), createLocalComment(2)];
      const result = convertLocalComments(localComments, {
        author: "sharedauthor",
        reviewId: 555,
        isDraft: false,
      });

      expect(result[0].author).toBe("sharedauthor");
      expect(result[1].author).toBe("sharedauthor");
      expect(result[0].review_id).toBe(555);
      expect(result[1].review_id).toBe(555);
      expect(result[0].is_draft).toBe(false);
      expect(result[1].is_draft).toBe(false);
    });
  });

  describe("createLocalReview", () => {
    it("creates a review with correct properties", () => {
      const result = createLocalReview({
        prNumber: 123,
        author: "testuser",
        commitId: "abc123def456",
      });

      expect(result.id).toBe(123);
      expect(result.state).toBe("PENDING");
      expect(result.author).toBe("testuser");
      expect(result.commit_id).toBe("abc123def456");
      expect(result.is_mine).toBe(true);
    });

    it("sets null values for optional properties", () => {
      const result = createLocalReview({
        prNumber: 456,
        author: "anotheruser",
        commitId: "xyz789",
      });

      expect(result.submitted_at).toBeNull();
      expect(result.body).toBeNull();
      expect(result.html_url).toBeNull();
    });

    it("uses prNumber as review id", () => {
      const result = createLocalReview({
        prNumber: 999,
        author: "user",
        commitId: "commit",
      });

      expect(result.id).toBe(999);
    });
  });
});
