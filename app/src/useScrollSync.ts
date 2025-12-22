import { useCallback, useRef } from "react";
import * as monaco from "monaco-editor";

interface UseScrollSyncProps {
  sourceContent: string | null;
  previewRef: React.RefObject<HTMLElement | null>;
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null;
  isEnabled: boolean;
  zoomLevel: number;
}

interface ScrollAnchor {
  sourceLine: number;
  type: "header" | "hr" | "codeblock" | "table" | "image" | "blockquote";
  identifier: string;
}

type ParsedSource = {
  anchors: ScrollAnchor[];
  // prefixHiddenLines[i] = number of hidden (non-rendering) lines in 1..i
  prefixHiddenLines: number[];
};

const SCROLL_ANIMATION_DURATION = 50;
const SCROLL_END_DEBOUNCE_MS = 120;
const SOURCE_END_SYNC_SUPPRESS_MS = SCROLL_END_DEBOUNCE_MS + SCROLL_ANIMATION_DURATION + 30;

function slugifyHeadingText(text: string): string {
  // Keep consistent with heading id generation in `App.tsx`.
  return text
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{3,}/g, "--")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * Parse markdown source to find anchor points (headers, HRs, code blocks, etc.)
 */
function parseSourceAnchors(content: string): ParsedSource {
  const anchors: ScrollAnchor[] = [];
  const lines = content.split("\n");

  const hiddenLine = new Array<boolean>(lines.length).fill(false);

  let inCodeBlock = false;
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  let codeBlockStart = 0;
  let codeBlockCount = 0;
  let tableCount = 0;
  let imageCount = 0;
  let blockquoteCount = 0;
  let hrCount = 0;
  const headerCounts = new Map<string, number>();

  let inFrontmatter = false;
  let frontmatterDelimLine: number | null = null;

  let inHtmlComment = false;
  let htmlCommentStartLine: number | null = null;

  const markHiddenRange = (startLine: number, endLine: number) => {
    const start = Math.max(1, startLine);
    const end = Math.min(lines.length, endLine);
    for (let ln = start; ln <= end; ln++) {
      hiddenLine[ln - 1] = true;
    }
  };

  const getFence = (trimmed: string): { char: "`" | "~"; len: number } | null => {
    const m = trimmed.match(/^([`~])\1\1+\s*.*$/);
    if (!m) return null;
    const char = m[1] as "`" | "~";
    // count leading fence chars
    let len = 0;
    while (len < trimmed.length && trimmed[len] === char) len++;
    if (len < 3) return null;
    return { char, len };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // YAML frontmatter (--- ... --- or --- ... ...)
    if (lineNum === 1 && trimmed === "---") {
      inFrontmatter = true;
      frontmatterDelimLine = lineNum;
      continue;
    }
    if (inFrontmatter) {
      if ((trimmed === "---" && lineNum !== frontmatterDelimLine) || trimmed === "...") {
        inFrontmatter = false;
        frontmatterDelimLine = null;
      }
      continue;
    }

    // HTML comments (invisible in preview): <!-- ... --> (can be multi-line)
    // Treat *comment-only* blocks as hidden so source scrolling through commented-out sections
    // doesn't advance preview, but don't hide lines that contain visible markdown plus an inline comment.
    if (!inCodeBlock) {
      if (!inHtmlComment) {
        if (trimmed.startsWith("<!--")) {
          const endIdx = trimmed.indexOf("-->", 4);
          if (endIdx !== -1) {
            // single-line comment-only
            hiddenLine[i] = true;
          } else {
            inHtmlComment = true;
            htmlCommentStartLine = lineNum;
            hiddenLine[i] = true;
          }
          continue;
        }
      } else {
        hiddenLine[i] = true;
        if (trimmed.includes("-->")) {
          inHtmlComment = false;
          if (htmlCommentStartLine !== null) {
            markHiddenRange(htmlCommentStartLine, lineNum);
          }
          htmlCommentStartLine = null;
        }
        continue;
      }
    }

    // Track fenced code blocks (``` or ~~~). Must close with matching char + length.
    const fence = getFence(trimmed);
    if (fence) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        fenceChar = fence.char;
        fenceLen = fence.len;
        codeBlockStart = lineNum;
      } else {
        // close only when fence matches opener
        if (fenceChar === fence.char && fence.len >= fenceLen) {
          inCodeBlock = false;
          fenceChar = null;
          fenceLen = 0;
          anchors.push({
            sourceLine: codeBlockStart,
            type: "codeblock",
            identifier: `codeblock-${codeBlockCount++}`,
          });
        }
      }
      continue;
    }

    if (inCodeBlock) continue;

    // Raw HTML headings: <h1>..</h1> etc (single-line only)
    const htmlHeaderMatch = trimmed.match(/^<h([1-6])\b[^>]*>(.*?)<\/h\1>\s*$/i);
    if (htmlHeaderMatch) {
      const level = parseInt(htmlHeaderMatch[1], 10);
      const text = stripHtmlToText(htmlHeaderMatch[2]);
      const slug = slugifyHeadingText(text);

      const keyBase = `h${level}-${slug}`;
      const seen = headerCounts.get(keyBase) ?? 0;
      headerCounts.set(keyBase, seen + 1);
      const identifier = seen === 0 ? keyBase : `${keyBase}--${seen}`;

      anchors.push({
        sourceLine: lineNum,
        type: "header",
        identifier,
      });
      continue;
    }

    // Raw HTML horizontal rules
    if (/^<hr\b/i.test(trimmed)) {
      anchors.push({
        sourceLine: lineNum,
        type: "hr",
        identifier: `hr-${hrCount++}`,
      });
      continue;
    }

    // Raw HTML tables
    if (/^<table\b/i.test(trimmed)) {
      anchors.push({
        sourceLine: lineNum,
        type: "table",
        identifier: `table-${tableCount++}`,
      });
      continue;
    }

    // Raw HTML images
    if (/^<img\b/i.test(trimmed)) {
      anchors.push({
        sourceLine: lineNum,
        type: "image",
        identifier: `image-${imageCount++}`,
      });
      continue;
    }

    // Headers (ATX style: # Header)
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2].replace(/\s*#+\s*$/, "").trim();
      const slug = slugifyHeadingText(text);

      const keyBase = `h${level}-${slug}`;
      const seen = headerCounts.get(keyBase) ?? 0;
      headerCounts.set(keyBase, seen + 1);
      const identifier = seen === 0 ? keyBase : `${keyBase}--${seen}`;

      anchors.push({ sourceLine: lineNum, type: "header", identifier });
      continue;
    }

    // Horizontal rules: ---, ***, ___
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      anchors.push({
        sourceLine: lineNum,
        type: "hr",
        identifier: `hr-${hrCount++}`,
      });
      continue;
    }

    // Tables (line starting with |)
    if (trimmed.startsWith("|") && !trimmed.match(/^\|[-:| ]+\|$/)) {
      // Check if this is the start of a table (not a separator row)
      const prevLine = i > 0 ? lines[i - 1].trim() : "";
      if (!prevLine.startsWith("|")) {
        anchors.push({
          sourceLine: lineNum,
          type: "table",
          identifier: `table-${tableCount++}`,
        });
      }
      continue;
    }

    // Images (markdown): be liberal so indexing stays consistent with preview.
    // Handles inline images, titles, and reference-style images.
    if (trimmed.match(/!\[[^\]]*\]\([^)]*\)/) || trimmed.match(/!\[[^\]]*\]\[[^\]]+\]/)) {
      anchors.push({
        sourceLine: lineNum,
        type: "image",
        identifier: `image-${imageCount++}`,
      });
      continue;
    }

    // Blockquotes (first line of a blockquote)
    if (trimmed.startsWith(">")) {
      const prevLine = i > 0 ? lines[i - 1].trim() : "";
      if (!prevLine.startsWith(">")) {
        anchors.push({
          sourceLine: lineNum,
          type: "blockquote",
          identifier: `blockquote-${blockquoteCount++}`,
        });
      }
    }
  }

  // Build prefix sum for hidden lines.
  const prefixHiddenLines = new Array<number>(lines.length + 1).fill(0);
  for (let i = 1; i <= lines.length; i++) {
    prefixHiddenLines[i] = prefixHiddenLines[i - 1] + (hiddenLine[i - 1] ? 1 : 0);
  }

  return { anchors, prefixHiddenLines };
}

