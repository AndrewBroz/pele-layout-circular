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
- **2026-11-25 — Decision point B: a self-contained core, built to be
  copied.** The placement math moves out of `mermaid-layout-circular`
  into its own renderer-neutral package, the one source of truth. It
  is one folder with no runtime dependencies and no imports from
  outside it: pure, synchronous and deterministic. Both layouts
  compile it into their bundles at build time; neither ships it as a
  runtime dependency. Mermaid-specific tuning, such as the clear run
  before each arrowhead, becomes a setting.

  Why this shape and not a plain dependency: both possible upstreams
  take in outside layout code as source. Pele's `AGENTS.md` forbids
  library runtime dependencies, and Pele hand-ports even Mermaid's
  grammar rules. Mermaid copied a Pele-derived layered engine into
  core as a self-contained folder (commit `75d1cae1`, 2026-11-03),
  with Pele's MIT notice in `THIRD_PARTY_NOTICES` and the original
  style kept so fixes can be ported by hand. `layout-tidy-tree`
  bundles its algorithm as a build-time dependency. Upstreaming the
  core means copying its folder the same way.

  Consequences outside this repo: a new package for the core, and
  `mermaid-layout-circular` rewired to build from it. Each is recorded
  in its own repo when it is made.
