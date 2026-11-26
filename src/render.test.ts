import { describe, expect, it } from 'vitest';
import { register, render } from 'pele';
import flowchart from 'pele/diagrams/flowchart';
import { dashPattern, paintLine } from './render.js';
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
 *  its path, a closed polygon of `M` and `L` points. */
type Shape = { kind: 'box'; x: number; y: number; w: number; h: number } | { kind: 'band'; pts: { x: number; y: number }[] };

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
    const pts = [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    out.set(id, { kind: 'band', pts });
  }
  return out;
};

/** Whether a point lies inside a band's polygon, even-odd. */
const inBand = (pts: { x: number; y: number }[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/** The distance from a point to a band's wall. */
const toWall = (pts: { x: number; y: number }[], x: number, y: number): number => {
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    d = Math.min(d, Math.hypot(x - a.x - t * vx, y - a.y - t * vy));
  }
  return d;
};

/** Whether a shape covers any point of a rect, sampled every 2px. */
const covers = (s: Shape, r: { minX: number; minY: number; maxX: number; maxY: number }) => {
  if (s.kind === 'box') return s.x < r.maxX && s.x + s.w > r.minX && s.y < r.maxY && s.y + s.h > r.minY;
  for (let x = r.minX; x <= r.maxX; x += 2) {
    for (let y = r.minY; y <= r.maxY; y += 2) {
      if (inBand(s.pts, x, y)) return true;
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

  // A hub outside a four-of-six group: every box around the four
  // covers the hub, so the group is a band.
  const CORE =
    'flowchart LR\n  subgraph Core\n    A[Alpha]\n    B[Bravo]\n    C[Charlie]\n    D[Delta]\n  end\n' +
    '  A --> B --> C --> D --> E[Echo] --> F[Foxtrot] --> A\n' +
    '  A --> H[Registry]\n  B --> H\n  C --> H\n  D --> H\n  E --> H\n  F --> H';

  it("draws a group no box clears as a band, a path keeping the group's data-id and fill", () => {
    const { svg } = render(circular(CORE + '\n  style Core fill:#ffd'));
    const el = childGroups(findGroup(svg, 'pele-clusters')!.inner).find((g) => attr(g.open, 'data-id') === 'Core')!;
    expect(el.open).toContain('class="pele-cluster"');
    expect(el.inner).not.toContain('<rect');
    const path = /<path\b[^>]*>/.exec(el.inner)![0];
    expect(attr(path, 'style')).toContain('fill:#ffd');
    expect(attr(path, 'stroke')).toBe('var(--_b)');
    expect(path).not.toMatch(/\s(x|y|width|height)=/);
    expectClear(svg, { Core: ['A', 'B', 'C', 'D'] });
  });

  it("seats a band's title outside the band, close to its wall", () => {
    const { svg } = render(circular(CORE));
    const band = clustersOf(svg).get('Core')!;
    if (band.kind !== 'band') throw new Error('expected a band');
    const el = childGroups(findGroup(svg, 'pele-clusters')!.inner)[0]!;
    const text = /<text\b[^>]*>/.exec(el.inner)![0];
    const move = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.inner)!;
    const x = Number(attr(text, 'x')) + Number(move[1]);
    const y = Number(attr(text, 'y')) + Number(move[2]);
    expect(inBand(band.pts, x, y)).toBe(false);
    // The core seats the title 6px past the wall; Pele's text runs from
    // the title's left edge, so its anchor sits within a title's width.
    expect(toWall(band.pts, x, y)).toBeLessThan(60);
  });

  it("inks a band's title for the page behind it, not for the band's fill", () => {
    const { svg } = render(circular(CORE + '\n  style Core fill:#003'));
    // Pele inks the title light for the dark fill it sits on in its own box.
    expect(render(CORE + '\n  style Core fill:#003').svg).toContain('class="pele-cluster-label" fill="var(--pele-fg-on-dark,#fff)"');
    const el = childGroups(findGroup(svg, 'pele-clusters')!.inner)[0]!;
    expect(attr(/<text\b[^>]*>/.exec(el.inner)![0], 'fill')).toBe('var(--_m)');
  });

  it('nests a band inside a band', () => {
    const { svg } = render(
      circular(
        'flowchart LR\n  subgraph Core\n    A[Alpha]\n    subgraph Inner\n      B[Bravo]\n      C[Charlie]\n    end\n    D[Delta]\n  end\n' +
          '  A --> B --> C --> D --> E[Echo] --> F[Foxtrot] --> A\n' +
          '  A --> H[Registry]\n  B --> H\n  C --> H\n  D --> H\n  E --> H\n  F --> H'
      )
    );
    const shapes = clustersOf(svg);
    expect([...shapes.values()].map((s) => s.kind)).toEqual(['band', 'band']);
    const outer = shapes.get('Core')!;
    const inner = shapes.get('Inner')!;
    if (outer.kind !== 'band' || inner.kind !== 'band') throw new Error('expected bands');
    for (const p of inner.pts) expect(inBand(outer.pts, p.x, p.y)).toBe(true);
    expectClear(svg, { Core: ['A', 'B', 'C', 'D'], Inner: ['B', 'C'] });
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

  it('draws a chord straight while the rim keeps its arcs', () => {
    const { svg } = render(
      circular(
        'flowchart LR\n  W[Wake] --> K[Work] --> M[Meetings] --> F[Focus] --> H[Home] --> W\n  K -.-> H'
      )
    );
    // Largest distance of any vertex of the drawn path from the line
    // through its ends.
    const bend = (id: string) => {
      const el = childGroups(findGroup(svg, 'pele-edges')!.inner).find((g) => attr(g.open, 'data-id') === id)!;
      const d = attr(/<path\b(?![^>]*pele-marker)[^>]*>/.exec(el.inner)![0], 'd')!;
      const pts = [...d.matchAll(/([-\d.]+),([-\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      const [a, b] = [pts[0]!, pts.at(-1)!];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      return Math.max(...pts.map((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len));
    };
    // The path's numbers are rounded for the SVG, so allow a little.
    expect(bend('L_K_H_0'), 'the chord').toBeLessThan(0.05);
    expect(bend('L_W_K_0'), 'a rim edge').toBeGreaterThan(1);
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

describe('straight edges', () => {
  const TRIANGLE = 'flowchart LR\n  A[Alpha] --> B[Bravo] --> C[Charlie] --> A';
  const withCurve = (curve: string) =>
    `---\nconfig:\n  layout: circular\n  flowchart:\n    curve: ${curve}\n---\n${TRIANGLE}`;

  /** Each edge's drawn line, from its path's start to its arrowhead's tip. */
  const linesOf = (svg: string) =>
    childGroups(findGroup(svg, 'pele-edges')!.inner).map((el) => {
      const [, start, end] = /^L_(\w+)_(\w+)_\d+$/.exec(attr(el.open, 'data-id')!)!;
      const d = attr(/<path\b[^>]*>/.exec(el.inner)![0], 'd')!;
      const tip = /class="pele-marker" d="M([-\d.]+),([-\d.]+)/.exec(el.inner)!;
      const points = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      return { start: start!, end: end!, points: [...points, { x: Number(tip[1]), y: Number(tip[2]) }] };
    });

  /** Largest distance of any point from the line through the first and last. */
  const bend = (points: { x: number; y: number }[]) => {
    const a = points[0]!;
    const b = points[points.length - 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.max(...points.map((p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len));
  };

  /** How far a point sits from the outline of a node's box. */
  const offBorder = (p: { x: number; y: number }, n: Node) => {
    const box = markupBox(n.inner);
    const tx = Math.abs(p.x - n.x);
    const ty = Math.abs(p.y - n.y);
    const inside = tx <= box.maxX + 0.6 && ty <= box.maxY + 0.6;
    return inside ? Math.min(Math.abs(tx - box.maxX), Math.abs(ty - box.maxY)) : Infinity;
  };

  it('draws a three-cycle with curve: linear as three straight edges, border to border', () => {
    const { svg } = render(withCurve('linear'));
    const nodes = nodesOf(svg);
    const lines = linesOf(svg);
    expect(lines).toHaveLength(3);
    for (const { start, end, points } of lines) {
      // Coordinates are written to two decimals.
      expect(bend(points), `${start}->${end} bends`).toBeLessThan(0.05);
      expect(offBorder(points[0]!, nodes.get(start)!), `${start}->${end} start`).toBeLessThan(0.6);
      expect(offBorder(points.at(-1)!, nodes.get(end)!), `${start}->${end} tip`).toBeLessThan(0.6);
    }
  });

  it("splits an opposite pair 8px apart, enough for Pele's arrowheads", () => {
    const source = withCurve('linear').replace(TRIANGLE, `${TRIANGLE}\n  B --> A`);
    const lines = linesOf(render(source).svg);
    const there = lines.find((l) => l.start === 'A' && l.end === 'B')!.points;
    const back = lines.find((l) => l.start === 'B' && l.end === 'A')!.points;
    const [a, b] = [there[0]!, there.at(-1)!];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const gap = Math.abs(((b.x - a.x) * (a.y - back[0]!.y) - (a.x - back[0]!.x) * (b.y - a.y)) / len);
    expect(gap).toBeCloseTo(8, 1);
  });

  it('keeps the arcs by default and for any other curve', () => {
    for (const source of [circular(TRIANGLE), withCurve('basis')]) {
      for (const { start, end, points } of linesOf(render(source).svg)) {
        expect(bend(points), `${start}->${end}`).toBeGreaterThan(1);
      }
    }
    // Placement is the same either way.
    expect([...nodesOf(render(withCurve('linear')).svg)]).toEqual([...nodesOf(render(circular(TRIANGLE)).svg)]);
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

type P2 = readonly [number, number];
const vertices = (d: string): P2[] => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
const edgeOf = (svg: string, id: string) => childGroups(findGroup(svg, 'pele-edges')!.inner).find((el) => attr(el.open, 'data-id') === id)!;
const length = (pts: P2[]) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);
const INK = 'var(--pele-fg-on-dark,#fff)';
const markerFills = (el: { inner: string }) => [...el.inner.matchAll(/class="pele-marker"[^>]*?fill="([^"]*)"/g)].map((m) => m[1]);
const pathsOf = (el: { inner: string }) => [...el.inner.matchAll(/<path\b(?![^>]*class="pele-marker")[^>]*>/g)].map((m) => m[0]);

describe('casings', () => {
  const FILLED = 'flowchart LR\n  E --> C\n  subgraph Air\n    C --> P\n  end\n  P --> R --> O --> E\n  style Air fill:#ffd';
  const BAND =
    'flowchart LR\n  I[Idea]\n  subgraph S\n    A[Spec]\n    B[Design]\n    C[Build]\n    D[Test]\n  end\n  I --> A --> B --> C --> D --> R[Retire] --> I\n  style S fill:#dbeafe';
  // Wide spacing bows the arc from C to D out past the box and back in.
  const BOWED = `---\nconfig:\n  layout: circular\n  flowchart:\n    nodeSpacing: 200\n---\nflowchart TB\n  subgraph S\n    A --> B --> C --> D --> E --> A\n  end\n  style S fill:#dbeafe`;
  // A fill too faint for Pele to know the ink over it.
  const faint = (body: string) => body.replace(/fill:(#\w+)/, 'fill:$1,fill-opacity:0.4');

  it('cases nothing: no halo, no knob, no tram tracks', () => {
    const bodies = [
      circular(FILLED),
      circular(BAND),
      BOWED,
      circular(faint(FILLED)),
      circular(faint(BAND)),
      faint(BOWED),
      circular(FILLED + '\n  linkStyle 0,1,2 stroke:#f00'),
      circular(BAND.replace('I --> A', 'I ==> A')),
    ];
    for (const body of bodies) expect(findGroup(render(body).svg, 'pele-casings'), body).toBeUndefined();
  });

  it('keeps the plain color of a line over a faint fill', () => {
    const { svg } = render(circular(faint(FILLED)));
    for (const el of childGroups(findGroup(svg, 'pele-edges')!.inner)) {
      expect(attr(el.open, 'stroke')).toBeUndefined();
      for (const p of pathsOf(el)) expect(attr(p, 'stroke')).toBeUndefined();
      for (const fill of markerFills(el)) expect(fill).toBe('var(--_l)');
    }
  });
});

describe('edge ink', () => {
  // A dark fill, so Pele's ink over it (light) differs from the plain line color.
  const DARK = 'style S fill:#003';
  const SIX = `flowchart LR\n  A --> B --> C --> D --> E --> F --> A\n  subgraph S\n    A\n    B\n    D\n  end\n  ${DARK}`;

  it("gives an edge over a fill Pele's ink for that fill, on its group and markers", () => {
    // The circle seats S's members A, B and D side by side, and keeps C
    // out of S's box. A --> B runs over the fill.
    const plain = render(SIX).svg;
    // The ink Pele gives an edge over the same fill in its own layout.
    const own = attr(edgeOf(plain, 'L_A_B_0').open, 'stroke')!;
    expect(own).toBe(INK);
    const { svg } = render(circular(SIX));
    const over = edgeOf(svg, 'L_A_B_0');
    expect(attr(over.open, 'stroke')).toBe(own);
    expect(pathsOf(over)).toHaveLength(1);
    expect(markerFills(over)).toEqual([own]);
  });

  it('inks each stretch of a line that crosses a border for what it runs over', () => {
    // B --> C leaves the box now that C sits outside it; C --> D comes back.
    const { svg } = render(circular(SIX));
    const leaving = edgeOf(svg, 'L_B_C_0');
    // No stale ink on the group: each path carries its own.
    expect(attr(leaving.open, 'stroke')).toBeUndefined();
    expect(pathsOf(leaving).map((p) => attr(p, 'stroke'))).toEqual([INK, undefined]);
    // The arrowhead, outside, is the plain line color.
    expect(markerFills(leaving)).toEqual(['var(--_l)']);
    const entering = edgeOf(svg, 'L_C_D_0');
    expect(pathsOf(entering).map((p) => attr(p, 'stroke'))).toEqual([undefined, INK]);
    // The arrowhead inside the fill takes its ink.
    expect(markerFills(entering)).toEqual([INK]);
  });

  it('meets the stretches of a solid line end to end, with butt ends', () => {
    // Round ends overlap where two stretches meet, and a stroke-opacity
    // would darken the overlap.
    const { svg } = render(circular(SIX + '\n  linkStyle 1 stroke-opacity:0.5'));
    for (const id of ['L_B_C_0', 'L_C_D_0']) {
      const paths = pathsOf(edgeOf(svg, id));
      expect(paths.length).toBe(2);
      for (const p of paths) expect(attr(p, 'stroke-linecap')).toBe('butt');
      const [a, b] = paths.map((p) => vertices(attr(p, 'd')!));
      const end = a![a!.length - 1]!;
      expect(Math.hypot(end[0] - b![0]![0], end[1] - b![0]![1])).toBeLessThan(0.02);
    }
  });

  it("joins a dotted line's stretches in a gap, its dashes in step", () => {
    const body = SIX.replace('B --> C', 'B -.-> C');
    const { svg } = render(circular(body));
    const [first, second] = pathsOf(edgeOf(svg, 'L_B_C_0'));
    expect(attr(first!, 'stroke-dasharray')).toBe('3 4');
    expect(attr(second!, 'stroke-dasharray')).toBe('3 4');
    // Dashes keep their round ends.
    expect(attr(second!, 'stroke-linecap')).toBeUndefined();
    expect(attr(first!, 'stroke-dashoffset')).toBeUndefined();
    const offset = Number(attr(second!, 'stroke-dashoffset'));
    expect(offset).toBeCloseTo(length(vertices(attr(first!, 'd')!)), 0);
    // Pele's dots are 3 on, 4 off: the join falls in the middle of a gap.
    expect(offset % 7).toBeCloseTo(5, 1);
  });

  it('takes the ink of the innermost fill under an edge', () => {
    const body = 'flowchart LR\n  A --> B --> C --> D --> A\n  subgraph S\n    subgraph I\n      A --> B\n    end\n    C\n  end\n  style S fill:#003\n  style I fill:#ffd';
    const plain = edgeOf(render(body).svg, 'L_A_B_0');
    expect(attr(plain.open, 'stroke')).toBe('var(--pele-fg-on-light,#1f1f1f)');
    const { svg } = render(circular(body));
    // The same opening tag as Pele's, ink and all.
    expect(edgeOf(svg, 'L_A_B_0').open).toBe(plain.open);
  });

  it('inks the arcs of a box whole: the box holds them, even at wide spacing', () => {
    // Wide spacing bows the rim's arcs outward. The core's box holds
    // every path between its members, so no arc leaves its box.
    const body = `flowchart TB\n  subgraph S\n    A --> B --> C --> D --> E --> A\n  end\n  ${DARK}`;
    const wide = render(`---\nconfig:\n  layout: circular\n  flowchart:\n    nodeSpacing: 200\n---\n${body}`).svg;
    const edges = childGroups(findGroup(wide, 'pele-edges')!.inner);
    expect(edges.length).toBe(5);
    for (const el of edges) {
      expect(pathsOf(el)).toHaveLength(1);
      expect(attr(el.open, 'stroke')).toBe(INK);
    }
  });

  it("keeps an edge's own stroke color over a fill, uncased", () => {
    const body = `flowchart LR\n  A --> B --> C --> D --> A\n  subgraph S\n    A --> B\n  end\n  ${DARK}\n  linkStyle 0 stroke:#f00`;
    const { svg } = render(circular(body));
    const own = edgeOf(svg, 'L_A_B_0');
    expect(attr(own.open, 'stroke')).toBeUndefined();
    expect(pathsOf(own).map((p) => attr(p, 'stroke'))).toEqual([undefined]);
    expect(markerFills(own)).toEqual(['#f00']);
    expect(findGroup(svg, 'pele-casings')).toBeUndefined();
  });

  it("inks an edge over a band's fill, and splits one across its border", () => {
    const body =
      'flowchart LR\n  subgraph S\n    A[Alpha]\n    B[Bravo]\n    C[Charlie]\n    D[Delta]\n  end\n' +
      '  A --> B --> C --> D --> E[Echo] --> F[Foxtrot] --> A\n' +
      `  A --> H[Registry]\n  B --> H\n  C --> H\n  D --> H\n  E --> H\n  F --> H\n  ${DARK}`;
    const { svg } = render(circular(body));
    expect(clustersOf(svg).get('S')!.kind).toBe('band');
    const inside = edgeOf(svg, 'L_B_C_0');
    expect(attr(inside.open, 'stroke')).toBe(INK);
    const entering = edgeOf(svg, 'L_F_A_0');
    expect(pathsOf(entering).map((p) => attr(p, 'stroke'))).toEqual([undefined, INK]);
    expect(markerFills(entering)).toEqual([INK]);
  });

  describe('the paint decision', () => {
    // No realistic diagram moves an inked edge wholly off its fill: the
    // circle keeps a group's members together inside its box. So the
    // off-fill branch is checked on synthetic lines.
    const fill = { box: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, style: ' style="rx:var(--_r);fill:#003;"' };
    const ends = (pts: { x: number; y: number }[]) => [pts[0]!, pts[pts.length - 1]!] as const;
    const inside = [{ x: 20, y: 50 }, { x: 80, y: 50 }];
    const span = (pts: { x: number }[]) => [pts[0]!.x, pts[pts.length - 1]!.x];

    it('inks a line wholly over a fill, and its markers', () => {
      const { stretches, tips } = paintLine(inside, [fill], '', ends(inside));
      expect(stretches.map((s) => s.ink)).toEqual([INK]);
      expect(tips).toEqual([INK, INK]);
    });

    it('gives no ink to a line off every fill', () => {
      const off = [{ x: 120, y: 50 }, { x: 180, y: 50 }];
      const { stretches, tips } = paintLine(off, [fill], '', ends(off));
      expect(stretches.map((s) => s.ink)).toEqual([undefined]);
      expect(tips).toEqual([undefined, undefined]);
    });

    it('splits a line at the border and inks the inside', () => {
      const across = [{ x: 50, y: 50 }, { x: 150, y: 50 }];
      const { stretches } = paintLine(across, [fill], '', ends(across));
      expect(stretches.map((s) => s.ink)).toEqual([INK, undefined]);
      expect(span(stretches[0]!.points)[1]).toBeCloseTo(100, 0);
      expect(span(stretches[1]!.points)[0]).toBeCloseTo(100, 0);
      expect(stretches[1]!.at).toBeCloseTo(50, 0);
    });

    it('inks a marker for the fill under its tip, not under the line end', () => {
      // The line stops 2px short of the border, the arrowhead's tip 6px past it.
      const short = [{ x: 150, y: 50 }, { x: 102, y: 50 }];
      const { stretches, tips } = paintLine(short, [fill], '', [short[0]!, { x: 94, y: 50 }]);
      expect(stretches.map((s) => s.ink)).toEqual([undefined]);
      expect(tips).toEqual([undefined, INK]);
    });

    it('keeps the plain color over a fill with its own stroke or an unknown ink', () => {
      expect(paintLine(inside, [fill], ' style="stroke:#f00;"', ends(inside)).stretches.map((s) => s.ink)).toEqual([undefined]);
      const pale = { ...fill, style: ' style="fill:#003;fill-opacity:0.4;"' };
      expect(paintLine(inside, [pale], '', ends(inside)).tips).toEqual([undefined, undefined]);
    });

    it('moves a dashed join to the middle of the nearest gap', () => {
      const across = [{ x: 50, y: 50 }, { x: 150, y: 50 }];
      // 3 on, 4 off from x = 50: the gap nearest the border, at 50 px
      // along, is 45 to 49, so the join moves to 47 px along.
      const { stretches } = paintLine(across, [fill], '', ends(across), [3, 4]);
      expect(stretches[1]!.at).toBeCloseTo(47, 5);
      expect(span(stretches[0]!.points)[1]).toBeCloseTo(97, 5);
    });

    it('reads a dash pattern as SVG does', () => {
      expect(dashPattern('3 4')).toEqual([3, 4]);
      expect(dashPattern('5,2,1')).toEqual([5, 2, 1, 5, 2, 1]);
      expect(dashPattern('none')).toBeUndefined();
      expect(dashPattern('var(--d)')).toBeUndefined();
      expect(dashPattern(undefined)).toBeUndefined();
    });
  });
});
