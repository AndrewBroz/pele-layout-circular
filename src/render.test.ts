import { describe, expect, it } from 'vitest';
import { register, render } from 'pele';
import flowchart from 'pele/diagrams/flowchart';
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
