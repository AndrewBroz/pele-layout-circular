# pele-layout-circular

A circular layout for [Pele](https://pele.run) flowcharts. Write an
ordinary flowchart, set `layout: circular`, and the nodes are placed
evenly around a circle, with edges drawn as arcs of that same circle.
A chord, an edge between ring nodes that aren't neighbors, is a
straight line across the ring. A clear hub moves to the center, side
branches hang off radially, and a cycle hanging off the ring becomes its
own smaller circle.

```
---
config:
  layout: circular
---
flowchart LR
  E[Evaporation] --> C[Condensation]
  C --> P[Precipitation]
  P --> R[Runoff]
  R --> O[Collection]
  O --> E
```

`layout: circular-ccw` runs counter-clockwise. Every other flowchart
renders exactly as Pele renders it.

For straight edges, set the flowchart's curve to `linear`:

```
---
config:
  layout: circular
  flowchart:
    curve: linear
---
flowchart LR
  A[Plan] --> B[Build] --> C[Ship] --> A
```

Each edge between ring nodes is then a straight line from border to
border, so a three-cycle reads as a triangle. Only `linear` selects
straight edges. Every other curve keeps the arcs. It works with
`circular-ccw` too. Two opposite edges become two parallel lines, 8px
apart. A straight chord across a ring with a hub runs through the hub,
where arcs would swerve around it.

This is the Pele counterpart of
[mermaid-layout-circular](https://github.com/AndrewBroz/mermaid-layout-circular).
Both build from [layout-circular](https://github.com/AndrewBroz/layout-circular),
the shared placement math.

## Usage

Register the wrapped flowchart once, before rendering:

```ts
import { register } from 'pele';
import flowchart from 'pele/diagrams/flowchart';
import { withCircularLayout } from 'pele-layout-circular';

register(withCircularLayout(flowchart));
```

The second argument takes the layout's options, such as
`{ spacing: 60, parallelGap: 8 }`. Their defaults are `CircularLayoutOptions`
in layout-circular. When no option sets it, `spacing` comes from the
diagram's `flowchart.nodeSpacing`. A diagram that says
`layout: circular-ccw` runs counter-clockwise whatever the options say.

## How it works

Pele has no public way to plug in a layout, so this package wraps
Pele's flowchart diagram. For a circular diagram, Pele first draws it
with its own layout. The wrapper keeps Pele's drawing of every node,
edge label and group box, moves each to its place on the circle, and
redraws the edges along it. Pele's shapes, theming and CSS hooks carry
over unchanged.

A layout hook for Pele is proposed in
[obsidianmd/pele#163](https://github.com/obsidianmd/pele/pull/163).
If it lands, this package becomes a plain layout registration.

## Not handled yet

- An edge that points at a subgraph itself, rather than a node inside
  it, is dropped. Edges into a collapsed subgraph are drawn.
- Two sibling subgraphs on the cycle can touch or overlap near the
  ring's middle. The demo gallery shows it in the "subgraphs on the
  cycle" case, the water cycle with Atmosphere and Land.

## Demo

`npm run dev` serves a gallery of cases. Each renders twice: through
`withCircularLayout`, and in Pele's own layout beside it. The button
at the top switches the `--pele-*` colors between light and dark. The
page takes `?theme=dark` too. `demo/` is not part of the library build
or the published package.

## Development

`layout-circular` is a devDependency from npm that the build compiles
in. To work on both at once, `npm link` a local checkout of the core.

Three gates, all green before committing changes to `src/`:

```sh
npm test        # vitest, rendering through real Pele
npm run lint    # eslint, then tsc
npm run build   # vite library build plus bundled type declarations
```

## License

MIT
