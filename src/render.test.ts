import { describe, expect, it } from 'vitest';
import { register, render } from 'pele';
import flowchart from 'pele/diagrams/flowchart';
import { overFills } from './render.js';
import { withCircularLayout } from './index.js';
import { attr, childGroups, findGroup, markupBox, withAttr } from './svg.js';

register(withCircularLayout(flowchart));

const circular = (body: string, layout = 'circular') => `---\nconfig:\n  layout: ${layout}\n---\n${body}`;

const RING = 'flowchart LR\n  A[Alpha] --> B[Bravo] --> C[Charlie] --> D[Delta] --> E[Echo] --> A';

interface Node {
  x: number;
  y: number;
  open: string;
  inner: string;
}

const nodesOf = (svg: string): Map<string, Node> => {
  const out = new Map<string, Node>();
  for (const el of childGroups(findGroup(svg, 'pele-nodes')!.inner)) {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.open)!;
    out.set(attr(el.open, 'data-id')!, { x: Number(m[1]), y: Number(m[2]), open: el.open, inner: el.inner });
  }
  return out;
};

/** Each group's shape, as drawn: a box from its rect, or a band from
 *  its path, `M` outer start, outer arc, `L` inner end, inner arc. */
type Shape =
  | { kind: 'box'; x: number; y: number; w: number; h: number }
  | { kind: 'band'; cx: number; cy: number; rIn: number; rOut: number; start: number; sweep: number };
const clustersOf = (svg: string) => {
  const out = new Map<string, Shape>();
  for (const el of childGroups(findGroup(svg, 'pele-clusters')!.inner)) {
    const id = attr(el.open, 'data-id')!;
    const rect = /<rect\b[^>]*>/.exec(el.inner)?.[0];
    if (rect) {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(attr(rect, k)));
      out.set(id, { kind: 'box', x: x!, y: y!, w: w!, h: h! });
      continue;
    }
    const d = attr(/<path\b[^>]*>/.exec(el.inner)![0], 'd')!;
    const n = [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
    // M sx,sy A r,r 0 large 1 ex,ey L ix,iy A q,q 0 large 0 jx,jy Z
    const [sx, sy, rOut, , , large, , ex, ey, , , rIn] = n as number[];
    // The center: on the bisector of the outer chord, rOut from its ends.
    const mx = (sx! + ex!) / 2;
    const my = (sy! + ey!) / 2;
    const half = Math.hypot(ex! - sx!, ey! - sy!) / 2;
    const along = Math.sqrt(Math.max(0, rOut! * rOut! - half * half));
    // Clockwise from start to end; a large arc puts the center on the
    // other side of the chord.
    const nx = -(ey! - sy!) / (2 * half);
    const ny = (ex! - sx!) / (2 * half);
    const side = large ? -1 : 1;
    const cx = mx + nx * along * side;
    const cy = my + ny * along * side;
    const start = Math.atan2(sy! - cy, sx! - cx);
    let sweep = Math.atan2(ey! - cy, ex! - cx) - start;
    while (sweep <= 0) sweep += 2 * Math.PI;
    out.set(id, { kind: 'band', cx, cy, rIn: rIn!, rOut: rOut!, start, sweep });
  }
  return out;
};

