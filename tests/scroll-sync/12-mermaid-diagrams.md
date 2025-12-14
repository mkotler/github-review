# Mermaid diagrams (scroll-sync)

This file stresses Mermaid rendering inside the markdown preview.
It includes multiple diagrams of different shapes/heights, plus text between them.

Markers:
- [[M:12.01]]

---

## [[M:12.02]] Flowchart (tall)

```mermaid
flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Path A]
  B -->|No| D[Path B]
  C --> E[Step 1]
  E --> F[Step 2]
  F --> G[Step 3]
  G --> H[Step 4]
  H --> I[Step 5]
  I --> J[End]
  D --> K[Alternate 1]
  K --> L[Alternate 2]
  L --> M[Alternate 3]
  M --> N[Alternate 4]
  N --> O[Alternate 5]
  O --> J
```

Paragraph after the flowchart to ensure there is content below the diagram.

- [[M:12.03]]

---

## [[M:12.04]] Sequence diagram

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant A as App
  participant S as Service

  U->>A: Open file
  A->>S: Fetch content
  S-->>A: Content
  A-->>U: Render preview

  U->>A: Scroll preview
  A->>A: Sync preview→source

  U->>A: Scroll source
  A->>A: Sync source→preview

  U->>A: Fast scrollbar drag
  A->>A: Debounced final sync
```

More text to separate diagrams.

- [[M:12.05]]

---

## [[M:12.06]] Class diagram

```mermaid
classDiagram
  class ScrollSync {
    +syncSourceToPreview()
    +syncPreviewToSource()
    +rebuildAnchors()
    +triggerInitialSync()
  }

  class Editor {
    +getScrollTop()
    +setScrollTop()
    +getScrollHeight()
  }

  class Preview {
    +scrollTop
    +scrollHeight
    +clientHeight
  }

  ScrollSync --> Editor
  ScrollSync --> Preview
```

Final paragraph block so there is meaningful content after the last diagram.

[[M:12.07]]

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor. Cras elementum ultrices diam. Maecenas ligula massa, varius a, semper congue, euismod non, mi.
