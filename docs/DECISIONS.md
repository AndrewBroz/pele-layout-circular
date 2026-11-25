# Decisions

Append-only, dated. The plan these belong to is `docs/PLAN.md`.

- **2026-11-25 — Founded, as its own repo.** Obsidian renders Mermaid
  with Pele, and `obsidian-mermaid-circular` bundles all of mermaid to
  draw circles that look like Pele's. The circular layout for Pele
  lives here, not in `mermaid-layout-circular`, which stays the layout
  for the mermaid codebase ("Mermaid" also names the language, which
  Pele renders too). Three tracks, planned in `docs/PLAN.md`: (1)
  offer Pele a public layout hook, as a PR built on its internal
  `FlowVariant` seam; (2) independently, the Obsidian plugin bundles
  Pele instead of mermaid; (3) this package, first a wrapper around
  Pele's own flowchart diagram that works today, then a plain layout
  registration if the hook lands. How the placement math is shared
  with `mermaid-layout-circular` is undecided (decision point B).
- **2026-11-25 — Open question: layout, or diagram type?**
  `mermaid-layout-circular` was founded as a layout engine, not a new
  diagram type, and as a layout it is perfectly fine today. Whether
  circular is, in the long run, its own diagram type is a question
  worth keeping open, not one to answer now. Recorded so later work
  doesn't treat "layout" as settled because it came first.
