export interface Case {
  title: string;
  wide?: boolean;
  /** The layout the circular pane asks for; defaults to circular. */
  layout?: 'circular' | 'circular-ccw';
  /** Extra top-level frontmatter lines, such as a title. */
  frontmatter?: string;
  /** The flowchart body, with no frontmatter. */
  body: string;
}

const waterCycle = `flowchart LR
  E[Evaporation] --> C[Condensation]
  C --> P[Precipitation]
  P --> R[Runoff]
  R --> O[Collection]
  O --> E
`;

export const cases: Case[] = [
  { title: 'a pure cycle: the water cycle', body: waterCycle },
  { title: 'the same cycle counter-clockwise (circular-ccw)', layout: 'circular-ccw', body: waterCycle },
  {
    title: 'a chord shortcut and edge labels',
    wide: true,
    body: `flowchart LR
  W[Wake] -->|coffee| Wk[Work]
  Wk -->|lunch| M[Meetings]
  M -->|escape| F[Focus]
  F -->|dusk| Hm[Home]
  Hm -->|sleep| W
  Wk -.->|skip the day| Hm
`,
  },
  {
    title: 'mixed shapes and sizes',
    wide: true,
    body: `flowchart LR
  A([A very long stadium node label]) --> B{Decide}
  B --> C((C))
  C --> D[Plain]
  D --> E[[Subroutine with a long name]]
  E --> A
  D --> F>Flag]
`,
  },
  {
    title: 'a titled diagram',
    wide: true,
    frontmatter: 'title: The water cycle\n',
    body: waterCycle,
  },
  {
    title: 'self-loop and an opposite edge',
    body: `flowchart LR
  A[Draft] --> B[Review]
  B --> A
  B --> C[Publish]
  C --> A
  A --> A
`,
  },
  {
    title: 'a Krebs-style cycle with inputs and outputs',
    wide: true,
    body: `flowchart LR
  A[Citrate] --> B[Isocitrate] --> C[Ketoglutarate] --> D[Succinyl-CoA]
  D --> E[Succinate] --> F[Fumarate] --> G[Malate] --> H[Oxaloacetate] --> A
  AcCoA[Acetyl-CoA] --> A
  C --> CO2a[CO2]
  D --> CO2b[CO2 again]
  G --> NADH
`,
  },
  {
    title: 'hub and spoke',
    wide: true,
    body: `flowchart LR
  Hub[Registry] --> A[Alpha]
  Hub --> B[Bravo]
  Hub --> C[Charlie]
  Hub --> D[Delta]
  Hub --> E[Echo]
  B --> L[Bravo's log]
`,
  },
  {
    title: 'a wheel: the ring keeps its shape, the axle takes the middle',
    wide: true,
    body: `flowchart LR
  A[Plan] --> B[Build] --> C[Test] --> D[Ship] --> E[Watch] --> F[Learn] --> A
  A --> Hub[Vision]
  B --> Hub
  C --> Hub
  D --> Hub
  E --> Hub
  F --> Hub
`,
  },
  {
    title: 'Captain Planet: a wheel missing a rim arc, meshing a gear',
    wide: true,
    body: `flowchart TB
  P[Captain
  Planet!]
  Earth <--> P
  Fire <--> P
  Wind <--> P
  Water <--> P
  Heart <--> P
  Heart <--> Water
  Heart <--> Earth
  Earth <--> Fire
  Fire <--> Wind
  Water <--> Vapor
  Vapor <--> Ice
  Ice <--> Water
`,
  },
  {
    title: 'a satellite: the debug loop hangs off Build',
    wide: true,
    body: `flowchart LR
  P[Plan] --> B[Build] --> S[Ship] --> L[Learn] --> P
  B --> D[Debug]
  D --> F[Fix] --> T[Test] --> D
`,
  },
  {
    title: 'a figure-eight: two cycles sharing Sleep',
    wide: true,
    body: `flowchart LR
  W[Wake] --> K[Work] --> N[Dine] --> S[Sleep] --> W
  S --> R[Dream] --> T[Toss] --> S
`,
  },
  {
    title: 'three gears: each loop spins against the one it meshes with',
    wide: true,
    body: `flowchart LR
  A[Mine] --> B[Smelt] --> C[Cast] --> D[Sell] --> E[Invest] --> A
  B --> F[Scrap]
  F --> G[Sort] --> B
  F --> H[Shred]
  H --> I[Melt] --> F
`,
  },
  {
    title: 'a spur and a satellite on one node',
    wide: true,
    body: `flowchart LR
  P[Plan] --> B[Build] --> S[Ship] --> L[Learn] --> P
  B --> D[Debug]
  D --> F[Fix] --> T[Test] --> D
  B --> Log[Build log]
  S --> Notes[Release notes]
`,
  },
  {
    title: 'subgraphs on the cycle: each box wraps one arc',
    wide: true,
    body: `flowchart LR
  E[Evaporation] --> C[Condensation]
  subgraph Atmosphere
    C --> P[Precipitation]
  end
  P --> R[Runoff]
  subgraph Land
    R --> O[Collection]
  end
  O --> E
`,
  },
  {
    title: 'a subgraph around a pendant cycle',
    wide: true,
    body: `flowchart LR
  P[Plan] --> B[Build] --> S[Ship] --> L[Learn] --> P
  B --> D[Debug]
  subgraph The debug loop
    D --> F[Fix] --> T[Test] --> D
  end
`,
  },
];

/** The diagram's source as the circular pane renders it. */
export const circularSource = (c: Case): string =>
  `---\n${c.frontmatter ?? ''}config:\n  layout: ${c.layout ?? 'circular'}\n---\n${c.body}`;

/** The same diagram with no layout line: Pele draws it its own way. */
export const peleSource = (c: Case): string =>
  c.frontmatter ? `---\n${c.frontmatter}---\n${c.body}` : c.body;
