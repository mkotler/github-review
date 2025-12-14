# 10 Kitchen Sink

Everything mixed: headings, HRs, lists, code blocks, tables, blockquotes, and images.
Designed to be long enough to reproduce drift, jumps, and off-by-many issues.

[[M:10.01]]

## Intro

Paragraph 1. This paragraph is intentionally long to wrap. This paragraph is intentionally long to wrap.
Paragraph 2. This paragraph is intentionally long to wrap. This paragraph is intentionally long to wrap.

---

[[M:10.02]]

## List + Quote

- Alpha
- Bravo with wrapping text that should extend beyond one line at typical widths
- Charlie
- Delta
- Echo with even more wrapping text that should wrap at typical widths and create a taller list item for scrolling behavior
- Foxtrot
- Golf
- Hotel
- India
- Juliett
- Kilo
- Lima
- Mike
- November
- Oscar
- Papa
- Quebec
- Romeo
- Sierra
- Tango
- Uniform
- Victor
- Whiskey
- X-ray
- Yankee
- Zulu

[[M:10.02B]]

1. Ordered item 1 with wrapping text that should become two lines in most preview widths.
2. Ordered item 2
  - Nested bullet A
  - Nested bullet B with longer text that should wrap and increase item height
3. Ordered item 3

> [[M:10.BQ.1]]
> A blockquote that is long enough to wrap.
> Another line in the same quote.

[[M:10.03]]

## Code Block

```ts
// [[M:10.CODE.1]]
export function fib(n: number): number {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

export function run() {
  for (let i = 0; i < 30; i++) {
    console.log(i, fib(i));
  }
}

// [[M:10.CODE.2]]
// A tall-ish block to create large preformatted regions.
// The goal is to have enough lines to reproduce scroll-sync drift.
//
// 01: line
// 02: line
// 03: line
// 04: line
// 05: line
// 06: line
// 07: line
// 08: line
// 09: line
// 10: line
// 11: line
// 12: line
// 13: line
// 14: line
// 15: line
// 16: line
// 17: line
// 18: line
// 19: line
// 20: line
// 21: line
// 22: line
// 23: line
// 24: line
// 25: line
// 26: line
// 27: line
// 28: line
// 29: line
// 30: line
// 31: line
// 32: line
// 33: line
// 34: line
// 35: line
// 36: line
// 37: line
// 38: line
// 39: line
// 40: line
```

[[M:10.04]]

## Table

| Feature | Notes |
|---------|-------|
| Headers | Lots of headers in this file |
| HR      | Horizontal rules separate blocks |
| Code    | Pre blocks can be very tall |
| Lists   | Nested lists change height |

[[M:10.04B]]

| Row | Content | Notes |
|-----|---------|-------|
| 1 | A | short |
| 2 | B | short |
| 3 | C | short |
| 4 | D | short |
| 5 | E | short |
| 6 | F | short |
| 7 | G | short |
| 8 | H | short |
| 9 | I | short |
| 10 | J | short |
| 11 | K | short |
| 12 | L | short |
| 13 | M | short |
| 14 | N | short |
| 15 | O | short |
| 16 | P | short |
| 17 | Q | short |
| 18 | R | short |
| 19 | S | short |
| 20 | T | short |
| 21 | U | short |
| 22 | V | short |
| 23 | W | short |
| 24 | X | short |
| 25 | Y | short |
| 26 | Z | short |

[[M:10.05]]

## Images (Embedded)

This uses embedded (data URI) SVG images so it renders in local/offline mode.

[[M:10.05A]]

![Embedded image A](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjYwMCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzFmMjkzNyIvPjxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzRiNTU2MyIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0idXJsKCNnKSIvPjxyZWN0IHg9IjQwIiB5PSI0MCIgd2lkdGg9IjExMjAiIGhlaWdodD0iNTIwIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDgpIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4yNSkiLz48dGV4dCB4PSI4MCIgeT0iMTYwIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9IlNlZ29lIFVJLCBBcmlhbCIgZm9udC1zaXplPSI2NCI+U2Nyb2xsIFN5bmMgVGVzdCBJbWFnZSBBPC90ZXh0Pjx0ZXh0IHg9IjgwIiB5PSIyNDAiIGZpbGw9IndoaXRlIiBmb250LWZhbWlseT0iU2Vnb2UgVUksIEFyaWFsIiBmb250LXNpemU9IjMyIj4xMjAww5c2MDAgKGVtYmVkZGVkIFNWRyk8L3RleHQ+PHRleHQgeD0iODAiIHk9IjMyMCIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJTZWdvZSBVSSwgQXJpYWwiIGZvbnQtc2l6ZT0iMjgiPk1hcmtlcjogW1tJTUc6QV1dPC90ZXh0Pjwvc3ZnPg==)

