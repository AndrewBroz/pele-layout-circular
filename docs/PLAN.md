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
  its own copy of mermaid (3,163,104 bytes minified, 860,568 gzipped,
  measured on the plugin's own bundle) to draw circular diagrams
  styled to look like Pele's. It needed nothing from Obsidian or the
  Pele developers. Track 2 is built on branch `feat/pele-inside` of
  `obsidian-mermaid-circular` and is not yet merged.
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
its own copy costs far less than mermaid. The original estimate was
~230 kB gzip. The switch measured 187,521 bytes minified and 74,024
gzipped (branch `feat/pele-inside` of `obsidian-mermaid-circular`, not
yet merged). Pele has no dependencies. The plugin looks and feels like the rest of Obsidian because it
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

Built 2026-11-25. The layer is thinner than planned: Pele draws the
diagram first, and the wrapper keeps Pele's drawing of nodes, labels
and groups, redrawing only the edges (see `DECISIONS.md`).

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

**Decided 2026-11-25: Extract, as a self-contained core built to be
copied** (see `DECISIONS.md`). It's compiled into each layout's bundle,
never shipped as a runtime dependency, because both possible upstreams
take in outside layout code as source. The branches as they stood:

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
or HTML labels. Open. Researched 2026-11-25 against Pele 1.13.0
(`main` at `3a2f075`), its
[compatibility page](https://pele.run/compatibility), and diagrams
rendered through the installed Pele with and without the wrapper.

The wrapper keeps Pele's drawing of nodes, labels and groups. So an
option reaches a circular diagram as far as Pele honors it. The
exceptions are options about placement and edges, which the wrapper
replaces. Pele's `render()` returns the SVG, its size and its links;
it has no channel for warnings. Pele drops what it doesn't support
without a word, and lists the differences on its compatibility page.

What each option does today:

| Option | Pele | `mermaid-layout-circular` | This wrapper today |
| --- | --- | --- | --- |
| `look: handDrawn` | Ignored. The flowchart never reads `look`. | Drawn hand-drawn, nodes and edges. | Ignored, silently. The SVG is identical to one without it. |
| `theme`, `themeVariables` | Mermaid themes don't apply. `themeVariables` colors only feed chart palettes. Colors come from `--pele-*` CSS variables. | Applied by mermaid. | Ignored, silently. Colors follow Pele's CSS variables. |
| `htmlLabels` | Labels are SVG text, never HTML. Markdown bold, italic and line breaks work. | Mermaid's labels. | As Pele: Pele's labels are kept. |
| `flowchart.curve`, an edge's `curve` | Shapes Pele's routes (`linear`, `step…`). | The arc's samples go through mermaid's `insertEdge`. | Ignored, silently. Edges are arcs either way. |
| `flowchart.rankSpacing` | The gap between ranks. | No ranks. | No effect. A circle has no ranks. |
| `flowchart.nodeSpacing` | The gap between nodes. | Seeds `spacing`. | Seeds `spacing`. Honored. |
| `flowchart.wrappingWidth` | Where labels wrap. | Mermaid wraps. | Honored. Pele wraps, the wrapper keeps the size. |
| `classDef`, `style`, `linkStyle` | Applied. | Applied. | Carried over. Node styles stay in Pele's markup; an edge's stroke and marker color go onto the redrawn edge. |
| A subgraph's `direction` | Lays out the group's inside. | Not used. | Ignored for placement. |
| An edge's `animate` | Not drawn in flowcharts. | Mermaid's edge code. | As Pele: not drawn. |
| Another `layout:` (`elk`, `dagre`) | Ignored; Pele's own layout. | Not ours. | Handed to Pele unchanged. |

Most rows need nothing. Placement options (`curve`, `rankSpacing`, a
subgraph's `direction`) mean nothing on a circle. Styles and labels
already come through, because Pele draws them. What's left is the look
and the theme: `look: handDrawn`, `theme` and `themeVariables`. Today
Obsidian's plugin draws circular diagrams with its own mermaid and
keeps a diagram's `look:` and `theme:` (its README). Track 2 would
lose that. Track 2 is now built, on branch `feat/pele-inside` of
`obsidian-mermaid-circular`, and is not yet merged. It drops mermaid.
If it merges as is, the plugin takes the "Ignore silently" branch and
"Fall back to mermaid" is ruled out. The owner hasn't decided.

The responses, which can be mixed per option:

| Branch | Consequence | Lands in |
| --- | --- | --- |
| Ignore silently | Today's behavior. No code, and it matches Pele. The cost: an author who wrote `look: handDrawn` gets a clean drawing and no hint why. | this repo |
| Document | Ignore, plus a list in the README of what a circular diagram drops, the way Pele's compatibility page does. The cost: the list is kept up as Pele changes. | this repo |
| Warn | `console.warn` names the option. Mermaid logs a warning when a layout isn't registered, and `mermaid-layout-circular` when it drops an edge; mermaid's default log level hides both. The cost: Pele has no warnings channel, so the console is the only place, and Obsidian readers never open it. A `<desc>` in the SVG would be read aloud by screen readers. | this repo |
| Fall back to Pele's layout | A circular diagram that asks for an unsupported look is handed to Pele whole. Mermaid falls back to dagre for an unknown layout. The cost: the author loses the circle, which they asked for by name, for the sake of a lesser option. | this repo |
| Fall back to mermaid | The Obsidian plugin keeps its mermaid copy for circular diagrams that set `look:` or `theme:`. The cost: the plugin keeps its mermaid bundle (3,163,104 bytes minified, 860,568 gzipped) that track 2 sets out to drop, and two renderers to keep alike. This row and the plugin's support for Obsidian 1.13 and 1.14 are one decision. The branch raised `minAppVersion` to 1.15.0. Keeping the old 1.13/1.14 path, which used Obsidian's own mermaid plus `mermaid-layout-circular`, would cost about 20-25 KB. | `obsidian-mermaid-circular` |
| Approximate | For `handDrawn`, the wrapper adds a seeded SVG displacement filter, or jitters the edges it redraws. For `theme`, named themes map to `--pele-*` values. The cost: an imitation that drifts from mermaid's look and Pele's both. A filter roughens text too. And it is hand-matched drawing, the layer phase 2 deletes: a layout behind the hook can't draw. | this repo |
| Ask Pele | An issue asking Pele for `look: handDrawn`, for every diagram type. Then this package needs nothing. The cost: it's out of our hands. Pele allows no runtime dependencies and needs identical input to give identical SVG, so it can't use roughjs; it would take a seeded sketch renderer written for Pele. Asked for drop shadows and animations (issue #24), the maintainer said looks don't belong in core, and that Pele's CSS hooks are built for them. | Pele, then nothing here |

#### Recommendation (not a decision)

Document, for all of it. Name the dropped options in the README beside
"Not handled yet", and point to Pele's compatibility page. That is the
convention Pele readers already know.

For `look: handDrawn` alone, add a warning. It is the one option an
author writes on purpose and then sees no trace of. One
`console.warn` per diagram is cheap, and harmless when unread.

Don't fall back to Pele's layout: it trades the circle for the look.
Don't approximate here: it builds the layer phase 2 removes, and Pele's
CSS hooks already let a host add a sketchy filter itself. Asking Pele
is cheap but unlikely, given issue #24; it fits better as a line in
the track 1 PR than as its own request. Whether the Obsidian plugin
keeps mermaid for hand-drawn diagrams is that plugin's call, and the
owner hasn't made it. If `feat/pele-inside` merges as is, the plugin
takes the ignore branch.

### D. Is circular a layout, or a diagram type?

Open, not to be answered now. See `DECISIONS.md`. If it is ever
answered "diagram type", the consequences reach both layouts and the
Pele hook's shape, and would be recorded in each repo as they happen.
