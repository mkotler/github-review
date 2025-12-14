# Source-Preview Scroll Synchronization Design

## Overview

This document outlines the design for bidirectional scroll synchronization between the source code view (Monaco Editor or Diff Editor) and the preview view (rendered markdown). The goal is to keep both views showing approximately the same content position as the user scrolls either pane.

## Current Implementation Analysis

The existing implementation uses **percentage-based scrolling**:
- When scrolling the source: `scrollPercentage = scrollTop / maxScroll`, then applies that percentage to the preview
- When scrolling the preview: Calculates a target line number from percentage and calls `revealLineInCenter(targetLine)`

### Problems with Current Approach

1. **Content height mismatch**: A markdown header is 1 line in source but may render as 50px in preview. A mermaid diagram might be 10 lines in source but 400px in preview. Percentage-based sync doesn't account for this.

2. **Non-linear relationship**: The relationship between source lines and preview position is not linear. Tables, images, code blocks, and diagrams create "stretching" in the preview.

3. **No anchor awareness**: The current approach doesn't leverage the semantic structure of markdown (headers, paragraphs, etc.).

4. **Comments in source**: When the source has inline review comments (decorations), scrolling through those should still cause preview movement.

---

## Proposed Solution: Anchor-Based Scroll Synchronization

### Core Concept

Build a **bidirectional mapping** between source line numbers and preview DOM elements using markdown structure anchors. When scrolling, find the nearest anchor and calculate the offset from that anchor to synchronize positions.

### Anchor Types (in priority order)

