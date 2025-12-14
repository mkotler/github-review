# 05 Code Blocks

This file stresses fenced code blocks. Scroll sync often fails when large `pre` blocks distort layout.

[[M:05.01]]

## Code Block A

```ts
// [[M:05.CODE.A]]
function add(a: number, b: number): number {
  return a + b;
}

export function demo() {
  const items = Array.from({ length: 50 }, (_, i) => i);
  return items.map((n) => add(n, 1));
}
```

Paragraph between blocks. Paragraph between blocks. Paragraph between blocks.

[[M:05.01B]]

Another paragraph between blocks. Another paragraph between blocks. Another paragraph between blocks.

[[M:05.02]]

## Code Block B (Long)

```md
[[M:05.CODE.B.START]]
Line 001
Line 002
Line 003
Line 004
Line 005
Line 006
Line 007
Line 008
Line 009
Line 010
Line 011
Line 012
Line 013
Line 014
Line 015
Line 016
Line 017
Line 018
Line 019
Line 020
Line 021
Line 022
Line 023
Line 024
Line 025
Line 026
Line 027
Line 028
Line 029
Line 030
Line 031
Line 032
Line 033
Line 034
Line 035
Line 036
Line 037
Line 038
Line 039
Line 040
Line 041
Line 042
Line 043
Line 044
Line 045
Line 046
Line 047
Line 048
Line 049
Line 050
Line 051
Line 052
Line 053
Line 054
Line 055
Line 056
Line 057
Line 058
Line 059
Line 060
Line 061
Line 062
Line 063
Line 064
Line 065
Line 066
Line 067
Line 068
Line 069
Line 070
Line 071
Line 072
Line 073
Line 074
Line 075
Line 076
Line 077
Line 078
Line 079
Line 080
Line 081
Line 082
Line 083
Line 084
Line 085
Line 086
Line 087
Line 088
Line 089
Line 090
Line 091
Line 092
Line 093
Line 094
Line 095
Line 096
Line 097
Line 098
Line 099
Line 100
[[M:05.CODE.B.END]]
```

[[M:05.02B]]

Paragraph after long code block. Paragraph after long code block. Paragraph after long code block.

[[M:05.03]]

## Code Block C

```json
{
  "marker": "[[M:05.CODE.C]]",
  "enabled": true,
  "count": 123
}
```

[[M:05.04]]

## Code Block D (Very Tall)

```txt
[[M:05.CODE.D.START]]
This block is meant to be *very tall* in preview.
It contains many lines so that preview scrolling has a large `pre` region.

01  Lorem ipsum but not really: this is a numbered line.
02  Lorem ipsum but not really: this is a numbered line.
03  Lorem ipsum but not really: this is a numbered line.
04  Lorem ipsum but not really: this is a numbered line.
05  Lorem ipsum but not really: this is a numbered line.
06  Lorem ipsum but not really: this is a numbered line.
07  Lorem ipsum but not really: this is a numbered line.
08  Lorem ipsum but not really: this is a numbered line.
09  Lorem ipsum but not really: this is a numbered line.
10  Lorem ipsum but not really: this is a numbered line.
11  Lorem ipsum but not really: this is a numbered line.
12  Lorem ipsum but not really: this is a numbered line.
13  Lorem ipsum but not really: this is a numbered line.
14  Lorem ipsum but not really: this is a numbered line.
15  Lorem ipsum but not really: this is a numbered line.
16  Lorem ipsum but not really: this is a numbered line.
17  Lorem ipsum but not really: this is a numbered line.
18  Lorem ipsum but not really: this is a numbered line.
19  Lorem ipsum but not really: this is a numbered line.
20  Lorem ipsum but not really: this is a numbered line.
21  Lorem ipsum but not really: this is a numbered line.
22  Lorem ipsum but not really: this is a numbered line.
23  Lorem ipsum but not really: this is a numbered line.
24  Lorem ipsum but not really: this is a numbered line.
25  Lorem ipsum but not really: this is a numbered line.
26  Lorem ipsum but not really: this is a numbered line.
27  Lorem ipsum but not really: this is a numbered line.
28  Lorem ipsum but not really: this is a numbered line.
29  Lorem ipsum but not really: this is a numbered line.
30  Lorem ipsum but not really: this is a numbered line.
31  Lorem ipsum but not really: this is a numbered line.
32  Lorem ipsum but not really: this is a numbered line.
33  Lorem ipsum but not really: this is a numbered line.
34  Lorem ipsum but not really: this is a numbered line.
35  Lorem ipsum but not really: this is a numbered line.
36  Lorem ipsum but not really: this is a numbered line.
37  Lorem ipsum but not really: this is a numbered line.
38  Lorem ipsum but not really: this is a numbered line.
39  Lorem ipsum but not really: this is a numbered line.
40  Lorem ipsum but not really: this is a numbered line.
41  Lorem ipsum but not really: this is a numbered line.
42  Lorem ipsum but not really: this is a numbered line.
43  Lorem ipsum but not really: this is a numbered line.
44  Lorem ipsum but not really: this is a numbered line.
45  Lorem ipsum but not really: this is a numbered line.
46  Lorem ipsum but not really: this is a numbered line.
47  Lorem ipsum but not really: this is a numbered line.
48  Lorem ipsum but not really: this is a numbered line.
49  Lorem ipsum but not really: this is a numbered line.
50  Lorem ipsum but not really: this is a numbered line.
[[M:05.CODE.D.END]]
```

[[M:05.05]]

Trailing paragraph. Trailing paragraph. Trailing paragraph.

End.
