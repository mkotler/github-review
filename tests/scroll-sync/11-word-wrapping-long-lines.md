# 11 Word Wrapping + Long Lines

This file stress-tests scroll sync when **word wrap** changes the effective height of the source.
It intentionally includes:
- very long paragraphs with lots of spaces (wraps differently at different widths)
- very long single “words” (may not wrap, depending on CSS)
- long list items and blockquotes
- long code lines (editor may wrap; preview may not)

[[M:11.01]]

## Long wrapped paragraphs

Paragraph W1: This sentence is deliberately long with many words and spaces so that it wraps across multiple visual lines in the editor and in the preview at typical widths. Keep scrolling and watch whether the preview stays aligned with the source as you move through the middle of this paragraph, because wrapping is where line-based mapping tends to lose fidelity.

Paragraph W2: Another long sentence with varied punctuation, commas, parentheses (like this), and repeated phrases to create a stable but tall region. Another long sentence with varied punctuation, commas, parentheses (like this), and repeated phrases to create a stable but tall region. Another long sentence with varied punctuation, commas, parentheses (like this), and repeated phrases to create a stable but tall region.

[[M:11.02]]

Paragraph W3: Now we add a single extremely long token to test non-breaking behavior (this may overflow horizontally in the preview depending on CSS):

SuperLongToken_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

Paragraph W4: Back to normal wrapping text after the long token. Back to normal wrapping text after the long token. Back to normal wrapping text after the long token. Back to normal wrapping text after the long token.

[[M:11.03]]

## Long list items

- List L1: This list item is intentionally long with enough words to wrap two-to-five lines depending on pane width. It should produce stable vertical height in both panes while you scroll.
- List L2: This list item includes a long URL that is likely to wrap or overflow depending on CSS and font metrics: https://example.com/this/is/a/very/long/path/with/many/segments/and/query?alpha=one&bravo=two&charlie=three&delta=four&echo=five
- List L3: This list item contains multiple clauses; the goal is to create a lot of wrapping without introducing headings that the anchor algorithm can “cheat” with.
- List L4: Repeat a long sentence: wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap.

[[M:11.04]]

## Blockquote wrapping

> Quote Q1: This blockquote line is long enough to wrap and should contribute a distinct height region in the preview.
> Quote Q2: Another long wrapped line in the same blockquote; keep scrolling through the quote and confirm the source and preview move together.
> Quote Q3: Repeat repeat repeat repeat repeat repeat repeat repeat repeat repeat repeat repeat repeat repeat repeat repeat.

[[M:11.05]]

## Long inline code and code blocks

Inline code can wrap differently depending on styling: `const veryLongIdentifierNameThatKeepsGoingAndGoingAndGoing = someFunctionCall(with, many, arguments, that, make, this, line, extremely, long, for, wrap, testing);`

```ts
// [[M:11.CODE.1]]
// A single extremely long line (editor may wrap; preview code blocks may not).
const longLine = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// Several long-ish lines that include spaces (more likely to wrap in editor if wrap is enabled).
export function wrapStress(a: string, b: string, c: string, d: string, e: string, f: string, g: string) {
  return `${a} ${b} ${c} ${d} ${e} ${f} ${g} ${a} ${b} ${c} ${d} ${e} ${f} ${g}`;
}
```

[[M:11.06]]

## Wide table cells (wrapping inside table)

| Column A | Column B |
|---------:|:---------|
| Row 1 | This cell is intentionally long with many words so that it wraps inside the table cell in the preview and creates a larger height region. This cell is intentionally long with many words so that it wraps inside the table cell in the preview and creates a larger height region. |
| Row 2 | Another long cell with commas, parentheses (like this), and repeated fragments to vary line breaks and produce stable but tall layout. Another long cell with commas, parentheses (like this), and repeated fragments to vary line breaks and produce stable but tall layout. |
| Row 3 | A shorter row for contrast. |

[[M:11.07]]

## Final stretch

Final paragraph: Repeat to ensure the file is tall enough even on large monitors. Final paragraph: Repeat to ensure the file is tall enough even on large monitors. Final paragraph: Repeat to ensure the file is tall enough even on large monitors.

Final paragraph (continued): More wrapping text. More wrapping text. More wrapping text. More wrapping text. More wrapping text. More wrapping text.

End.