1. **Headers** (`h1`-`h6`) - Most reliable, single line in source, identifiable in preview via `id` attribute
2. **Horizontal rules** (`---`) - Single line in source, single element in preview
3. **Code blocks** (fenced with ```) - Multiple lines but bounded start/end
4. **Images** - Single line reference in source
5. **Tables** - Multiple lines, rendered as `<table>` element
6. **Blockquotes** - Start markers in source
7. **List items** - Can be identified by position

### Architecture

```
┌─────────────────┐                    ┌─────────────────┐
│  Source Editor  │                    │  Preview Pane   │
│  (Monaco)       │                    │  (HTML/React)   │
│                 │                    │                 │
│  Line 1: # Foo  │ ←──── Anchor ────→ │  <h1 id="foo">  │
│  Line 5: ## Bar │ ←──── Anchor ────→ │  <h2 id="bar">  │
│  Line 10: text  │       (lerp)       │  <p>text</p>    │
│                 │                    │                 │
└─────────────────┘                    └─────────────────┘
         │                                      │
         └──────────── ScrollSync ──────────────┘
```

### Data Structure

```typescript
interface ScrollAnchor {
  sourceLine: number;           // Line number in source (1-indexed)
  sourceEndLine?: number;       // For multi-line elements (tables, code blocks)
  previewElement: HTMLElement;  // DOM element in preview
  type: 'header' | 'hr' | 'codeblock' | 'image' | 'table' | 'blockquote' | 'list';
  id?: string;                  // For headers, the id attribute
}

interface AnchorMap {
  anchors: ScrollAnchor[];      // Sorted by sourceLine
  sourceToPreview: Map<number, HTMLElement>;
  previewToSource: Map<HTMLElement, number>;
}
```

### Building the Anchor Map

**On file load / content change:**

1. Parse the markdown source to identify anchor positions:
   - Regex for headers: `/^(#{1,6})\s+(.+)$/gm`
   - Regex for horizontal rules: `/^(-{3,}|\*{3,}|_{3,})$/gm`
   - Regex for fenced code blocks: `/^```/gm`
   - Regex for images: `/!\[.*?\]\(.*?\)/gm`
   - etc.

2. Query preview DOM for corresponding elements:
   - Headers: `querySelectorAll('h1, h2, h3, h4, h5, h6')`
   - HRs: `querySelectorAll('hr')`
   - Code blocks: `querySelectorAll('pre > code')`
   - etc.

3. Match source positions to preview elements by:
   - For headers: Match by generated ID (already implemented in `markdownComponents`)
   - For others: Match by order of appearance

### Scroll Synchronization Algorithm

**Source → Preview:**

```typescript
function syncSourceToPreview(scrollTop: number, editorLineHeight: number) {
  // 1. Find which line is at the top of the viewport
  const topLine = Math.floor(scrollTop / editorLineHeight) + 1;
  
  // 2. Find the surrounding anchors
  const { prevAnchor, nextAnchor } = findSurroundingAnchors(topLine);
  
  // 3. Calculate interpolation factor
  let t = 0;
  if (prevAnchor && nextAnchor) {
    t = (topLine - prevAnchor.sourceLine) / (nextAnchor.sourceLine - prevAnchor.sourceLine);
  }
  
  // 4. Get preview positions for anchors
  const prevY = prevAnchor?.previewElement.offsetTop ?? 0;
  const nextY = nextAnchor?.previewElement.offsetTop ?? previewMaxScroll;
  
  // 5. Interpolate preview scroll position
  const targetScroll = prevY + t * (nextY - prevY);
  
  // 6. Apply with damping for smoothness
  animateScrollTo(previewElement, targetScroll);
}
```

**Preview → Source:**

```typescript
function syncPreviewToSource(scrollTop: number) {
  // 1. Find which preview element is at/near the top of viewport
  const { prevAnchor, nextAnchor, t } = findVisibleAnchors(scrollTop);
  
  // 2. Calculate target source line
  let targetLine = prevAnchor?.sourceLine ?? 1;
  if (prevAnchor && nextAnchor) {
    targetLine = prevAnchor.sourceLine + t * (nextAnchor.sourceLine - prevAnchor.sourceLine);
  }
  
  // 3. Scroll editor to that line
  editor.revealLineNearTop(Math.round(targetLine), 0.1);
}
```

### Handling Edge Cases

#### 1. Content with no anchors
Fall back to percentage-based scrolling if no anchors can be matched.

#### 2. One pane reaches end before the other
Allow independent scrolling when one pane hits its limit:
- If source is at bottom but preview has more content: let preview continue scrolling
- Vice versa

#### 3. Diff mode
The diff editor shows both original and modified. Use the **modified editor** for scroll sync since the preview shows the modified content.

#### 4. Comments / decorations in source
Decorations (like review comments) add visual height to Monaco but don't affect line numbers. The anchor-based approach naturally handles this since we track line numbers, not pixel positions.

#### 5. Mermaid diagrams
Mermaid code blocks in source render as diagrams that are often much larger. Treat as a code block anchor - the start of the mermaid block maps to the top of the rendered diagram.

#### 6. Images
Images can be large in preview. Map the image markdown line to the `<img>` element's top position.

#### 7. Tables
Tables in source span multiple lines. Map the table's first line (or `|` pattern start) to the `<table>` element's top.

---

## Implementation Plan

### Phase 1: Anchor Detection

1. Create `useScrollAnchors` hook that:
   - Parses source content to extract anchor positions
   - Observes preview DOM mutations to update element references
   - Returns the anchor map

### Phase 2: Source → Preview Sync

1. Replace the `onDidScrollChange` handler for Monaco Editor
2. Implement interpolation-based scroll calculation
3. Add smooth animation (requestAnimationFrame)

### Phase 3: Preview → Source Sync

1. Replace the `onScroll` handler for preview div
2. Implement reverse anchor lookup
3. Use `editor.setScrollTop()` instead of `revealLineInCenter()` for smoother sync

### Phase 4: Edge Case Handling

1. Implement boundary detection (at-top, at-bottom states)
2. Add fallback to percentage-based sync when anchors unavailable
3. Handle diff mode specifically

### Phase 5: Performance Optimization

1. Throttle/debounce scroll handlers
2. Cache anchor map (invalidate only on content change)
3. Use binary search for anchor lookup

---

## Design Decisions

Based on review, the following decisions have been made:

### D1: Scroll Animation Timing
**Decision:** Custom eased animation (~50ms) for responsiveness while avoiding jitter.

### D2: Scroll Debouncing  
**Decision:** Every frame (requestAnimationFrame) for smoothest feel, with loop prevention via flags.

### D3: Anchor Precision for Tables
**Decision:** Map to proportional position within table. When scrolling through a multi-line table in source, the preview should scroll proportionally through the rendered table element.

### D4: Handling Front Matter
**Decision:** Ignore front matter since it doesn't appear in preview.

### D5: Scroll Position When Switching Files
**Decision:** Restore last scroll position for source, then immediately sync preview to match before user starts scrolling. This ensures views are aligned from the moment a file is selected.

### D6: Diff Editor Specifics
**Decision:** Use the modified editor's line positions for sync, since preview shows the modified content.

### D7: Preview-Only Navigation (Anchor Links)
**Decision:** Scroll preview first, then trigger normal sync to bring source to matching position.

### D8: Scroll Direction Affinity
**Decision:** No affinity - always calculate correct position. May revisit if it feels unnatural during testing.

### D9: Comments Pane Interaction
**Decision:** Comments pane scrolling is independent and does not affect source/preview sync.

### D10: Drift Tolerance
**Decision:** 1-2 lines tolerance for smoothness, avoiding constant micro-adjustments.

---

## Additional Considerations

### Zoom Level Handling
Both the source editor and preview pane can have different zoom levels applied. This affects the pixel heights of content but should not affect the anchor-based synchronization since:

1. **Source side:** Line numbers remain constant regardless of zoom. The Monaco editor's `getScrollTop()` and line height calculations account for current zoom.

2. **Preview side:** Element `offsetTop` values automatically reflect the zoomed layout. The anchor positions in pixels update naturally with zoom changes.

3. **Anchor map invalidation:** The anchor map should be rebuilt when:
   - File content changes
   - Preview DOM is re-rendered
   - Zoom level changes (since preview element positions shift)

4. **Implementation:** Listen for zoom level changes via the `paneZoomLevel` state and invalidate/rebuild the anchor map when it changes.

### Performance Budget
The scroll handler is called frequently (potentially 60+ times per second). The anchor lookup and scroll calculation must complete in < 2ms to avoid jank.

### Testing Scenarios
1. **Simple markdown** - few headers, mostly text
2. **Header-heavy** - many nested headers (documentation)
3. **Image-heavy** - many images expanding preview
4. **Table-heavy** - large tables spanning many source lines
5. **Mermaid diagrams** - significant height differences
6. **Mixed content** - all of the above
7. **Very long files** - thousands of lines
8. **Diff mode** - with additions/deletions

---

## Next Steps

1. ~~Review this document and answer the open questions~~ ✅ Complete
2. ~~Implement the solution based on decisions above~~ ✅ Complete
3. Test the implementation and iterate on any edge cases or UX issues

## Implementation Summary

The anchor-based scroll synchronization has been implemented in:

- **[useScrollSync.ts](../app/src/useScrollSync.ts)** - Custom hook containing:
  - `parseSourceAnchors()` - Parses markdown source to extract anchor positions (headers, code blocks, tables, images, blockquotes)
  - `matchAnchorsToPreview()` - Matches source anchors to preview DOM elements
  - `findSurroundingAnchors()` - Binary search for surrounding anchors given a source line
  - `findAnchorByPreviewPosition()` - Finds anchor based on preview scroll position
  - `syncSourceToPreview()` - Syncs source editor scroll to preview pane
  - `syncPreviewToSource()` - Syncs preview pane scroll to source editor
  - `rebuildAnchors()` - Rebuilds anchor map (called on content/zoom changes)
  - `triggerInitialSync()` - Triggers initial sync after file load

- **[App.tsx](../app/src/App.tsx)** - Integration:
  - Added `getEditorForScrollSync()` callback to handle diff/normal editor switching
  - Connected `syncSourceToPreview()` to Monaco Editor's `onDidScrollChange` event
  - Connected `syncPreviewToSource()` to preview pane's `onScroll` event
  - Added effects to trigger initial sync and rebuild anchors on zoom changes

