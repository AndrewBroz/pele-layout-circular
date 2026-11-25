# Plan

How the circular layout comes to [Pele](https://pele.run), the
Mermaid renderer Obsidian ships. Written 2026-11-25.

"Mermaid" names two things: the diagram language, and the mermaid
codebase that renders it. Pele renders the same language with
different code. `mermaid-layout-circular` is the layout engine for the
mermaid codebase. This repo, `pele-layout-circular`, is the layout for
Pele. The plan and its decisions are kept here. When a branch below
has consequences for another repo, that work is recorded in that repo
when it actually happens, not before.

## Where things stand

- **Obsidian already renders Mermaid with Pele.**
  `obsidian-mermaid-circular` was adapted to that (0.9.0, "circles
  survive Pele"; then "circles dress like Pele"). It works by bundling
  its own copy of mermaid, the full 1.6 MB package, to draw circular
  diagrams styled to look like Pele's. It needed nothing from
  Obsidian or the Pele developers.
- **Pele has no public layout hook.** It has its own parser per
  diagram type and its own layered layout. `register()` (from
  `pele/core`) swaps a whole diagram type, not a layout. Frontmatter
  config reaches the diagram's `render()` intact, so `layout: circular`
  arrives; Pele just doesn't act on it.
- **Internally, the seam exists.** `FlowVariant` in Pele's
  `src/diagrams/flowchart/render.ts` lets a flowchart-shaped diagram
  supply its own `layout(nodes, edges, dir, opt, tight)`, filling in
  node positions and edge routes while Pele does all the drawing.
  Swimlane uses it. It isn't exported.
- **What is exported:** `pele/diagrams/flowchart` gives the built-in
  flowchart `Diagram` (`parse` + `render`), and `pele/core` gives
  `register()`, `render()`, and the `Diagram` type.
- **The placement math already exists** in `mermaid-layout-circular`'s
  `src/layout.ts`. It doesn't import mermaid and fits Pele's rules
  (synchronous, no DOM, same input gives the same SVG). Some of its
  tuning targets the mermaid codebase: the clean straight run before
  each arrowhead exists because of how mermaid trims paths and orients
  markers. Pele handles markers its own way and will want different
  values.

## Tracks

Tracks 1 and 2 are independent and can run at the same time. Track 3,
phase 1 depends on neither; phase 2 waits on decision point A.

### 1. Ask Pele for a layout hook, with a PR

A clean request, a PR that implements it well, and the reasoning for
it. The Pele repo has been quiet since its last burst of commits; a
complete, well-argued PR asks the least of the maintainers. Drafted
2026-11-25 in a local Pele checkout (`~/Code/personal/pele`, commit
`84edb47`, description in `PR.md`), not pushed.

The shape: the existing `FlowVariant` seam, made public and keyed by
the `layout` config name Mermaid already uses:

- a registration call for named flowchart layouts beside `register()`,
  and the flowchart renderer choosing that layout when the diagram's
  `config.layout` names it, falling back to its own layout otherwise;
- the layout gets measured nodes and edges (sizes, label sizes,
  groups) and returns positions, routes, and label positions, the
  `CNode`/`CEdge` contract as it stands;
- **one addition the circle needs:** a way for a route to carry a
  finished path, or at least a flag to draw a route as straight
  segments. Routes today are `(x, y, axis)` points smoothed by Pele's
  own curve code, which would turn a sampled arc into something else.

The argument: the mermaid codebase has `registerLayoutLoaders` and an
ecosystem (elk, tidy-tree) built on it. Pele says it doesn't support
external Mermaid plugins, and this is the smallest change that gives
that ecosystem a place to go. It costs Pele nothing for diagrams that
don't ask for it, and Pele still does every pixel of the drawing. The
motivating user is this package.

### 2. The Obsidian plugin bundles Pele instead of mermaid

Even if the plugin can't reach the copy of Pele that Obsidian bundles,
its own copy (~230 kB gzip, no dependencies) costs far less than
mermaid, and it looks and feels like the rest of Obsidian because it
*is* the same renderer, not an imitation of it. The plugin depends on
this package (track 3, phase 1) in place of `mermaid-layout-circular`.
That change is made and recorded in `obsidian-mermaid-circular`.

### 3. This package, in two phases

**Phase 1: the wrapper. Works now, asks nothing of anyone.**
Register a `flowchart` diagram that reuses Pele's flowchart `parse`
and hands every diagram back to Pele's `render`, except those whose
config says `layout: circular` (or `circular-ccw`). Those are placed
by the circular placement math and drawn by this package.

The cost is the drawing. Pele's drawing helpers (shapes, markers,
labels, CSS-variable theming) aren't exported, so this package has to
draw these itself and keep matching Pele's look by hand as Pele
changes. Keep that layer as thin as possible; it's the part phase 2
deletes.

**Phase 2: the hook.** See decision point A.

## Decision points

Each is a fork in time. The table under each says what each branch
causes, and in which repo that work lands and gets recorded.

### A. Does Pele accept the layout hook?

Waits on the Pele maintainers' response to track 1.

| Branch | Consequence | Lands in |
| --- | --- | --- |
| Accepted | Phase 2: this package shrinks to a layout registration; the wrapper and hand-matched drawing are deleted. | this repo |
| Accepted, changed | Same, against whatever interface they ship. | this repo |
| Declined or no answer | Phase 1 is the long-term answer; the hand-matched drawing is maintained. | this repo |

No branch of A touches `mermaid-layout-circular`.

### B. How is the placement math shared?

Needed before phase 1 gets far. Ordered from least to most change to
`mermaid-layout-circular`:

| Branch | Consequence | Lands in |
| --- | --- | --- |
| Copy | This repo starts from a copy of `layout.ts`; the two drift apart and fixes are made twice. | this repo only |
| Import | `mermaid-layout-circular` adds an export of `circularLayout`; this package depends on a package named for, and with a peer dependency on, mermaid. | both |
| Extract | A third, renderer-neutral package holds the math; both layouts depend on it. Cleanest end state, biggest change. | new package, then both |

Whichever is chosen, the mermaid-specific tuning (arrowhead clear
runs) becomes a setting wherever the shared math lives. The test for
any change to `mermaid-layout-circular`: would it be right for the
mermaid layout on its own? If so, it's recorded there, in its own
`docs/DECISIONS.md`, when it's made.

### C. What happens to options that don't translate?

`look: handDrawn` first among them; Pele doesn't apply mermaid themes
or HTML labels. Affects this repo only.

### D. Is circular a layout, or a diagram type?

Open, not to be answered now. See `DECISIONS.md`. If it is ever
answered "diagram type", the consequences reach both layouts and the
Pele hook's shape, and would be recorded in each repo as they happen.
