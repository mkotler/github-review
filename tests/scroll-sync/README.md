# Scroll Sync Test Files

This folder contains a progression of Markdown files designed to make scroll-sync bugs easy to reproduce and describe.

## How to use
1. Open a PR that contains this folder (recommended), or otherwise view these files through the app the same way you view PR files.
2. For each file, test both directions:
   - Source ➜ Preview: scroll the Monaco editor; preview should track.
   - Preview ➜ Source: scroll the preview; editor should track.

### Local directory mode
If you don't want to push a PR just to test scroll-sync, you can load this folder from disk using local directory mode.

- Example: run the app pointing at this folder: `--local-dir=tests/scroll-sync`
- Note: when running via `npm run tauri dev`, you may need an extra `--` to forward args through Cargo (see the main project README).
   - From `github-review/app`: `npm run tauri dev -- -- -- --local-dir ../tests/scroll-sync`
   - From repo root: `npm run tauri dev -- -- -- --local-dir ./tests/scroll-sync`

## How to report a bug precisely
When you see a mismatch, capture these 4 things:
- File name (e.g. `07-images-links.md`)
- Direction (`source->preview` or `preview->source`)
- Which marker is at the top of the SOURCE (or roughly centered), e.g. `[[M:07.03]]`
- Which marker is at the top of the PREVIEW (or roughly centered)

Markers look like this and are intentionally unique:
- `[[M:01.01]]`, `[[M:10.12]]`, etc.

## Test ladder (why these exist)
- `01-minimal.md`: few headers + paragraphs
- `02-no-anchors-long.md`: almost no structure (tests “percentage” fallback)
- `03-headings-only.md`: many headers, short bodies (tests header matching)
- `04-hr-and-paragraphs.md`: lots of horizontal rules and spacing
- `05-codeblocks.md`: multiple fenced code blocks + text
- `06-tables.md`: several tables with different sizes
- `07-images-links.md`: images + links (images may affect layout)
- `07-images-links.md` uses embedded (data URI) SVG images so it renders offline.
- `08-blockquotes-lists.md`: lists + nested lists + blockquotes
- `09-duplicate-headings.md`: duplicate header texts (slug collisions)
- `10-kitchen-sink.md`: everything mixed, long enough to scroll a lot
- `11-word-wrapping-long-lines.md`: stress word-wrapping + very long lines
- `12-mermaid-diagrams.md`: stress Mermaid rendering + layout changes

If you want, I can also add a single “expected behaviors checklist” per file (still no code changes), but I kept it minimal so you can describe reality vs expectation in your own words.