Paragraph after image A. Paragraph after image A. Paragraph after image A.

[[M:10.05B]]

![Embedded image B](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5MDAiIGhlaWdodD0iMTQwMCI+PHJlY3Qgd2lkdGg9IjkwMCIgaGVpZ2h0PSIxNDAwIiBmaWxsPSIjMTExODI3Ii8+PHJlY3QgeD0iNDAiIHk9IjQwIiB3aWR0aD0iODIwIiBoZWlnaHQ9IjEzMjAiIGZpbGw9IiMwYjEyMjAiIHN0cm9rZT0iIzM3NDE1MSIgc3Ryb2tlLXdpZHRoPSI0Ii8+PHRleHQgeD0iODAiIHk9IjE2MCIgZmlsbD0iI2U1ZTdlYiIgZm9udC1mYW1pbHk9IlNlZ29lIFVJLCBBcmlhbCIgZm9udC1zaXplPSI1NiI+U2Nyb2xsIFN5bmMgVGVzdCBJbWFnZSBCPC90ZXh0Pjx0ZXh0IHg9IjgwIiB5PSIyNDAiIGZpbGw9IiM5Y2EzYWYiIGZvbnQtZmFtaWx5PSJTZWdvZSBVSSwgQXJpYWwiIGZvbnQtc2l6ZT0iMzAiPjkwMMOXMTQwMCAodGFsbCk8L3RleHQ+PHRleHQgeD0iODAiIHk9IjMyMCIgZmlsbD0iIzljYTNhZiIgZm9udC1mYW1pbHk9IlNlZ29lIFVJLCBBcmlhbCIgZm9udC1zaXplPSIyOCI+TWFya2VyOiBbW0lNRzpCXV08L3RleHQ+PHJlY3QgeD0iODAiIHk9IjM2MCIgd2lkdGg9Ijc0MCIgaGVpZ2h0PSI1MCIgZmlsbD0iI2VmNDQ0NCIgb3BhY2l0eT0iMC44NSIvPjxyZWN0IHg9IjgwIiB5PSI0NTAiIHdpZHRoPSI3NDAiIGhlaWdodD0iNTAiIGZpbGw9IiNmNTllMGIiIG9wYWNpdHk9IjAuODUiLz48cmVjdCB4PSI4MCIgeT0iNTQwIiB3aWR0aD0iNzQwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjZWFiMzA4IiBvcGFjaXR5PSIwLjg1Ii8+PHJlY3QgeD0iODAiIHk9IjYzMCIgd2lkdGg9Ijc0MCIgaGVpZ2h0PSI1MCIgZmlsbD0iIzIyYzU1ZSIgb3BhY2l0eT0iMC44NSIvPjxyZWN0IHg9IjgwIiB5PSI3MjAiIHdpZHRoPSI3NDAiIGhlaWdodD0iNTAiIGZpbGw9IiMwNmI2ZDQiIG9wYWNpdHk9IjAuODUiLz48cmVjdCB4PSI4MCIgeT0iODEwIiB3aWR0aD0iNzQwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjM2I4MmY2IiBvcGFjaXR5PSIwLjg1Ii8+PHJlY3QgeD0iODAiIHk9IjkwMCIgd2lkdGg9Ijc0MCIgaGVpZ2h0PSI1MCIgZmlsbD0iI2E4NTVmNyIgb3BhY2l0eT0iMC44NSIvPjxyZWN0IHg9IjgwIiB5PSI5OTAiIHdpZHRoPSI3NDAiIGhlaWdodD0iNTAiIGZpbGw9IiNlYzQ4OTkiIG9wYWNpdHk9IjAuODUiLz48L3N2Zz4=)

Paragraph after image B. Paragraph after image B. Paragraph after image B.

[[M:10.06]]

## Repeated Sections

### Subsection A

Text A. Text A. Text A. Text A. Text A.

### Subsection B

Text B. Text B. Text B. Text B. Text B.

### Subsection C

Text C. Text C. Text C. Text C. Text C.

[[M:10.07]]

---

## Another Long Stretch

[[M:10.08]]

Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.
Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.
Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.

[[M:10.09]]

Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.
Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.
Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.

[[M:10.10]]

Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.
Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.
Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.

[[M:10.11]]

Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.
Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.
Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.

[[M:10.12]]

Paragraph. Paragraph. Paragraph. Paragraph. Paragraph. Paragraph.

[[M:10.13]]

Final paragraph: repeat to ensure this file is tall on large monitors. Final paragraph: repeat to ensure this file is tall on large monitors. Final paragraph: repeat to ensure this file is tall on large monitors.

End.
