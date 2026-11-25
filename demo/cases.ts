export interface Case {
  title: string;
  wide?: boolean;
  /** The layout the circular pane asks for; defaults to circular. */
  layout?: 'circular' | 'circular-ccw';
  /** The flowchart curve; 'linear' draws straight edges. */
  curve?: string;
  /** Extra top-level frontmatter lines, such as a title. */
  frontmatter?: string;
  /** The flowchart body, with no frontmatter. */
  body: string;
  /** The base name of this case's picture in docs/media, if it has one. */
  doc?: string;
  /** The base name of a picture of the same text drawn by Pele's own
   *  layout, if the docs show one. */
  docPele?: string;
}

const waterCycle = `flowchart LR
  E[Evaporation] --> C[Condensation]
  C --> P[Precipitation]
  P --> R[Runoff]
  R --> O[Collection]
  O --> E
`;

export const cases: Case[] = [
  { title: 'a pure cycle: the water cycle', doc: 'water-cycle', docPele: 'water-cycle-pele', body: waterCycle },
  {
    title: 'the same cycle counter-clockwise (circular-ccw)',
    doc: 'water-cycle-ccw',
    layout: 'circular-ccw',
    body: waterCycle,
  },
  {
    title: 'straight edges (curve: linear): a triangle, an opposite pair, a label',
    curve: 'linear',
    body: `flowchart LR
  A[Plan] -->|then| B[Build] --> C[Ship] --> A
  C --> B
`,
  },
  {
    title: 'a chord shortcut and edge labels',
    doc: 'daily-arcs',
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
    title: 'the chord shortcut with straight edges (curve: linear)',
    doc: 'daily-straight',
    wide: true,
    curve: 'linear',
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
    title: 'two opposite straight edges: parallel lines, labels aside',
    doc: 'parallel-lines',
    curve: 'linear',
    body: `flowchart LR
  A[Plan] -->|then| B[Build]
  C[Ship] --> A
  B -->|ready| C
  C -->|fix| B
`,
  },
  {
    title: 'the parts: a ring, a chord, a branch and a satellite',
    doc: 'anatomy',
    wide: true,
    body: `flowchart LR
  P[Plan] --> B[Build] --> T[Test] --> S[Ship] --> L[Learn] --> P
  B -.->|skip tests| S
  I[Idea] --> P
  T --> D[Debug] --> F[Fix] --> R[Retest] --> D
`,
  },
  {
    title: 'branches hang off the ring',
    doc: 'branches',
    wide: true,
    body: `flowchart LR
  P[Plan] --> B[Build] --> S[Ship] --> L[Learn] --> P
  I[Idea] --> P
  S --> N[Release notes]
  B --> G[Build log]
`,
  },
  {
    title: 'mixed shapes and sizes',
    doc: 'mixed-shapes',
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
    doc: 'self-loop',
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
    doc: 'krebs',
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
    doc: 'hub',
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
    doc: 'wheel',
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
    doc: 'captain-planet',
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
    doc: 'satellite',
    wide: true,
    body: `flowchart LR
  P[Plan] --> B[Build] --> S[Ship] --> L[Learn] --> P
  B --> D[Debug]
  D --> F[Fix] --> T[Test] --> D
`,
  },
  {
    title: 'a figure-eight: two cycles sharing Sleep',
    doc: 'figure-eight',
    wide: true,
    body: `flowchart LR
  W[Wake] --> K[Work] --> N[Dine] --> S[Sleep] --> W
  S --> R[Dream] --> T[Toss] --> S
`,
  },
  {
    title: 'three gears: each loop spins against the one it meshes with',
    doc: 'three-gears',
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
    doc: 'spur-and-satellite',
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
    doc: 'group-satellite',
    wide: true,
    body: `flowchart LR
  P[Plan] --> B[Build] --> S[Ship] --> L[Learn] --> P
  B --> D[Debug]
  subgraph The debug loop
    D --> F[Fix] --> T[Test] --> D
  end
`,
  },
  {
    title: 'a small subgraph is a box',
    doc: 'lifecycle-box',
    wide: true,
    body: `flowchart LR
  I[Idea] --> S[Spec] --> D[Design]
  subgraph Make
    B[Build]
    T[Test]
  end
  D --> B --> T --> P[Deploy] --> M[Monitor] --> R[Retire] --> I
`,
  },
  {
    title: 'a subgraph spanning most of the ring is a band',
    doc: 'lifecycle-band',
    wide: true,
    body: `flowchart LR
  I[Idea]
  subgraph Funded
    S[Spec]
    D[Design]
    B[Build]
    T[Test]
    P[Deploy]
    M[Monitor]
  end
  I --> S --> D --> B --> T --> P --> M --> R[Retire] --> I
`,
  },
  {
    title: 'a subgraph nested in a band is a band too, its title between the two',
    doc: 'nested-band',
    wide: true,
    body: `flowchart LR
  P[Plan]
  subgraph Engineering
    D[Design]
    subgraph CI
      C[Code]
      T[Test]
    end
    R[Release]
  end
  P --> D --> C --> T --> R --> V[Review] --> P
  style CI fill:#ffd
`,
  },
  {
    title: 'spokes cross the top of a box, so its title moves to the bottom',
    doc: 'title-bottom',
    wide: true,
    body: `flowchart LR
  Hub[Registry] --> A[Alpha]
  Hub --> B[Bravo]
  Hub --> C[Charlie]
  Hub --> D[Delta]
  Hub --> E[Echo]
  Hub --> F[Foxtrot]
  subgraph Archive
    C
    D
  end
`,
  },
];

/** The diagram's source as the circular pane renders it. */
export const circularSource = (c: Case): string =>
  `---\n${c.frontmatter ?? ''}config:\n  layout: ${c.layout ?? 'circular'}\n${
    c.curve ? `  flowchart:\n    curve: ${c.curve}\n` : ''
  }---\n${c.body}`;

/** The same diagram with no layout line: Pele draws it its own way. */
export const peleSource = (c: Case): string => {
  const config = c.curve ? `config:\n  flowchart:\n    curve: ${c.curve}\n` : '';
  const front = `${c.frontmatter ?? ''}${config}`;
  return front ? `---\n${front}---\n${c.body}` : c.body;
};
