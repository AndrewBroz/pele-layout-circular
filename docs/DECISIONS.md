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
- **2026-11-25 — Phase 1: Pele draws, the wrapper moves.** Pele's
  drawing helpers aren't exported, so the wrapper doesn't redraw
  nodes. Pele renders the diagram with its own layout first. The
  wrapper reads that SVG by its class names and `data-id`s, which
  Pele's CSS themes already depend on. It keeps every node, edge label
  and group box as Pele drew them, moves each to its place on the
  circle, and redraws only the edges and their markers. Node sizes
  come from the extent of each node's own markup, arcs sampled along
  their curve, so arrowheads land on the outline Pele drew. Group
  boxes keep the room Pele left around their contents on each side. A
  title is measured by Pele itself: an empty flowchart with only the
  title is exactly as wide as the title needs. What is copied from
  Pele's source (the arrow size and marker shapes, edge ids, marker
  types per edge type) is small and names its origin. The default
  10px `tail` suits Pele too: it outreaches Pele's 8px arrowhead.
  Not handled yet: edges into collapsed subgraphs, and the casings
  Pele draws where an edge crosses a filled group.
- **2026-11-25 — Types are bundled; the core is compiled in.** Like
  mermaid-layout-circular, the build bundles the type declarations
  (`dts-bundle-generator`, inlining layout-circular), so the published
  types import only from `pele`. The JavaScript bundle imports nothing
  at runtime. Until layout-circular has a remote, it is installed from
  `../layout-circular`, which CI on GitHub can't resolve.
- **2026-11-25 — The core installs from GitHub.** With layout-circular
  pushed, the devDependency is `github:AndrewBroz/layout-circular`.
  npm fetches it over HTTPS and builds it on install, so CI resolves
  it; an install with SSH disabled and an empty cache passed every
  test. The lockfile pins the commit.
- **2026-11-25 — Collapsed subgraphs and casings.** Phase 1 left two
  gaps, and both are closed. Pele draws a collapsed subgraph as a node
  and moves each edge end inside it onto that node. The wrapper now
  resolves edge ends the same way, from Pele's `collapsedInto` and
  `outermostCollapsed`, and drops an edge whose two ends collapse into
  one node, as Pele does. Edge ids needed no change: the parser already
  names each edge, so Pele keeps the raw id. Where a redrawn edge
  crosses the border of a filled group, the wrapper draws Pele's casing
  under it, in a `pele-casings` layer between the group boxes and the
  edges. The rules are copied from Pele's `svg/edges.ts` (`fillUnder`,
  `casing`, `casingsSvg`) and `svg/ink.ts` (`paints`), and each copy
  names its source. Only hex colors carry their own alpha in the copy
  of `paints`: the flowchart grammar rejects the parentheses of
  `rgba()`. Still open: an edge into an expanded subgraph is dropped,
  and an edge's color is the one Pele chose in its own layout, even
  where the circle moves the edge into or out of a filled group.
- **2026-11-25 — A demo gallery, kept out of the package.** `npm run
  dev` serves `demo/`. It renders each case twice, through
  `withCircularLayout` and in Pele's own layout beside it, and has a
  light and dark toggle for the `--pele-*` colors. A person uses it for
  repeatable visual checks of both layouts and both themes. `demo/` is
  outside the library build (its entry is `src/`) and outside the
  published `files`. `npm run lint` type-checks it with its own
  tsconfig, which adds the DOM types so `src/` itself can't use them
  by accident.
- **2026-11-25 — The core comes from npm.** layout-circular is
  published, so the devDependency is `layout-circular@^0.1.0` from npm
  instead of the GitHub repository. Installs no longer build the core
  from a git checkout. The range starts at 0.1.0 rather than 0.1.1
  because the core's 0.1.1, published by its workflow, was not yet
  visible on the registry; the two have the same code. 0.1.1 of this
  package is its first release from the workflow, which validates its
  trusted publisher.
- **2026-11-25 — Edge color follows the circle.** An edge kept the
  stroke and marker color Pele chose in its own layout. Once the circle
  moved it into or out of a filled group, that color was stale: a light
  fill in dark mode left the edges inside it nearly invisible. Each
  redrawn edge now gets its ink from its new path, as Pele's
  `overFills` does. Over a fill, the edge's group and markers take the
  color Pele gives a line over that fill. Across a fill's border, it
  gets a casing and keeps its plain color. Off every fill, it keeps its
  plain color. Pele's stale `stroke=` on the edge group is removed. The
  plain color is the one on Pele's markers, or the theme's line color
  where Pele had inked the edge: an inked edge has no stroke color of
  its own. The rules are copied from Pele's `svg/edges.ts` (`fillUnder`,
  `overFills`, `edgeInk`) and `svg/ink.ts` (`ink`, `color`, `opacity`),
  and the copy of `paints` moved beside them into `src/ink.ts`. As in
  Pele, an edge over a fill gets a casing instead of an ink where its
  own style sets a stroke, or where the fill's ink is unknown. Only hex
  and named colors are read, as before.