/** Whether a shape covers any point of a rect, sampled every 2px. */
const covers = (s: Shape, r: { minX: number; minY: number; maxX: number; maxY: number }) => {
  if (s.kind === 'box') return s.x < r.maxX && s.x + s.w > r.minX && s.y < r.maxY && s.y + s.h > r.minY;
  for (let x = r.minX; x <= r.maxX; x += 2) {
    for (let y = r.minY; y <= r.maxY; y += 2) {
      const rho = Math.hypot(x - s.cx, y - s.cy);
      const into = (((Math.atan2(y - s.cy, x - s.cx) - s.start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (rho >= s.rIn && rho <= s.rOut && into <= s.sweep) return true;
    }
  }
  return false;
};

/** No shape covers a node outside its group, and no two sibling shapes meet. */
const expectClear = (svg: string, members: Record<string, string[]>) => {
  const nodes = nodesOf(svg);
  const shapes = clustersOf(svg);
  expect([...shapes.keys()].sort()).toEqual(Object.keys(members).sort());
  for (const [g, s] of shapes) {
    for (const [id, n] of nodes) {
      if (members[g]!.includes(id)) continue;
      const b = markupBox(n.inner);
      const rect = { minX: n.x + b.minX, minY: n.y + b.minY, maxX: n.x + b.maxX, maxY: n.y + b.maxY };
      expect(covers(s, rect), `${g} covers ${id}`).toBe(false);
    }
    for (const [h, q] of shapes) {
      // A shape wraps the shapes nested in it, so only siblings must part.
      const nested = (a: string, b: string) => members[a]!.every((id) => members[b]!.includes(id));
      if (h <= g || nested(g, h) || nested(h, g) || s.kind !== 'box' || q.kind !== 'box') continue;
      const overlaps = s.x < q.x + q.w && q.x < s.x + s.w && s.y < q.y + q.h && q.y < s.y + s.h;
      expect(overlaps, `${g} meets ${h}`).toBe(false);
    }
  }
};

describe('withCircularLayout', () => {
  it('leaves a flowchart without the layout exactly as Pele draws it', () => {
    const source = RING;
    const wrapped = render(source).svg;
    register(flowchart);
    const plain = render(source).svg;
    register(withCircularLayout(flowchart));
    expect(wrapped).toBe(plain);
  });

  it('seats a cycle on one circle', () => {
    const nodes = [...nodesOf(render(circular(RING)).svg).values()];
    // The circle through the first three centers; the rest must lie on
    // it too. (Angles adapt to node sizes, so the centroid won't do.)
    const [a, b, c] = nodes as [Node, Node, Node];
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const sq = (n: Node) => n.x * n.x + n.y * n.y;
    const cx = (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d;
    const cy = (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d;
    const radii = nodes.map((n) => Math.hypot(n.x - cx, n.y - cy));
    for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 0);
  });

  it("keeps Pele's own drawing of every node", () => {
    const placed = nodesOf(render(circular(RING)).svg);
    const drawn = nodesOf(render(RING).svg);
    for (const [id, n] of drawn) expect(placed.get(id)!.inner).toBe(n.inner);
  });

  it('lands every arrowhead tip on the border of the node it points into', () => {
    const { svg } = render(circular(RING));
    const nodes = nodesOf(svg);
    for (const el of childGroups(findGroup(svg, 'pele-edges')!.inner)) {
      const [, , end] = /^L_(\w+)_(\w+)_\d+$/.exec(attr(el.open, 'data-id')!)!;
      const target = nodes.get(end!)!;
      const box = markupBox(target.inner);
      const marker = /class="pele-marker" d="M([-\d.]+),([-\d.]+)/.exec(el.inner)!;
      const tx = Number(marker[1]) - target.x;
      const ty = Number(marker[2]) - target.y;
      // On a box's outline, one coordinate sits on its wall.
      const onWall = Math.min(Math.abs(Math.abs(tx) - box.maxX), Math.abs(Math.abs(ty) - box.maxY));
      expect(onWall, `tip on ${end}`).toBeLessThan(0.6);
      expect(Math.abs(tx)).toBeLessThanOrEqual(box.maxX + 0.6);
      expect(Math.abs(ty)).toBeLessThanOrEqual(box.maxY + 0.6);
    }
  });

  it('runs counter-clockwise when the diagram asks for circular-ccw', () => {
    const cw = nodesOf(render(circular(RING)).svg);
    const ccw = nodesOf(render(circular(RING, 'circular-ccw')).svg);
    // The first node is on top either way; the second goes right
    // clockwise and left counter-clockwise.
    expect(cw.get('B')!.x).toBeGreaterThan(cw.get('A')!.x);
    expect(ccw.get('B')!.x).toBeLessThan(ccw.get('A')!.x);
  });

  it('keeps every edge label clear of the nodes', () => {
    const { svg } = render(
      circular('flowchart LR\n  W[Wake] -->|coffee| K[Work] -->|lunch| M[Meetings] -->|escape| W\n  K -.->|skip the day| W')
    );
    const nodes = nodesOf(svg);
    const labels = childGroups(findGroup(svg, 'pele-edge-labels')!.inner);
    expect(labels).toHaveLength(4);
    for (const el of labels) {
      const t = /translate\(([-\d.]+),([-\d.]+)\)/.exec(attr(el.open, 'transform') ?? '');
      const rect = /<rect\b[^>]*>/.exec(el.inner)![0];
      const x = Number(attr(rect, 'x')) + (t ? Number(t[1]) : 0);
      const y = Number(attr(rect, 'y')) + (t ? Number(t[2]) : 0);
      const w = Number(attr(rect, 'width'));
      const h = Number(attr(rect, 'height'));
      for (const [id, n] of nodes) {
        const b = markupBox(n.inner);
        const overlaps = x < n.x + b.maxX && x + w > n.x + b.minX && y < n.y + b.maxY && y + h > n.y + b.minY;
        expect(overlaps, `${attr(el.open, 'data-id')} over ${id}`).toBe(false);
      }
    }
  });

  it('wraps each subgraph box around its members', () => {
    const { svg } = render(
      circular('flowchart LR\n  A --> B\n  subgraph Top\n    B --> C\n  end\n  C --> D --> A')
    );
    const nodes = nodesOf(svg);
    const cluster = childGroups(findGroup(svg, 'pele-clusters')!.inner)[0]!;
    const rect = /<rect\b[^>]*>/.exec(cluster.inner)![0];
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(attr(rect, k)));
    for (const id of ['B', 'C']) {
      const n = nodes.get(id)!;
      const b = markupBox(n.inner);
      expect(n.x + b.minX).toBeGreaterThanOrEqual(x!);
      expect(n.x + b.maxX).toBeLessThanOrEqual(x! + w!);
      expect(n.y + b.minY).toBeGreaterThanOrEqual(y!);
      expect(n.y + b.maxY).toBeLessThanOrEqual(y! + h!);
    }
  });

  it("keeps the water cycle's two subgraph boxes apart", () => {
    const { svg } = render(
      circular(
        'flowchart LR\n  E[Evaporation] --> C[Condensation]\n  subgraph Atmosphere\n    C --> P[Precipitation]\n  end\n' +
          '  P --> R[Runoff]\n  subgraph Land\n    R --> O[Collection]\n  end\n  O --> E'
      )
    );
    expectClear(svg, { Atmosphere: ['C', 'P'], Land: ['R', 'O'] });
  });

  it("keeps a ring neighbor off a subgraph's title", () => {
    const { svg } = render(
      circular('flowchart LR\n  A --> B\n  subgraph G [Group]\n    B --> C\n  end\n  C --> D --> A')
    );
    expectClear(svg, { G: ['B', 'C'] });
  });

  it('nests a subgraph box inside its parent', () => {
    const { svg } = render(
      circular(
        'flowchart LR\n  A --> B\n  subgraph Outer\n    B --> C\n    subgraph Inner\n      C --> D\n    end\n  end\n  D --> E --> F --> A'
      )
    );
    expectClear(svg, { Outer: ['B', 'C', 'D'], Inner: ['C', 'D'] });
    const boxes = clustersOf(svg);
    const outer = boxes.get('Outer')!;
    const inner = boxes.get('Inner')!;
    if (outer.kind !== 'box' || inner.kind !== 'box') throw new Error('expected boxes');
    expect(inner.x).toBeGreaterThanOrEqual(outer.x);
    expect(inner.y).toBeGreaterThanOrEqual(outer.y);
    expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w);
    expect(inner.y + inner.h).toBeLessThanOrEqual(outer.y + outer.h);
  });

  it('hugs a box with the room Pele draws, not the slack of its layout', () => {
    const { svg } = render(
      circular(
        'flowchart LR\n  E[Evaporation] --> C[Condensation]\n  subgraph Atmosphere\n    C --> P[Precipitation]\n  end\n' +
          '  P --> R[Runoff]\n  subgraph Land\n    R --> O[Collection]\n  end\n  O --> E'
      )
    );
    const nodes = nodesOf(svg);
    const box = clustersOf(svg).get('Land')!;
    if (box.kind !== 'box') throw new Error('expected a box');
    const sides = ['R', 'O'].map((id) => {
      const n = nodes.get(id)!;
      const b = markupBox(n.inner);
      return { minX: n.x + b.minX, maxX: n.x + b.maxX, maxY: n.y + b.maxY };
    });
    // Pele's tight group padding, 12px, at the left, the right and the
    // bottom, where Pele's layout left 40.
    expect(Math.min(...sides.map((r) => r.minX)) - box.x).toBeCloseTo(12, 0);
    expect(box.x + box.w - Math.max(...sides.map((r) => r.maxX))).toBeCloseTo(12, 0);
    expect(box.y + box.h - Math.max(...sides.map((r) => r.maxY))).toBeCloseTo(12, 0);
  });

  const FUNDED =
    'flowchart LR\n  I[Idea]\n  subgraph Funded\n    S[Spec]\n    D[Design]\n    B[Build]\n    T[Test]\n    P[Deploy]\n    M[Monitor]\n  end\n' +
    '  I --> S --> D --> B --> T --> P --> M --> R[Retire] --> I';

  it("draws a group spanning most of the ring as a band, a path keeping the group's data-id and fill", () => {
    const { svg } = render(circular(FUNDED + '\n  style Funded fill:#ffd'));
    const el = childGroups(findGroup(svg, 'pele-clusters')!.inner).find((g) => attr(g.open, 'data-id') === 'Funded')!;
    expect(el.open).toContain('class="pele-cluster"');
    expect(el.inner).not.toContain('<rect');
    const path = /<path\b[^>]*>/.exec(el.inner)![0];
    expect(attr(path, 'style')).toContain('fill:#ffd');
    expect(attr(path, 'stroke')).toBe('var(--_b)');
    expect(path).not.toMatch(/\s(x|y|width|height)=/);
    expectClear(svg, { Funded: ['S', 'D', 'B', 'T', 'P', 'M'] });
  });

  it("seats a band's title outside the band, near its middle", () => {
    const { svg } = render(circular(FUNDED));
    const band = clustersOf(svg).get('Funded')!;
    if (band.kind !== 'band') throw new Error('expected a band');
    const el = childGroups(findGroup(svg, 'pele-clusters')!.inner)[0]!;
    const text = /<text\b[^>]*>/.exec(el.inner)![0];
    const move = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.inner)!;
    const x = Number(attr(text, 'x')) + Number(move[1]);
    const y = Number(attr(text, 'y')) + Number(move[2]);
    const rho = Math.hypot(x - band.cx, y - band.cy);
    expect(rho).toBeGreaterThan(band.rOut);
    expect(rho).toBeLessThan(band.rOut + 60);
    const mid = band.start + band.sweep / 2;
    const off = Math.atan2(y - band.cy, x - band.cx) - mid;
    expect(Math.abs(Math.atan2(Math.sin(off), Math.cos(off)))).toBeLessThan(0.3);
  });

  it("inks a band's title for the page behind it, not for the band's fill", () => {
    const { svg } = render(circular(FUNDED + '\n  style Funded fill:#003'));
    // Pele inks the title light for the dark fill it sits on in its own box.
    expect(render(FUNDED + '\n  style Funded fill:#003').svg).toContain('class="pele-cluster-label" fill="var(--pele-fg-on-dark,#fff)"');
    const el = childGroups(findGroup(svg, 'pele-clusters')!.inner)[0]!;
    expect(attr(/<text\b[^>]*>/.exec(el.inner)![0], 'fill')).toBe('var(--_m)');
  });

  it('nests a band inside a band', () => {
    const { svg } = render(
      circular(
        'flowchart LR\n  P[Plan]\n  subgraph Engineering\n    D[Design]\n    subgraph CI\n      C[Code]\n      T[Test]\n    end\n    R[Release]\n  end\n' +
          '  P --> D --> C --> T --> R --> V[Review] --> P'
      )
    );
    const shapes = clustersOf(svg);
    expect([...shapes.values()].map((s) => s.kind)).toEqual(['band', 'band']);
    const outer = shapes.get('Engineering')!;
    const inner = shapes.get('CI')!;
    if (outer.kind !== 'band' || inner.kind !== 'band') throw new Error('expected bands');
    expect(inner.rIn).toBeGreaterThan(outer.rIn);
    expect(inner.rOut).toBeLessThan(outer.rOut);
    expectClear(svg, { Engineering: ['D', 'C', 'T', 'R'], CI: ['C', 'T'] });
  });

  /** Where a box's title text landed, and the members' vertical extent. */
  const titleAndMembers = (svg: string, g: string, members: string[]) => {
    const el = childGroups(findGroup(svg, 'pele-clusters')!.inner).find((q) => attr(q.open, 'data-id') === g)!;
    const text = /<text\b[^>]*>/.exec(el.inner)![0];
    const move = /<g transform="translate\(([-\d.]+),([-\d.]+)\)">/.exec(el.inner);
    const y = Number(attr(text, 'y')) + (move ? Number(move[2]) : 0);
    const nodes = nodesOf(svg);
    const ys = members.flatMap((id) => {
      const n = nodes.get(id)!;
      const b = markupBox(n.inner);
      return [n.y + b.minY, n.y + b.maxY];
    });
    return { y, top: Math.min(...ys), bottom: Math.max(...ys) };
  };

  it("puts a box's title at the bottom when spokes cross its top", () => {
    const { svg } = render(
      circular(
        'flowchart LR\n  A[Plan]\n  subgraph Delivery\n    C[Test]\n    D[Ship]\n  end\n  A --> B[Build] --> C --> D --> E[Watch] --> F[Learn] --> A\n' +
          '  A --> Hub[Vision]\n  B --> Hub\n  C --> Hub\n  D --> Hub\n  E --> Hub\n  F --> Hub'
      )
    );
    const t = titleAndMembers(svg, 'Delivery', ['C', 'D']);
    expect(t.y).toBeGreaterThan(t.bottom);
    expectClear(svg, { Delivery: ['C', 'D'] });
  });

  it('keeps the water cycle\'s titles on top', () => {
    const { svg } = render(
      circular(
        'flowchart LR\n  E[Evaporation] --> C[Condensation]\n  subgraph Atmosphere\n    C --> P[Precipitation]\n  end\n' +
          '  P --> R[Runoff]\n  subgraph Land\n    R --> O[Collection]\n  end\n  O --> E'
      )
    );
    for (const [g, m] of [['Atmosphere', ['C', 'P']], ['Land', ['R', 'O']]] as const) {
      const t = titleAndMembers(svg, g, [...m]);
      expect(t.y, g).toBeLessThan(t.top);
    }
  });

  it("keeps the water cycle's titles clear of every edge", () => {
    const body =
      'flowchart LR\n  E[Evaporation] --> C[Condensation]\n  subgraph Atmosphere\n    C --> P[Precipitation]\n  end\n' +
      '  P --> R[Runoff]\n  subgraph Land\n    R --> O[Collection]\n  end\n  O --> E';
    const plain = render(body).svg;
    const { svg } = render(circular(body));
    const lines = childGroups(findGroup(svg, 'pele-edges')!.inner).map((el) =>
      [...attr(/<path\b[^>]*>/.exec(el.inner)![0], 'd')!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    );
    for (const g of ['Atmosphere', 'Land']) {
      // The title's width, read back from Pele's own drawing: its left
      // edge sits 14px inside the box (20px padding less 6).
      const own = childGroups(findGroup(plain, 'pele-clusters')!.inner).find((q) => attr(q.open, 'data-id') === g)!;
      const half = Number(attr(/<text\b[^>]*>/.exec(own.inner)![0], 'x')) - Number(attr(/<rect\b[^>]*>/.exec(own.inner)![0], 'x')) - 14;
      const el = childGroups(findGroup(svg, 'pele-clusters')!.inner).find((q) => attr(q.open, 'data-id') === g)!;
      const text = /<text\b[^>]*>/.exec(el.inner)![0];
      const move = /<g transform="translate\(([-\d.]+),([-\d.]+)\)">/.exec(el.inner)!;
      const x = Number(attr(text, 'x')) + Number(move[1]);
      const baseline = Number(attr(text, 'y')) + Number(move[2]);
      // A 16px line: about 12px above the baseline, 4px below.
      const box = { minX: x - half, maxX: x + half, minY: baseline - 12, maxY: baseline + 4 };
      for (const line of lines) {
        for (let k = 0; k + 1 < line.length; k++) {
          const [a, b] = [line[k]!, line[k + 1]!];
          for (let i = 0; i <= 20; i++) {
            const px = a.x + ((b.x - a.x) * i) / 20;
            const py = a.y + ((b.y - a.y) * i) / 20;
            const inside = px > box.minX && px < box.maxX && py > box.minY && py < box.maxY;
            expect(inside, `${g} crossed at ${px.toFixed(1)},${py.toFixed(1)}`).toBe(false);
          }
        }
      }
    }
  });

  it('frames a title wider than the drawing', () => {
    const title = 'A title much wider than this little ring of three';
    const withTitle = render(`---\ntitle: ${title}\nconfig:\n  layout: circular\n---\nflowchart LR\n  A --> B --> C --> A`);
    const alone = render(`---\ntitle: ${title}\n---\nflowchart LR\n`);
    expect(withTitle.width).toBeGreaterThanOrEqual(alone.width);
  });

  it('takes its spacing from the flowchart config', () => {
    const spread = (spacing: number) => {
      const n = nodesOf(
        render(`---\nconfig:\n  layout: circular\n  flowchart:\n    nodeSpacing: ${spacing}\n---\n${RING}`).svg
      );
      return Math.hypot(n.get('A')!.x - n.get('B')!.x, n.get('A')!.y - n.get('B')!.y);
    };
    expect(spread(120)).toBeGreaterThan(spread(20));
  });
});

describe('escaping', () => {
  it('writes back a link color from the diagram escaped, as Pele does', () => {
    // A quote gets through the parser into the stroke color.
    const body = 'flowchart LR\n  A --> B --> C --> A\n  linkStyle 0 stroke:red"x';
    const fill = (svg: string) => /class="pele-marker"[^>]*?fill="([^"]*)"/.exec(svg)?.[1];
    expect(fill(render(body).svg)).toBe('red&quot;x');
    expect(fill(render(circular(body)).svg)).toBe('red&quot;x');
  });

  it('escapes every value withAttr writes', () => {
    expect(withAttr('<g a="1">', 'a', '"><x $1')).toBe('<g a="&quot;&gt;&lt;x $1">');
    expect(withAttr('<g>', 'b', '"&')).toBe('<g b="&quot;&amp;">');
  });
});

