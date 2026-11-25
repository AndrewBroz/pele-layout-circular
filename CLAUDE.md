# pele-layout-circular

The circular layout for Pele. Read `README.md`, `docs/PLAN.md` and
`docs/DECISIONS.md` first.

## Where work belongs

- The placement math lives in `../layout-circular`. Change it there,
  never by copying it here.
- The mermaid codebase's layout is `../mermaid-layout-circular`.
- Record each decision in the repo where the change is made, when it
  is made. `docs/PLAN.md` holds the decision points ahead.

## Rules

- No runtime dependencies. Pele is a peer, used for types only;
  layout-circular is compiled into the bundle.
- The wrapper reads Pele's SVG by its class names and `data-id`s.
  Values copied from Pele's source (the arrow size, marker shapes,
  edge ids) say where they come from, so they can be checked when
  Pele changes.
- Tests render through real Pele.

## Gates

`npm test`, `npm run lint` and `npm run build`, all green before
committing.