- **2026-11-25 — `curve: linear` draws straight edges.** A diagram
  whose config sets `flowchart.curve: linear` gets the core's
  `edges: 'straight'`: the ring becomes a polygon, and a three-cycle a
  triangle. The owner chose this knob over a new layout name, for the
  reasons recorded in layout-circular's DECISIONS. Pele already reads
  `flowchart.curve` from frontmatter, for its own layout. Only
  `linear` maps; every other curve keeps the arcs. Like
  `circular-ccw`, the diagram's own config outranks options set in
  code. A per-edge `curve` is not read. The demo gallery has a case
  for it. This needs a release of layout-circular with the `edges`
  option.
- **2026-11-25 — Parallel lines 8px apart.** layout-circular's
  `parallelGap` sets how far apart parallel straight edges sit. Its
  default, 10, is sized for mermaid's arrowheads. The wrapper passes
  8: Pele's head is 8px long and 0.42 of that wide on each side of its
  line, so 8px leaves about 4px of daylight to the sibling line.
  Options set in code still override it.
- **2026-11-25 — Chords are straight.** layout-circular now draws every
  chord, an edge between ring nodes that aren't neighbors, as a
  straight line in both edge modes, and drops its `bow` and `swerve`
  options. The decision is recorded in layout-circular's DECISIONS.
  Nothing in this package's drawing changes: it draws the core's
  points as a polyline, so a straight chord comes out straight. A test
  through real Pele checks it. The README's options example now uses
  `parallelGap`. Of the demo cases, only "a chord shortcut and edge
  labels" changes. This needs layout-circular 0.2.0, so the
  devDependency moves to `^0.2.0` when that is published.
- **2026-11-25 — Group shapes come from the core.** The wrapper drew
  each group box as the union of where its members landed, keeping the
  room Pele's layout left on each side. Nothing kept that box off
  other nodes or boxes. In the water cycle, Land covered Evaporation
  and the two boxes all but touched. In a ring of four with a group of
  two, a ring neighbor sat on the title. layout-circular now places
  group shapes, strategy D2 from the prototype gallery (its DECISIONS
  entry "Group shapes are placed here, the book designer's way"). The
  wrapper reads each group's padding and title from Pele's drawing and
  passes them with the group's parent. The sides take Pele's tight
  group padding, 12px, or less where the drawing shows less. Pele's
  layout often leaves 40px, and the prototype the owner chose from hugs
  at 12. The top is Pele's title room, the label's height plus 8px
  above and below it, read from the title's baselines. A one-line
  title's width reads back from where Pele placed it, 6px inside the
  side padding Pele drew, 20px, or 12 when it drew tight. A box is
  drawn at the core's rect. A band replaces the
  group's rect with a path, keeping every attribute but the rect's
  geometry, so theming and fills apply. Its title moves to the core's
  title point. Pele inks a title for its own fill, but a band's title
  sits outside it, so it takes the ink of what is behind it: the page,
  or a parent band's fill. A band's fill carries the band, so the edge
  ink and casings test its curved area, not its bounds. A box title
  takes the first of Pele's three spots along its edge that no redrawn
  edge crosses, or else the core's spot, chosen clear of every route.
  The core puts a box's title room at the top, or at the
  bottom where spokes or chords cross the top, as in the wheel. The
  water cycle and the ring of four no longer
  overlap. All 14 demo cases without a subgraph, and three more
  diagrams, render byte-identical to main built with the same core.
  One existing ink test
  changed: it relied on a box covering a non-member, the bug this
  fixes.
- **2026-11-25 — On layout-circular 0.2.0.** The devDependency moves to
  `^0.2.0`, which brings straight edges, straight chords, parallel
  labels and group shapes from npm. The three branches that waited on
  it (straight edges, straight chords, group shapes) are merged.