describe('markupBox', () => {
  it('bounds an arc by its curve, not its endpoints', () => {
    // A cylinder's lid bulges above the line between its endpoints.
    const box = markupBox('<path d="M-30,-20A30,10 0 0 1 30,-20V20A30,10 0 0 1 -30,20Z"/>');
    expect(box.minY).toBeCloseTo(-30, 0);
    expect(box.maxY).toBeCloseTo(30, 0);
    expect(box.minX).toBeCloseTo(-30, 0);
  });

  it('ignores text and the inside of an icon', () => {
    const box = markupBox(
      '<rect x="-10" y="-5" width="20" height="10"/><text x="900">far</text><svg x="-4" y="-4" width="8" height="8"><path d="M0,0L500,500"/></svg>'
    );
    expect([box.minX, box.minY, box.maxX, box.maxY]).toEqual([-10, -5, 10, 5]);
  });
});

describe('collapsed subgraphs', () => {
  const COLLAPSED = 'flowchart LR\n  A --> B\n  subgraph G\n    B --> C\n  end\n  C --> D --> A\n  G@{ view: collapsed }';
  const edgeIds = (svg: string) => childGroups(findGroup(svg, 'pele-edges')!.inner).map((el) => attr(el.open, 'data-id'));

  it('draws the edges Pele reroutes onto a collapsed subgraph', () => {
    // Pele drops B --> C, whose ends both collapse into G, and keeps the rest.
    expect(edgeIds(render(circular(COLLAPSED)).svg)).toEqual(edgeIds(render(COLLAPSED).svg));
  });

  it('lands the rerouted arrowhead on the collapsed node', () => {
    const { svg } = render(circular(COLLAPSED));
    const g = nodesOf(svg).get('G')!;
    const box = markupBox(g.inner);
    const edge = childGroups(findGroup(svg, 'pele-edges')!.inner).find((el) => attr(el.open, 'data-id') === 'L_A_B_0')!;
    const tip = /class="pele-marker" d="M([-\d.]+),([-\d.]+)/.exec(edge.inner)!;
    const tx = Number(tip[1]) - g.x;
    const ty = Number(tip[2]) - g.y;
    expect(tx).toBeGreaterThanOrEqual(box.minX - 0.6);
    expect(tx).toBeLessThanOrEqual(box.maxX + 0.6);
    expect(ty).toBeGreaterThanOrEqual(box.minY - 0.6);
    expect(ty).toBeLessThanOrEqual(box.maxY + 0.6);
  });

  it('reroutes onto the outermost collapsed subgraph', () => {
    const body =
      'flowchart LR\n  A --> B\n  subgraph O\n    subgraph I\n      B --> C\n    end\n    C --> E\n  end\n  E --> D --> A\n  O@{ view: collapsed }';
    expect(edgeIds(render(circular(body)).svg)).toEqual(edgeIds(render(body).svg));
  });
});