/**
 * Get preview element positions by querying the DOM in real-time
 */
function getPreviewElementPositions(
  previewElement: HTMLElement
): Map<string, { top: number; height: number }> {
  const positions = new Map<string, { top: number; height: number }>();
  const containerTop = previewElement.scrollTop;

  // Headers
  const headers = previewElement.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const headerCounts = new Map<string, number>();
  headers.forEach((header) => {
    const tag = header.tagName.toLowerCase();
    const text = header.textContent || "";
    const slug = slugifyHeadingText(text);
    const keyBase = `${tag}-${slug}`;
    const seen = headerCounts.get(keyBase) ?? 0;
    headerCounts.set(keyBase, seen + 1);
    const key = seen === 0 ? keyBase : `${keyBase}--${seen}`;
    const rect = header.getBoundingClientRect();
    const previewRect = previewElement.getBoundingClientRect();
    positions.set(key, {
      top: rect.top - previewRect.top + containerTop,
      height: rect.height,
    });
  });

  // Horizontal rules
  const hrs = previewElement.querySelectorAll("hr");
  hrs.forEach((hr, index) => {
    const rect = hr.getBoundingClientRect();
    const previewRect = previewElement.getBoundingClientRect();
    positions.set(`hr-${index}`, {
      top: rect.top - previewRect.top + containerTop,
      height: rect.height || 2,
    });
  });

  // Code blocks
  const codeBlocks = previewElement.querySelectorAll("pre");
  codeBlocks.forEach((block, index) => {
    const rect = block.getBoundingClientRect();
    const previewRect = previewElement.getBoundingClientRect();
    positions.set(`codeblock-${index}`, {
      top: rect.top - previewRect.top + containerTop,
      height: rect.height,
    });
  });

  // Tables
  const tables = previewElement.querySelectorAll("table");
  tables.forEach((table, index) => {
    const rect = table.getBoundingClientRect();
    const previewRect = previewElement.getBoundingClientRect();
    positions.set(`table-${index}`, {
      top: rect.top - previewRect.top + containerTop,
      height: rect.height,
    });
  });

  // Images
  const images = previewElement.querySelectorAll("img");
  images.forEach((img, index) => {
    const rect = img.getBoundingClientRect();
    const previewRect = previewElement.getBoundingClientRect();
    positions.set(`image-${index}`, {
      top: rect.top - previewRect.top + containerTop,
      height: rect.height,
    });
  });

  // Blockquotes
  const blockquotes = previewElement.querySelectorAll("blockquote");
  blockquotes.forEach((bq, index) => {
    const rect = bq.getBoundingClientRect();
    const previewRect = previewElement.getBoundingClientRect();
    positions.set(`blockquote-${index}`, {
      top: rect.top - previewRect.top + containerTop,
      height: rect.height,
    });
  });

  return positions;
}