- **2026-11-25 — The docs show pictures, and a script draws them.**
  The README had no pictures and led with a feature list. It now opens
  with what the package does and one picture, then install, then the
  common cases (straight edges, groups), then a grid of six shapes.
  The internals moved to `docs/HOW-IT-WORKS.md`, and every picture's
  source is in `docs/GALLERY.md`. This follows the family's docs plan
  and `../layout-circular/docs/DOCS-STYLE.md`. `scripts/render-docs.ts`
  draws each demo case that has a `doc` name with real Pele in Node,
  from the build, and puts it on a white card with a thin gray border
  so it reads on GitHub's dark theme. It sets `--pele-font` to
  Helvetica, Arial and Liberation Sans: they share Arial's metrics,
  which match the sans-serif metrics Pele measures with, so labels fit
  on macOS, Windows and Linux. It needs Node 22.18 or later, which runs
  TypeScript directly. Eight cases were added to the demo for the
  pictures. The parallel-lines case writes its edges one per line:
  with `B --> C` written twice, Pele drew three lines. The "Not
  handled yet" heading is now "Limits", and its title item now says
  what the code does: with every Pele spot crossed, a box title takes
  the core's spot, not the left.
- **2026-11-25 — No arrowhead is cased; a line is inked stretch by
  stretch.** An edge whose arrowhead ends in a filled group got Pele's
  casing under its line and its markers. The casing haloed the
  arrowhead: a pale smudge over a light fill in light mode, a dark
  outline in dark mode. The owner saw it on an Idea to Spec arrow
  entering a band, and judged it a defect. Pele's own layout does the
  same for an edge into a filled subgraph, so the defect is upstream
  too. Three fixes were rendered in both themes. A casing only on the
  stretch around the crossing left a dark knot on the line in dark
  mode, and a long dark sliver where an arc crosses a border at a
  shallow angle. Dropping the casing under the markers alone left a
  light gray arrowhead on a pale fill in dark mode. The fix taken
  splits a line where it crosses a fill's border. Each stretch takes
  the ink of the innermost fill under it, as Pele inks a whole line
  over a fill, and the plain color off every fill. Each marker takes
  the color of the stretch it ends. Every stretch then reads on its
  own surface, so a crossing needs no casing, and the line simply
  passes over the border. A line in one stretch is drawn as before,
  its ink on its group. A line in several has one path per stretch,
  each with its own `stroke`, and a dotted line's later paths carry a
  `stroke-dashoffset` that keeps the dashes in step. A casing is left
  only under a stretch over a fill whose ink isn't used: the line
  sets its own stroke, or the fill's ink is unknown. That casing never
  holds a marker, and it stops a casing's round end and a pixel short
  of the marker's back. `paintLine` replaces the copies of Pele's
  `fillUnder` and `overFills`. This departs from Pele's look on
  purpose, and the casing tests now check the departure.
- **2026-11-25 — No casings at all; markers are inked at the tip.**
  Review of the first fix found the casings that remained were still
  defects. A line with its own stroke, or over a faint fill, kept a
  casing that ended in a round knob a few pixels before a bare
  arrowhead. Over a faint fill in dark mode, it read as tram tracks.
  Those casings are gone. Such a line keeps its own or plain color,
  uncased. Over a faint fill, the page shows through more than half,
  so the plain color, chosen for the page, still reads. That was
  checked in both themes. The casing layer, and its copies of Pele's
  `casing` and `casingsSvg`, are removed. A marker now takes the ink
  under its tip, not under the line's trimmed end, which can lie on
  the other side of a border. A search of about two thousand ring,
  hub and chord diagrams found no layout that puts a border inside an
  arrowhead, so a synthetic test covers it. Where a solid line's
  stretches met, their round ends overlapped, and a stroke-opacity
  darkened the overlap. Those paths now have butt ends, and the two
  outer ends are pushed out half a line width, to reach as far as
  round ones. A dashed line keeps its round ends, and each join moves
  to the middle of the nearest dash gap, so no dash breaks in two.
  The color change sits at most half a dash period from the border.
  An inked stretch of a split line still carries its ink as the
  path's own `stroke`. A group-level CSS `stroke` can't recolor one
  stretch of a line and leave another stretch alone, so CSS aimed at
  `.pele-edge` no longer recolors that stretch. HOW-IT-WORKS says to
  aim at `.pele-edge path`. A line in one stretch keeps its ink on
  the group, as in Pele.
- **2026-11-26 — Groups by fit, from layout-circular 0.3.0.** The
  devDependency is `^0.3.0`. The core now picks a group's shape by fit.
  A group is a box when one clears, however much of the ring it covers.
  A box may put its title below at a turn that can't clear with titles
  on top. A group is a band only when no box fits. The owner picked
  this from renders; it is provisional and may change. Bands are drawn
  as before. The band tests use a hub outside a four-of-six group,
  since the six-of-eight "Funded" diagram is a box now. The test of ink
  on an arc bowed past its box became a test that the arcs stay inside:
  the core's box now holds them. The docs show a band with `hub-band`
  and a nested band with `hub-nested-band`. `lifecycle-band.svg` and
  `nested-band.svg` stay until the next release, because the npm README
  loads its pictures from `main`.