describe('casings', () => {
  const FILLED = 'flowchart LR\n  E --> C\n  subgraph Air\n    C --> P\n  end\n  P --> R --> O --> E\n  style Air fill:#ffd';

  const rectOf = (svg: string) => {
    const rect = /<rect\b[^>]*>/.exec(childGroups(findGroup(svg, 'pele-clusters')!.inner)[0]!.inner)![0];
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(attr(rect, k))) as [number, number, number, number];
    return { x, y, w, h };
  };
  const vertices = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

  it('draws a casing under each edge that crosses a filled group, and only those', () => {
    const { svg } = render(circular(FILLED));
    const { x, y, w, h } = rectOf(svg);
    const inside = ([px, py]: readonly [number, number]) => px > x && px < x + w && py > y && py < y + h;
    const crossing: string[] = [];
    for (const el of childGroups(findGroup(svg, 'pele-edges')!.inner)) {
      const d = attr(/<path\b[^>]*>/.exec(el.inner)![0], 'd')!;
      const v = vertices(d);
      if (v.some(inside) && !v.every(inside)) crossing.push(d);
    }
    expect(crossing.length).toBeGreaterThan(0);
    const casings = findGroup(svg, 'pele-casings')!;
    const cased = [...casings.inner.matchAll(/<path d="([^"]*)"\/>/g)].map((m) => m[1]);
    expect(cased).toEqual(crossing);
  });

  it("matches Pele's casing markup and layer order", () => {
    const plain = render(FILLED).svg;
    const { svg } = render(circular(FILLED));
    const casings = findGroup(svg, 'pele-casings')!;
    expect(casings.open).toBe(findGroup(plain, 'pele-casings')!.open);
    expect(findGroup(svg, 'pele-clusters')!.end).toBeLessThanOrEqual(casings.start);
    expect(casings.end).toBeLessThanOrEqual(findGroup(svg, 'pele-edges')!.start);
    // A casing's arrowhead is page-colored and carries no marker class.
    expect(casings.inner).toMatch(/<path d="[^"]*Z" fill="var\(--_bg\)" stroke="var\(--_bg\)"\/>/);
    expect(casings.inner).not.toContain('pele-marker');
  });

  it("widens and fades a casing as Pele does for the edge's own style", () => {
    // P ==> R crosses the box in both layouts; it is thick and faded.
    const body = FILLED.replace('P --> R', 'P ==> R') + '\n  linkStyle 2 opacity:0.5';
    const wrappers = (svg: string) => findGroup(svg, 'pele-casings')!.inner.match(/<g\b[^>]*>/g);
    const own = wrappers(render(body).svg);
    expect(own).toEqual(['<g stroke-width="6.5" style="opacity:0.5;">']);
    expect(wrappers(render(circular(body)).svg)).toEqual(own);
  });

  it('draws no casings around a group without a fill', () => {
    const { svg } = render(circular(FILLED.replace('\n  style Air fill:#ffd', '')));
    expect(findGroup(svg, 'pele-casings')).toBeUndefined();
  });

  it('draws no casings around a group filled with nothing', () => {
    for (const fill of ['none', 'transparent', '#ffd0', '#ffd,fill-opacity:0', '#ffd,opacity:0%']) {
      const body = FILLED.replace('fill:#ffd', `fill:${fill}`);
      // Pele itself draws none for this fill, so the wrapper must not.
      expect(findGroup(render(body).svg, 'pele-casings'), fill).toBeUndefined();
      expect(findGroup(render(circular(body)).svg, 'pele-casings'), fill).toBeUndefined();
    }
  });
});