export function useScrollSync({
  sourceContent,
  previewRef,
  getEditor,
  isEnabled,
}: UseScrollSyncProps) {
  // Two one-way guards to prevent feedback loops without blocking continuous user scrolling.
  // - When we programmatically set the preview scrollTop, ignore preview->source handling briefly.
  // - When we programmatically set the editor scrollTop, ignore source->preview handling briefly.
  const isApplyingPreviewScrollRef = useRef(false);
  const isApplyingEditorScrollRef = useRef(false);
  const anchorsRef = useRef<ScrollAnchor[]>([]);
  const totalSourceLinesRef = useRef(0);
  const prefixHiddenLinesRef = useRef<number[]>([0]);
  const lastPreviewScrollTopRef = useRef<number | null>(null);
  const lastPreviewScrollTopForDebounceRef = useRef<number>(0);
  const sourceScrollEndTimerRef = useRef<number | null>(null);
  const previewScrollEndTimerRef = useRef<number | null>(null);
  const suppressSourceScrollEndSyncUntilRef = useRef<number>(0);

  /**
   * Build matched anchors with STRETCHED editor positions.
   * Used for source-to-preview sync where we need to "slow down" scrolling through images.
   */
  const buildMatchedAnchorsStretched = useCallback(
    (
      editor: monaco.editor.IStandaloneCodeEditor,
      preview: HTMLElement,
      lineHeight: number,
    ): Array<{ editorTop: number; previewTop: number }> => {
      const positions = getPreviewElementPositions(preview);

      const prefixHidden = prefixHiddenLinesRef.current;
      const matchedRaw: Array<{ editorTop: number; previewTop: number; type: ScrollAnchor["type"]; previewHeight: number }> = [];

      for (const anchor of anchorsRef.current) {
        // Code blocks are the most likely to desync (nested fences, custom renderers).
        // Rely on more stable anchors (headings/hr/tables/images/blockquotes) to prevent jumps.
        if (anchor.type === "codeblock") {
          continue;
        }
        const previewPos = positions.get(anchor.identifier);
        if (!previewPos) continue;

        const rawEditorTop = editor.getTopForLineNumber(anchor.sourceLine);
        const hiddenBefore = prefixHidden[Math.max(0, Math.min(prefixHidden.length - 1, anchor.sourceLine - 1))] ?? 0;
        const adjustedForHidden = Math.max(0, rawEditorTop - hiddenBefore * lineHeight);

        // `getTopForLineNumber` can return -1 for invalid lines; clamp to 0.
        matchedRaw.push({
          editorTop: Math.max(0, adjustedForHidden),
          previewTop: previewPos.top,
          type: anchor.type,
          previewHeight: previewPos.height,
        });
      }

      // Ensure monotonic order by editor position.
      matchedRaw.sort((a, b) => a.editorTop - b.editorTop);

      // Weight images: in source they are often 1 line, in preview they can be tall.
      // Stretch the source axis after each image so scrolling doesn't "race past" images.
      let cumulativeImageExtra = 0;
      const matched: Array<{ editorTop: number; previewTop: number }> = [];
      for (const item of matchedRaw) {
        matched.push({
          editorTop: item.editorTop + cumulativeImageExtra,
          previewTop: item.previewTop,
        });

        if (item.type === "image") {
          const extra = Math.max(0, (item.previewHeight || 0) - lineHeight);
          cumulativeImageExtra += extra;
        }
      }

      // Drop any anchors that would make the mapping go backwards.
      // (Can happen with mismatched/duplicated identifiers.)
      const filtered: Array<{ editorTop: number; previewTop: number }> = [];
      let lastPreviewTop = -Infinity;
      for (const item of matched) {
        if (item.previewTop >= lastPreviewTop) {
          filtered.push(item);
          lastPreviewTop = item.previewTop;
        }
      }

      return filtered;
    },
    [],
  );

  /**
   * Build matched anchors with ACTUAL (non-stretched) editor positions.
   * Used for preview-to-source sync where we map preview positions to real editor positions.
   */
  const buildMatchedAnchorsActual = useCallback(
    (
      editor: monaco.editor.IStandaloneCodeEditor,
      preview: HTMLElement,
      lineHeight: number,
    ): Array<{ editorTop: number; previewTop: number }> => {
      const positions = getPreviewElementPositions(preview);

      const prefixHidden = prefixHiddenLinesRef.current;
      const matched: Array<{ editorTop: number; previewTop: number }> = [];

      for (const anchor of anchorsRef.current) {
        if (anchor.type === "codeblock") {
          continue;
        }
        const previewPos = positions.get(anchor.identifier);
        if (!previewPos) continue;

        const rawEditorTop = editor.getTopForLineNumber(anchor.sourceLine);
        const hiddenBefore = prefixHidden[Math.max(0, Math.min(prefixHidden.length - 1, anchor.sourceLine - 1))] ?? 0;
        const adjustedForHidden = Math.max(0, rawEditorTop - hiddenBefore * lineHeight);

        matched.push({
          editorTop: Math.max(0, adjustedForHidden),
          previewTop: previewPos.top,
        });
      }

      // Sort by editor position and filter non-monotonic preview positions
      matched.sort((a, b) => a.editorTop - b.editorTop);
      
      const filtered: Array<{ editorTop: number; previewTop: number }> = [];
      let lastPreviewTop = -Infinity;
      for (const item of matched) {
        if (item.previewTop >= lastPreviewTop) {
          filtered.push(item);
          lastPreviewTop = item.previewTop;
        }
      }

      return filtered;
    },
    [],
  );

  // Rebuild anchors when content changes
  const rebuildAnchors = useCallback(() => {
    if (!sourceContent) {
      anchorsRef.current = [];
      totalSourceLinesRef.current = 0;
      prefixHiddenLinesRef.current = [0];
      return;
    }
    const parsed = parseSourceAnchors(sourceContent);
    anchorsRef.current = parsed.anchors;
    totalSourceLinesRef.current = sourceContent.split("\n").length;
    prefixHiddenLinesRef.current = parsed.prefixHiddenLines;
  }, [sourceContent]);

  /**
   * Sync preview scroll position based on source scroll
   * Note: scrollTop and lineHeight are kept for API compatibility but no longer used
   */
  const syncSourceToPreview = useCallback(
    (_scrollTop: number, _lineHeight: number) => {
      if (!isEnabled || isApplyingEditorScrollRef.current) return;

      const editor = getEditor();
      const preview = previewRef.current;
      if (!editor || !preview) return;

      // If the source is at the very top/bottom, the preview should also be at top/bottom.
      // This fixes cases where the editor's top visible line can never reach the last line,
      // causing the preview to stop short of the end.
      const editorScrollTop = editor.getScrollTop();
      const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);

      // Adjust the source scroll position to ignore "commented out" (hidden) lines.
      // This effectively pauses preview scrolling while the user scrolls through hidden blocks.
      const prefixHidden = prefixHiddenLinesRef.current;
      const visibleRanges = editor.getVisibleRanges();
      const topLine = visibleRanges.length > 0 ? visibleRanges[0].startLineNumber : 1;
      const hiddenBeforeTopLine = prefixHidden[Math.max(0, Math.min(prefixHidden.length - 1, topLine - 1))] ?? 0;
      const hiddenAdjustPx = hiddenBeforeTopLine * lineHeight;
      const editorScrollTopAdjusted = Math.max(0, editorScrollTop - hiddenAdjustPx);

      const editorMaxScroll = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height);
      const editorAtTop = editorScrollTop <= 1;
      const editorAtBottom = editorMaxScroll > 0 && editorScrollTop >= editorMaxScroll - 1;
      const previewMaxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);

      const matchedAnchors = buildMatchedAnchorsStretched(editor, preview, lineHeight);

      // If we have image anchors, the source axis is stretched in buildMatchedAnchorsStretched.
      // Mirror that stretching for the current scrollTop so interpolation remains consistent.
      // Also compute total image extra for scaling editorMaxScroll to match.
      //
      // KEY BEHAVIOR: When scrolling through a single-line image tag in source, we want
      // to scroll through the full image height in preview. This is achieved by gradually
      // adding the "extra" pixels as we scroll through the image line, rather than jumping
      // all at once when we pass the line.
      //
      // IMAGE_SCROLL_ZONE_LINES controls how many source lines worth of scrolling it takes
      // to scroll through the image. Higher = slower image scrolling in preview.
      const IMAGE_SCROLL_ZONE_LINES = 2.5;
      let imageExtraBeforeScrollTop = 0;
      let totalImageExtra = 0;
      if (matchedAnchors.length > 0 && anchorsRef.current.length > 0) {
        const positions = getPreviewElementPositions(preview);
        const prefixHiddenLocal = prefixHiddenLinesRef.current;
        for (const anchor of anchorsRef.current) {
          if (anchor.type !== "image") continue;
          const previewPos = positions.get(anchor.identifier);
          if (!previewPos) continue;
          const extra = Math.max(0, (previewPos.height || 0) - lineHeight);
          totalImageExtra += extra;
          
          const rawTop = editor.getTopForLineNumber(anchor.sourceLine);
          const hiddenBefore = prefixHiddenLocal[Math.max(0, Math.min(prefixHiddenLocal.length - 1, anchor.sourceLine - 1))] ?? 0;
          const imageTop = Math.max(0, rawTop - hiddenBefore * lineHeight);
          // Extend the scroll zone beyond just the image line for smoother scrolling
          const imageZoneHeight = lineHeight * IMAGE_SCROLL_ZONE_LINES;
          const imageBottom = imageTop + imageZoneHeight;
          
          if (editorScrollTopAdjusted >= imageBottom) {
            // We're completely past this image zone - add full extra
            imageExtraBeforeScrollTop += extra;
          } else if (editorScrollTopAdjusted > imageTop) {
            // We're IN the image zone - add proportional extra based on how far through
            // the zone we've scrolled. This creates the "pause" effect where scrolling
            // through the image line in source scrolls through the full image in preview.
            const progressThroughZone = (editorScrollTopAdjusted - imageTop) / imageZoneHeight;
            imageExtraBeforeScrollTop += extra * progressThroughZone;
          }
          // If we're before the image line, add nothing for this image
        }
      }

      const editorScrollTopForMapping = editorScrollTopAdjusted + imageExtraBeforeScrollTop;
      // Scale editorMaxScroll to include total image stretch so ratios are consistent
      const editorMaxScrollStretched = editorMaxScroll + totalImageExtra;

      let targetScrollTop: number;

      if (matchedAnchors.length < 2) {
        // Fallback: use editor scroll percent (pixel-based, works with word-wrap).
        const scrollPercent = editorMaxScrollStretched > 0 ? editorScrollTopForMapping / editorMaxScrollStretched : 0;
        targetScrollTop = scrollPercent * previewMaxScroll;
      } else {
        let prev: { editorTop: number; previewTop: number } | null = null;
        let next: { editorTop: number; previewTop: number } | null = null;

        for (const a of matchedAnchors) {
          if (a.editorTop <= editorScrollTopForMapping) {
            prev = a;
          }
          if (a.editorTop > editorScrollTopForMapping) {
            next = a;
          break;
          }
        }

        if (!prev && next) {
          const ratio = next.editorTop > 0 ? editorScrollTopForMapping / next.editorTop : 0;
          targetScrollTop = ratio * next.previewTop;
        } else if (prev && !next) {
          const remainingEditor = Math.max(1, editorMaxScrollStretched - prev.editorTop);
          const ratio = (editorScrollTopForMapping - prev.editorTop) / remainingEditor;
          targetScrollTop = prev.previewTop + ratio * (previewMaxScroll - prev.previewTop);
        } else if (prev && next) {
          const editorRange = Math.max(1, next.editorTop - prev.editorTop);
          const ratio = (editorScrollTopForMapping - prev.editorTop) / editorRange;
          targetScrollTop = prev.previewTop + ratio * (next.previewTop - prev.previewTop);
        } else {
          const scrollPercent = editorMaxScrollStretched > 0 ? editorScrollTopForMapping / editorMaxScrollStretched : 0;
          targetScrollTop = scrollPercent * previewMaxScroll;
        }
      }

      // Edge snapping (soft): keep top aligned, but avoid forcing a big jump to the end.
      if (editorAtTop) {
        targetScrollTop = 0;
      } else if (editorAtBottom) {
        const snapThresholdPx = Math.max(80, Math.min(240, preview.clientHeight * 0.25));
        const distanceToBottom = previewMaxScroll - targetScrollTop;
        if (distanceToBottom <= snapThresholdPx) {
          targetScrollTop = previewMaxScroll;
        }
      }

      // Clamp to valid range
      targetScrollTop = Math.max(0, Math.min(targetScrollTop, previewMaxScroll));

      // Apply scroll
      isApplyingPreviewScrollRef.current = true;
      // Keep the preview delta tracking consistent even though we suppress scroll events while syncing.
      lastPreviewScrollTopRef.current = targetScrollTop;
      lastPreviewScrollTopForDebounceRef.current = targetScrollTop;
      // Use scrollTop assignment for maximum WebView compatibility.
      preview.scrollTop = targetScrollTop;

      setTimeout(() => {
        isApplyingPreviewScrollRef.current = false;
      }, SCROLL_ANIMATION_DURATION + 10);
    },
    [isEnabled, getEditor, previewRef]
  );

  const scheduleSourceScrollEndSync = useCallback(() => {
    if (!isEnabled) return;

    // If the editor scroll position was recently driven by preview->source syncing,
    // don't schedule a "settle" sync back to preview (this causes small counter-scroll nudges).
    if (Date.now() < suppressSourceScrollEndSyncUntilRef.current) {
      return;
    }

    if (sourceScrollEndTimerRef.current !== null) {
      window.clearTimeout(sourceScrollEndTimerRef.current);
    }

    sourceScrollEndTimerRef.current = window.setTimeout(() => {
      sourceScrollEndTimerRef.current = null;
      if (Date.now() < suppressSourceScrollEndSyncUntilRef.current) {
        return;
      }
      // Use current positions at time of debounce firing.
      syncSourceToPreview(0, 0);
    }, SCROLL_END_DEBOUNCE_MS);
  }, [isEnabled, syncSourceToPreview]);

  /**
   * Sync source scroll position based on preview scroll
   */
  const syncPreviewToSource = useCallback(
    (scrollTop: number) => {
      if (!isEnabled || isApplyingPreviewScrollRef.current) return;

      const editor = getEditor();
      const preview = previewRef.current;
      if (!editor || !preview) return;

      const previousPreviewScrollTop = lastPreviewScrollTopRef.current;
      lastPreviewScrollTopRef.current = scrollTop;
      const previewDelta = previousPreviewScrollTop === null ? 0 : scrollTop - previousPreviewScrollTop;

      // Hard edge alignment: if preview is at the very top/bottom, source should match.
      const previewMaxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);
      const previewAtTop = scrollTop <= 1;
      const previewAtBottom = previewMaxScroll > 0 && scrollTop >= previewMaxScroll - 1;
      if (previewAtTop) {
        isApplyingEditorScrollRef.current = true;
        editor.setScrollTop(0);
        setTimeout(() => {
          isApplyingEditorScrollRef.current = false;
        }, SCROLL_ANIMATION_DURATION + 10);
        return;
      }
      if (previewAtBottom) {
        isApplyingEditorScrollRef.current = true;
        editor.setScrollTop(editor.getScrollHeight());
        setTimeout(() => {
          isApplyingEditorScrollRef.current = false;
        }, SCROLL_ANIMATION_DURATION + 10);
        return;
      }

      const totalLines = totalSourceLinesRef.current;
      if (totalLines === 0) return;

      const editorMaxScroll = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height);
      const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
      
      // IMAGE_SCROLL_ZONE_LINES controls how many source lines worth of scrolling corresponds
      // to scrolling through the full image height in preview. Must match syncSourceToPreview.
      const IMAGE_SCROLL_ZONE_LINES = 2.5;
      const positions = getPreviewElementPositions(preview);
      const prefixHiddenLocal = prefixHiddenLinesRef.current;
      
      // Collect image info for adjustment calculations
      const imageInfos: Array<{
        previewTop: number;
        previewBottom: number;
        previewHeight: number;
        sourceTop: number;
        sourceZoneHeight: number;
      }> = [];
      
      for (const anchor of anchorsRef.current) {
        if (anchor.type !== "image") continue;
        const previewPos = positions.get(anchor.identifier);
        if (!previewPos) continue;
        
        const rawTop = editor.getTopForLineNumber(anchor.sourceLine);
        const hiddenBefore = prefixHiddenLocal[Math.max(0, Math.min(prefixHiddenLocal.length - 1, anchor.sourceLine - 1))] ?? 0;
        const sourceTop = Math.max(0, rawTop - hiddenBefore * lineHeight);
        
        imageInfos.push({
          previewTop: previewPos.top,
          previewBottom: previewPos.top + previewPos.height,
          previewHeight: previewPos.height,
          sourceTop,
          sourceZoneHeight: lineHeight * IMAGE_SCROLL_ZONE_LINES,
        });
      }
      
      // Sort by preview position
      imageInfos.sort((a, b) => a.previewTop - b.previewTop);
      
      // Check if we're currently scrolling through an image in the preview
      for (const img of imageInfos) {
        if (scrollTop >= img.previewTop && scrollTop < img.previewBottom) {
          // We're scrolling through an image in preview.
          // Calculate where the source should be: at the image line position,
          // plus a proportional offset within the image zone.
          const progressThroughImage = (scrollTop - img.previewTop) / Math.max(1, img.previewHeight);
          const targetEditorScrollTop = img.sourceTop + (progressThroughImage * img.sourceZoneHeight);
          
          // Clamp and apply
          const clampedTarget = Math.max(0, Math.min(targetEditorScrollTop, editorMaxScroll));
          
          // Direction affinity check
          const currentEditorScrollTop = editor.getScrollTop();
          if (previewDelta > 0 && clampedTarget < currentEditorScrollTop - 2) {
            return;
          }
          if (previewDelta < 0 && clampedTarget > currentEditorScrollTop + 2) {
            return;
          }
          
          suppressSourceScrollEndSyncUntilRef.current = Date.now() + SOURCE_END_SYNC_SUPPRESS_MS;
          isApplyingEditorScrollRef.current = true;
          editor.setScrollTop(clampedTarget);
          setTimeout(() => {
            isApplyingEditorScrollRef.current = false;
          }, SCROLL_ANIMATION_DURATION + 10);
          return;
        }
      }
      
      // Not in an image - use adjusted scroll position that accounts for passed images.
      // For each image we've passed, the preview consumed (imageHeight) pixels but the source
      // only consumed (sourceZoneHeight) pixels. We need to adjust our preview position to
      // account for this difference when interpolating.
      let adjustedScrollTop = scrollTop;
      let adjustedPreviewMaxScroll = previewMaxScroll;
      
      for (const img of imageInfos) {
        if (scrollTop >= img.previewBottom) {
          // We've passed this image - subtract the "extra" preview space it consumed
          const extraPreviewSpace = img.previewHeight - img.sourceZoneHeight;
          adjustedScrollTop -= extraPreviewSpace;
        }
        // Also adjust max scroll to keep ratios consistent
        const extraPreviewSpace = img.previewHeight - img.sourceZoneHeight;
        adjustedPreviewMaxScroll -= extraPreviewSpace;
      }
      
      // Clamp adjusted values
      adjustedScrollTop = Math.max(0, adjustedScrollTop);
      adjustedPreviewMaxScroll = Math.max(1, adjustedPreviewMaxScroll);
      
      // Now use the adjusted positions for interpolation
      const matchedAnchors = buildMatchedAnchorsActual(editor, preview, lineHeight);
      
      // Also adjust anchor preview positions to account for images
      const adjustedAnchors = matchedAnchors.map(anchor => {
        let adjustedPreviewTop = anchor.previewTop;
        for (const img of imageInfos) {
          if (anchor.previewTop >= img.previewBottom) {
            const extraPreviewSpace = img.previewHeight - img.sourceZoneHeight;
            adjustedPreviewTop -= extraPreviewSpace;
          }
        }
        return { editorTop: anchor.editorTop, previewTop: Math.max(0, adjustedPreviewTop) };
      });

      let targetEditorScrollTop: number;
      if (adjustedAnchors.length < 2) {
        // Fallback: map preview scroll percent to editor scroll percent.
        const scrollPercent = adjustedPreviewMaxScroll > 0 ? adjustedScrollTop / adjustedPreviewMaxScroll : 0;
        targetEditorScrollTop = scrollPercent * Math.max(0, editorMaxScroll);
      } else {
        // Re-sort by previewTop for lookup.
        const byPreview = [...adjustedAnchors].sort((a, b) => a.previewTop - b.previewTop);

        let prev: { editorTop: number; previewTop: number } | null = null;
        let next: { editorTop: number; previewTop: number } | null = null;
        for (const a of byPreview) {
          if (a.previewTop <= adjustedScrollTop) {
            prev = a;
          }
          if (a.previewTop > adjustedScrollTop) {
            next = a;
            break;
          }
        }

        if (!prev && next) {
          const ratio = next.previewTop > 0 ? adjustedScrollTop / next.previewTop : 0;
          targetEditorScrollTop = ratio * next.editorTop;
        } else if (prev && !next) {
          const remainingPreview = Math.max(1, adjustedPreviewMaxScroll - prev.previewTop);
          const ratio = (adjustedScrollTop - prev.previewTop) / remainingPreview;
          targetEditorScrollTop = prev.editorTop + ratio * (Math.max(0, editorMaxScroll) - prev.editorTop);
        } else if (prev && next) {
          const previewRange = Math.max(1, next.previewTop - prev.previewTop);
          const ratio = (adjustedScrollTop - prev.previewTop) / previewRange;
          targetEditorScrollTop = prev.editorTop + ratio * (next.editorTop - prev.editorTop);
        } else {
          const scrollPercent = adjustedPreviewMaxScroll > 0 ? adjustedScrollTop / adjustedPreviewMaxScroll : 0;
          targetEditorScrollTop = scrollPercent * Math.max(0, editorMaxScroll);
        }
      }

      // Clamp.
      targetEditorScrollTop = Math.max(0, Math.min(targetEditorScrollTop, Math.max(0, editorMaxScroll)));

      // Direction affinity: never move the source in the opposite direction of the user's preview scroll.
      // This prevents situations where scrolling the preview DOWN causes the editor to jump UP.
      const currentEditorScrollTop = editor.getScrollTop();
      if (previewDelta > 0 && targetEditorScrollTop < currentEditorScrollTop - 2) {
        return;
      }
      if (previewDelta < 0 && targetEditorScrollTop > currentEditorScrollTop + 2) {
        return;
      }

      // Prevent the editor's subsequent debounced "scroll end" sync from nudging the preview.
      suppressSourceScrollEndSyncUntilRef.current = Date.now() + SOURCE_END_SYNC_SUPPRESS_MS;

      isApplyingEditorScrollRef.current = true;
      editor.setScrollTop(targetEditorScrollTop);

      setTimeout(() => {
        isApplyingEditorScrollRef.current = false;
      }, SCROLL_ANIMATION_DURATION + 10);
    },
    [isEnabled, getEditor, previewRef, buildMatchedAnchorsActual]
  );

  const schedulePreviewScrollEndSync = useCallback(
    (scrollTop: number) => {
      if (!isEnabled) return;
      lastPreviewScrollTopForDebounceRef.current = scrollTop;

      if (previewScrollEndTimerRef.current !== null) {
        window.clearTimeout(previewScrollEndTimerRef.current);
      }

      previewScrollEndTimerRef.current = window.setTimeout(() => {
        previewScrollEndTimerRef.current = null;
        // Use last seen preview scrollTop at time of debounce firing.
        syncPreviewToSource(lastPreviewScrollTopForDebounceRef.current);
      }, SCROLL_END_DEBOUNCE_MS);
    },
    [isEnabled, syncPreviewToSource],
  );

  /**
   * Trigger initial sync after content loads
   */
  const triggerInitialSync = useCallback(() => {
    if (!isEnabled) return;

    const editor = getEditor();
    if (!editor) return;

    // Rebuild anchors first
    rebuildAnchors();

    // Small delay to let preview render
    setTimeout(() => {
      const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
      syncSourceToPreview(editor.getScrollTop(), lineHeight);
    }, 100);
  }, [isEnabled, getEditor, rebuildAnchors, syncSourceToPreview]);

  return {
    syncSourceToPreview,
    syncPreviewToSource,
    rebuildAnchors,
    triggerInitialSync,
    scheduleSourceScrollEndSync,
    schedulePreviewScrollEndSync,
  };
}
