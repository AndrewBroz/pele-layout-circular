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

  it("gives an edge moved over a fill Pele's ink for that fill, on its group and markers", () => {
    // On the circle C sits between B and D, inside S's box, so B --> C
    // runs over the fill. In Pele's layout it crosses the border.
    const body = `flowchart LR\n  A --> B --> C --> D --> E --> F --> A\n  subgraph S\n    A\n    B\n    D\n  end\n  ${DARK}`;
    const plain = render(body).svg;
    expect(attr(edge(plain, 'L_B_C_0').open, 'stroke')).toBeUndefined();
    // The ink Pele gives an edge over the same fill in its own layout.
    const own = attr(edge(plain, 'L_A_B_0').open, 'stroke')!;
    expect(own).toBe('var(--pele-fg-on-dark,#fff)');
    const { svg } = render(circular(body));
    const moved = edge(svg, 'L_B_C_0');
    expect(attr(moved.open, 'stroke')).toBe(own);
    expect(markerFills(moved)).toEqual([own]);
    expect(cased(svg, moved)).toBe(false);
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