describe('edge ink', () => {
  // A dark fill, so Pele's ink over it (light) differs from the plain line color.
  const DARK = 'style S fill:#003';
  const edge = (svg: string, id: string) => childGroups(findGroup(svg, 'pele-edges')!.inner).find((el) => attr(el.open, 'data-id') === id)!;
  const markerFills = (el: { inner: string }) => [...el.inner.matchAll(/class="pele-marker"[^>]*?fill="([^"]*)"/g)].map((m) => m[1]);
  const cased = (svg: string, el: { inner: string }) =>
    (findGroup(svg, 'pele-casings')?.inner ?? '').includes(`<path d="${attr(/<path\b[^>]*>/.exec(el.inner)![0], 'd')}"/>`);

  it("gives an edge over a fill Pele's ink for that fill, on its group and markers", () => {
    // The circle seats S's members A, B and D side by side, and keeps C
    // out of S's box. A --> B runs over the fill.
    const body = `flowchart LR\n  A --> B --> C --> D --> E --> F --> A\n  subgraph S\n    A\n    B\n    D\n  end\n  ${DARK}`;
    const plain = render(body).svg;
    // The ink Pele gives an edge over the same fill in its own layout.
    const own = attr(edge(plain, 'L_A_B_0').open, 'stroke')!;
    expect(own).toBe('var(--pele-fg-on-dark,#fff)');
    const { svg } = render(circular(body));
    const over = edge(svg, 'L_A_B_0');
    expect(attr(over.open, 'stroke')).toBe(own);
    expect(markerFills(over)).toEqual([own]);
    expect(cased(svg, over)).toBe(false);
    // B --> C leaves the box now that C sits outside it: no stale ink.
    const across = edge(svg, 'L_B_C_0');
    expect(attr(across.open, 'stroke')).toBeUndefined();
    expect(cased(svg, across)).toBe(true);
  });

  it('takes the ink of the innermost fill under an edge', () => {
    const body = 'flowchart LR\n  A --> B --> C --> D --> A\n  subgraph S\n    subgraph I\n      A --> B\n    end\n    C\n  end\n  style S fill:#003\n  style I fill:#ffd';
    const plain = edge(render(body).svg, 'L_A_B_0');
    expect(attr(plain.open, 'stroke')).toBe('var(--pele-fg-on-light,#1f1f1f)');
    const { svg } = render(circular(body));
    // The same opening tag as Pele's, ink and all.
    expect(edge(svg, 'L_A_B_0').open).toBe(plain.open);
  });

  it('drops the stale ink of an edge moved onto a border, and cases it', () => {
    // Wide spacing bows the rim's arcs out past the box around them.
    const body = `flowchart TB\n  subgraph S\n    A --> B --> C --> D --> E --> A\n  end\n  ${DARK}`;
    const plain = render(body).svg;
    const wide = render(`---\nconfig:\n  layout: circular\n  flowchart:\n    nodeSpacing: 200\n---\n${body}`).svg;
    const off = childGroups(findGroup(wide, 'pele-edges')!.inner).filter((el) => cased(wide, el));
    expect(off.length).toBeGreaterThan(0);
    for (const el of off) {
      // Pele drew this edge over the fill, with its ink.
      expect(attr(edge(plain, attr(el.open, 'data-id')!).open, 'stroke')).toBeDefined();
      expect(attr(el.open, 'stroke')).toBeUndefined();
      expect(markerFills(el)).toEqual(['var(--_l)']);
    }
  });

  it("keeps an edge's own stroke color, and cases it over a fill, as Pele does", () => {
    // Pele gives no ink to a line with its own stroke: it cases it instead.
    const body = `flowchart LR\n  A --> B --> C --> D --> A\n  subgraph S\n    A --> B\n  end\n  ${DARK}\n  linkStyle 0 stroke:#f00`;
    const plain = render(body).svg;
    expect(cased(plain, edge(plain, 'L_A_B_0'))).toBe(true);
    const { svg } = render(circular(body));
    const own = edge(svg, 'L_A_B_0');
    expect(attr(own.open, 'stroke')).toBeUndefined();
    expect(markerFills(own)).toEqual(['#f00']);
    expect(cased(svg, own)).toBe(true);
  });

  it("inks an edge over a band's fill, and cases one across its border", () => {
    const body =
      'flowchart LR\n  I[Idea]\n  subgraph S\n    A[Spec]\n    B[Design]\n    C[Build]\n    D[Test]\n    E[Deploy]\n    F[Monitor]\n  end\n' +
      `  I --> A --> B --> C --> D --> E --> F --> R[Retire] --> I\n  ${DARK}`;
    const { svg } = render(circular(body));
    expect(clustersOf(svg).get('S')!.kind).toBe('band');
    const inside = edge(svg, 'L_B_C_0');
    expect(attr(inside.open, 'stroke')).toBe('var(--pele-fg-on-dark,#fff)');
    expect(cased(svg, inside)).toBe(false);
    expect(cased(svg, edge(svg, 'L_I_A_0'))).toBe(true);
  });

  describe('the ink decision', () => {
    // No realistic diagram moves an inked edge wholly off its fill: the
    // circle keeps a group's members together inside its box. So the
    // off-fill branch is checked on synthetic lines.
    const fill = { box: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, style: ' style="rx:var(--_r);fill:#003;"' };
    const inside = [{ x: 20, y: 50 }, { x: 80, y: 50 }];

    it('inks a line wholly over a fill', () => {
      expect(overFills(inside, inside, [fill], '')).toBe('var(--pele-fg-on-dark,#fff)');
    });

    it('gives no ink and no casing to a line off every fill', () => {
      const off = [{ x: 120, y: 50 }, { x: 180, y: 50 }];
      expect(overFills(off, off, [fill], '')).toBeUndefined();
    });

    it('cases a line across a border, or with its own stroke', () => {
      const across = [{ x: 50, y: 50 }, { x: 150, y: 50 }];
      expect(overFills(across, across, [fill], '')).toBe('');
      expect(overFills(inside, inside, [fill], ' style="stroke:#f00;"')).toBe('');
    });
  });
});
