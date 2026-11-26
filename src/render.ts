import { circularLayout, groupBounds, outlinePath } from 'layout-circular';
import type {
  CircularLayoutOptions,
  GroupShape,
  LayoutEdgeInput,
  LayoutGroupInput,
  LayoutNodeInput,
  Point,
} from 'layout-circular';
import type { Diagram, FlowchartModel, RenderOptions } from 'pele';
import { ink, paints } from './ink.js';
import {
  attr,
  childGroups,
  emptyBox,
  escapeAttr,
  findGroup,
  grow,
  isEmpty,
  markupBox,
  num,
  withAttr,
  type Box,
  type Element,
} from './svg.js';

/**
 * Pele draws the diagram with its own layout first. This keeps every
 * node, label and group exactly as Pele drew them, moves them to where
 * the circular layout places them, and redraws the edges along the
 * circle. Pele's look, theming and CSS hooks carry over unchanged.
 */

export type Rendered = ReturnType<Diagram<FlowchartModel>['render']>;

/** The outline family of each Pele shape. Every other shape is a box,
 *  which over-reserves and never overlaps. */
const FAMILIES: Record<string, NonNullable<LayoutNodeInput['shape']>> = {
  circle: 'ellipse',
  'dbl-circ': 'ellipse',
  'sm-circ': 'ellipse',
  'f-circ': 'ellipse',
  'fr-circ': 'ellipse',
  'cross-circ': 'ellipse',
  ellipse: 'ellipse',
  diam: 'diamond',
  stadium: 'stadium',
};

/** Pele's arrowhead length, and how far it shortens a path under each
 *  marker type (`ARROW` and `markerTrim` in Pele's `svg/edges.ts`). */
const ARROW = 8;
const TRIM: Record<string, number> = { arrow_point: ARROW - 1, arrow_circle: ARROW, arrow_cross: 4 };

/** Start and end markers per edge type (`arrows` in Pele's flowchart graph). */
const markersOf = (edge: FlowchartModel['edges'][number]): [string, string] => {
  if (edge.stroke === 'invisible' || edge.type === 'arrow_open') return ['none', 'none'];
  switch (edge.type) {
    case 'arrow_point':
    case 'arrow_circle':
    case 'arrow_cross':
      return ['none', edge.type];
    case 'double_arrow_point':
    case 'double_arrow_circle':
    case 'double_arrow_cross': {
      const single = edge.type.replace('double_', '');
      return [single, single];
    }
  }
  return ['none', 'arrow_point'];
};

/** A marker with its tip at `p`, pointing along unit `(dx, dy)`, drawn
 *  as Pele draws it (`marker` in Pele's `svg/edges.ts`). */
const marker = (type: string, p: Point, dx: number, dy: number, color: string): string => {
  const nx = -dy;
  const ny = dx;
  if (type === 'arrow_point') {
    const bx = p.x - dx * ARROW;
    const by = p.y - dy * ARROW;
    const half = ARROW * 0.42;
    return `<path class="pele-marker" d="M${num(p.x)},${num(p.y)}L${num(bx + nx * half)},${num(by + ny * half)}L${num(
      bx - nx * half
    )},${num(by - ny * half)}Z" fill="${color}" stroke="none"/>`;
  }
  if (type === 'arrow_circle') {
    return `<circle class="pele-marker" cx="${num(p.x - dx * 4)}" cy="${num(p.y - dy * 4)}" r="3.5" fill="${color}" stroke="none"/>`;
  }
  if (type === 'arrow_cross') {
    const cx = p.x - dx * 4;
    const cy = p.y - dy * 4;
    const ux = (dx + nx) * 3.5;
    const uy = (dy + ny) * 3.5;
    const vx = (dx - nx) * 3.5;
    const vy = (dy - ny) * 3.5;
    return `<path class="pele-marker" d="M${num(cx - ux)},${num(cy - uy)}L${num(cx + ux)},${num(cy + uy)}M${num(
      cx - vx
    )},${num(cy - vy)}L${num(cx + vx)},${num(cy + vy)}"/>`;
  }
  return '';
};

/** Whether a segment overlaps a box, by Liang-Barsky clipping (`clips`
 *  in Pele's `svg/edges.ts`). */
const clips = (a: Point, b: Point, box: Box): boolean => {
  let lo = 0;
  let hi = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) hi = -1;
    } else if (p < 0) lo = Math.max(lo, q / p);
    else hi = Math.min(hi, q / p);
  }
  return lo < hi;
};

/** A filled group box, and its rect's style attribute as Pele wrote
 *  it (`Fill` in Pele's `svg/edges.ts`). A group drawn as a band along
 *  the ring also carries the band's outline, and `box` is its bounds. */
export interface Fill {
  box: Box;
  style: string;
  band?: Point[];
}

/** How far a point lies inside a closed outline, px: negative outside. */
const insideOutline = (outline: Point[], p: Point): number => {
  let near = Infinity;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!;
    const b = outline[j]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    near = Math.min(near, Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy));
    // Even-odd: a ray to the right crosses the wall an odd number of
    // times from inside.
    if (a.y > p.y !== b.y > p.y && p.x < (vx * (p.y - a.y)) / vy + a.x) inside = !inside;
  }
  return inside ? near : -near;
};

/** The line's points, with a point every pixel or closer between
 *  them, so a curved wall can't slip between two far-apart points and
 *  a border is found to within half a pixel. */
const dense = (line: Point[]): Point[] => {
  const out: Point[] = [];
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k]!;
    const b = line[k + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i < steps; i++) out.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  }
  if (line.length > 0) out.push(line[line.length - 1]!);
  return out;
};

/** How far a point lies inside a fill, px: negative outside. Outside a
 *  box's corner, the nearer side counts: only the sign, and the depth
 *  within a pixel of a border, are read. */
const depth = (fill: Fill, p: Point): number => {
  if (fill.band) return insideOutline(fill.band, p);
  const b = fill.box;
  return Math.min(p.x - b.minX, b.maxX - p.x, p.y - b.minY, b.maxY - p.y);
};

const fillArea = (fill: Fill): number => {
  const b = fill.band;
  if (b) {
    // The shoelace formula.
    let twice = 0;
    b.forEach((p, i) => {
      const q = b[(i + 1) % b.length]!;
      twice += p.x * q.y - q.x * p.y;
    });
    return Math.abs(twice) / 2;
  }
  return (fill.box.maxX - fill.box.minX) * (fill.box.maxY - fill.box.minY);
};

/** A stretch of a line over one surface: `at` is how far along the
 *  line it starts, px, and `ink` its color over a fill, undefined for
 *  the line's plain color. */
export interface Stretch {
  points: Point[];
  at: number;
  ink?: string;
}

/** A line split into stretches by the fills it runs over, and the ink
 *  under each of its two marker tips, undefined for the plain color. */
export interface Painted {
  stretches: Stretch[];
  tips: [string | undefined, string | undefined];
}

/** A dash pattern as plain numbers, doubled when odd as SVG does, or
 *  undefined for a solid line or a pattern that isn't plain numbers. */
export const dashPattern = (value: string | undefined): number[] | undefined => {
  if (value === undefined || value.trim() === 'none') return undefined;
  const parts = value.trim().split(/[\s,]+/);
  if (!parts.every((v) => /^[\d.]+(?:px)?$/.test(v))) return undefined;
  const dashes = parts.map((v) => parseFloat(v));
  return dashes.length % 2 ? dashes.concat(dashes) : dashes;
};

/** The middle of the dash gap nearest `s` px along a dashed line. */
const intoGap = (s: number, dashes: number[]): number => {
  const period = dashes.reduce((a, b) => a + b, 0);
  if (!(period > 0)) return s;
  let best = s;
  let far = Infinity;
  let c = 0;
  for (let j = 0; j < dashes.length; j++) {
    if (j % 2 && dashes[j]! > 0) {
      const mid = c + dashes[j]! / 2;
      for (const k of [-1, 0, 1]) {
        const g = (Math.floor(s / period) + k) * period + mid;
        if (Math.abs(g - s) < far) [far, best] = [Math.abs(g - s), g];
      }
    }
    c += dashes[j]!;
  }
  return best;
};

/**
 * How a line is painted over the filled groups. Pele inks a line that
 * lies wholly over a fill, and cases a line that crosses a border, its
 * markers too (`fillUnder`, `overFills` and `edgeInk` in Pele's
 * `svg/edges.ts`). A casing under an arrowhead halos it, and a casing
 * stopped short of one ends in a knob. So here the line is split where
 * it crosses a border, and each stretch takes the ink of the innermost
 * fill under it, as Pele inks a whole line. Over a fill whose ink isn't
 * used, because the line has its own stroke or the ink is unknown, a
 * stretch keeps its plain color. Nothing is cased. Each marker takes
 * the ink under its tip. A dashed line in `dashes` is split in the
 * middle of the gap nearest each border, so no dash breaks in two. As
 * in Pele, a point counts as over a fill when it lies more than half a
 * pixel inside.
 */
export const paintLine = (line: Point[], fills: Fill[], lineStyle: string, tips: readonly [Point, Point], dashes?: number[]): Painted => {
  const points = dense(line);
  const along = [0];
  for (let i = 1; i < points.length; i++)
    along.push(along[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = along[along.length - 1]!;
  const depths = fills.map((f) => points.map((p) => depth(f, p)));
  const areas = fills.map(fillArea);
  const ownStroke = /[";]stroke:/.test(lineStyle);
  /** The innermost fill at these depths, one per fill, or -1. */
  const innermost = (at: (f: number) => number): number => {
    let best = -1;
    for (let f = 0; f < fills.length; f++) if (at(f) > 0.5 && (best < 0 || areas[f]! < areas[best]!)) best = f;
    return best;
  };
  const inkOf = (f: number): string | undefined => (f < 0 || ownStroke ? undefined : ink(fills[f]!.style));
  const under = points.map((_, i) => innermost((f) => depths[f]![i]!));

  // Where the line crosses a border between two points a pixel apart:
  // where the depth of a fill it enters or leaves passes zero.
  const cross = (i: number): number => {
    const d = depths.find((d) => d[i - 1]! > 0.5 !== d[i]! > 0.5);
    const t = d ? Math.max(0, Math.min(1, d[i - 1]! / (d[i - 1]! - d[i]! || 1))) : 0.5;
    return along[i - 1]! + (along[i]! - along[i - 1]!) * t;
  };
  let runs: { from: number; to: number; ink?: string }[] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i < points.length && under[i] === under[i - 1]) continue;
    const to = i < points.length ? cross(i) : total;
    const color = inkOf(under[i - 1]!);
    const last = runs[runs.length - 1];
    if (last && last.ink === color) last.to = to;
    else runs.push({ from: start, to, ...(color ? { ink: color } : {}) });
    start = to;
  }
  if (dashes && runs.length > 1) {
    for (let r = 1; r < runs.length; r++) runs[r - 1]!.to = runs[r]!.from = Math.max(0, Math.min(total, intoGap(runs[r]!.from, dashes)));
    // A stretch shorter than a gap away is folded into its neighbors.
    const kept: typeof runs = [];
    for (const r of runs.filter((r) => r.to - r.from > 0.01)) {
      const last = kept[kept.length - 1];
      if (last && last.ink === r.ink) last.to = r.to;
      else if (last) kept.push({ ...r, from: last.to });
      else kept.push({ ...r, from: 0 });
    }
    runs = kept;
  }

  // The line from `a` to `b` px along it, through the line's own
  // vertices, not the samples.
  const vertexAlong = [0];
  for (let k = 1; k < line.length; k++)
    vertexAlong.push(vertexAlong[k - 1]! + Math.hypot(line[k]!.x - line[k - 1]!.x, line[k]!.y - line[k - 1]!.y));
  const at = (s: number): Point => {
    let k = 1;
    while (k < line.length - 1 && vertexAlong[k]! < s) k++;
    const t = Math.max(0, Math.min(1, (s - vertexAlong[k - 1]!) / (vertexAlong[k]! - vertexAlong[k - 1]! || 1)));
    return { x: line[k - 1]!.x + (line[k]!.x - line[k - 1]!.x) * t, y: line[k - 1]!.y + (line[k]!.y - line[k - 1]!.y) * t };
  };
  const between = (a: number, b: number): Point[] => [at(a), ...line.filter((_, k) => vertexAlong[k]! > a && vertexAlong[k]! < b), at(b)];
  const stretches = runs.map((r): Stretch => ({ points: runs.length === 1 ? line : between(r.from, r.to), at: r.from, ...(r.ink ? { ink: r.ink } : {}) }));
  const tipInk = (p: Point) => inkOf(innermost((f) => depth(fills[f]!, p)));
  return { stretches, tips: [tipInk(tips[0]), tipInk(tips[1])] };
};

/** A line's width where it is a plain number, else 1 (Pele draws a
 *  thick edge 2.5 wide). */
const lineWidth = (line: string, thick: boolean): number => {
  const width = thick ? '2.5' : (/[";]stroke-width:([^;"]+);/.exec(line)?.[1]!.trim() ?? '1');
  return /^[\d.]+(?:px)?$/.test(width) ? parseFloat(width) : 1;
};

const pathD = (points: Point[]): string => 'M' + points.map((p) => `${num(p.x)},${num(p.y)}`).join('L');

const unit = (from: Point, to: Point): [number, number] => {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return [(to.x - from.x) / len, (to.y - from.y) / len];
};

/**
 * What each hidden node and subgraph collapses into: its outermost
 * collapsed subgraph (`outermostCollapsed` and `collapsedInto` in
 * `buildFlowGraph`, Pele's `diagrams/flowchart/graph.ts`). Pele draws a
 * subgraph whose metadata says `view: collapsed` as a single node.
 */
const collapsedInto = (model: FlowchartModel): Map<string, string> => {
  const into = new Map<string, string>();
  const byId = new Map(model.subgraphs.map((sg) => [sg.id, sg]));
  const isCollapsed = (id: string) => byId.get(id)?.metadata?.view === 'collapsed';
  if (!model.subgraphs.some((sg) => isCollapsed(sg.id))) return into;
  const parent = new Map<string, string>();
  for (const sg of model.subgraphs) for (const child of sg.nodes) if (byId.has(child)) parent.set(child, sg.id);
  const outermost = (id: string): string | undefined => {
    let found: string | undefined;
    // The seen set stops a cycle of parents, as Pele's walk does.
    const seen = new Set<string>();
    for (let at: string | undefined = id; at !== undefined && !seen.has(at); at = parent.get(at)) {
      seen.add(at);
      if (isCollapsed(at)) found = at;
    }
    return found;
  };
  for (const sg of model.subgraphs) {
    const top = outermost(sg.id);
    if (top === undefined) continue;
    if (sg.id !== top) into.set(sg.id, top);
    for (const child of sg.nodes) if (child !== top) into.set(child, top);
  }
  return into;
};

/** The edges Pele draws, with ids as Pele assigns them (`buildFlowGraph`):
 *  an end inside a collapsed subgraph moves onto it, and an edge whose
 *  two ends collapse into the same node is dropped. */
const drawnEdges = (model: FlowchartModel, into: Map<string, string>) => {
  const out: { e: FlowchartModel['edges'][number]; id: string; start: string; end: string }[] = [];
  model.edges.forEach((e, index) => {
    const start = into.get(e.start) ?? e.start;
    const end = into.get(e.end) ?? e.end;
    if (start === end && (into.has(e.start) || into.has(e.end))) return;
    out.push({ e, id: e.id || `L_${start}_${end}_${index}`, start, end });
  });
  return out;
};

const translateOf = (open: string): Point => {
  const m = /translate\(([-\d.e]+),\s*([-\d.e]+)\)/.exec(attr(open, 'transform') ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
};

const rectOf = (inner: string): Box | undefined => {
  const tag = /<rect\b[^>]*>/.exec(inner)?.[0];
  if (!tag) return undefined;
  const x = Number(attr(tag, 'x'));
  const y = Number(attr(tag, 'y'));
  return { minX: x, minY: y, maxX: x + Number(attr(tag, 'width')), maxY: y + Number(attr(tag, 'height')) };
};

const shifted = (el: Element, dx: number, dy: number): string =>
  dx === 0 && dy === 0 ? el.open + el.inner + '</g>' : withAttr(el.open, 'transform', `translate(${num(dx)},${num(dy)})`) + el.inner + '</g>';

/** The room Pele leaves between a group box and its contents when it
 *  draws tight (`groupPad` in `renderFlowchart`, Pele's
 *  `diagrams/flowchart/render.ts`; 20 otherwise). A box on the circle
 *  hugs its members, as in the prototype the owner chose from. */
const GROUP_PAD = 12;

/** The room Pele leaves in its ordinary drawing (`GROUP_PAD` in
 *  Pele's `diagrams/flowchart/render.ts`). A title is placed against
 *  the padding Pele drew, so its width reads back against this. */
const PELE_GROUP_PAD = 20;

/** How far below its box's top Pele starts a group's title, and how far
 *  inside the side padding its left edge sits (`renderFlowchart` and
 *  `clusterTitleX` in Pele's flowchart and `svg/cluster.ts`). */
const TITLE_DROP = 8;
const TITLE_INSET = 6;

/** A group title as Pele drew it: its center and size. */
interface Title {
  at: Point;
  width: number;
  height: number;
}

/**
 * Read a group title back from Pele's markup. Pele's text sits 0.35em
 * below each line's middle (`labelSvg` in Pele's `svg/builder.ts`), so
 * the lines' baselines give the label's height. A one-line title is
 * centered on its x. Its left edge sits TITLE_INSET px inside the side
 * padding, or its right edge does, unless edges crossing the top moved
 * it to the middle; so its width reads back from where Pele put it.
 * Where it can't, the width Pele left for the title bounds it.
 */
const titleOf = (markup: string, box: Box, side: number, fontSize: number): Title | undefined => {
  const tags = [...markup.matchAll(/<(?:text|tspan)\b[^>]*>/g)].map((m) => m[0]);
  const ys = tags.map((t) => Number(attr(t, 'y'))).filter((y) => Number.isFinite(y));
  if (ys.length === 0) return undefined;
  const own = /font-size[:=]"?\s*([\d.]+)/.exec(tags[0]!)?.[1];
  const shift = 0.35 * (own ? Number(own) : fontSize);
  const top = box.minY + TITLE_DROP + shift;
  const height = Math.max(0, Math.min(...ys) - top + (Math.max(...ys) - top));
  const room = Math.max(0, box.maxX - box.minX - 2 * (side - TITLE_INSET));
  const mid = (box.minX + box.maxX) / 2;
  const x = Number(attr(tags[0]!, 'x'));
  let width = room;
  let cx = mid;
  if (tags.length === 1 && Number.isFinite(x)) {
    cx = x;
    if (x < mid - 0.01) width = 2 * (x - box.minX - side + TITLE_INSET);
    else if (x > mid + 0.01) width = 2 * (box.maxX - side + TITLE_INSET - x);
  }
  return { at: { x: cx, y: box.minY + TITLE_DROP + height / 2 }, width: Math.max(0, Math.min(width, room)), height };
};


export const renderCircular = (
  model: FlowchartModel,
  base: Rendered,
  layoutOptions: CircularLayoutOptions,
  options: RenderOptions,
  /** Width Pele needs for the diagram's title, padding included. */
  titleWidth = 0
): Rendered => {
  const source = base.svg;
  const pad = options.padding ?? 8;

  // Nodes: Pele's markup, its center, and the extent it drew.
  interface DrawnNode {
    el: Element;
    at: Point;
    box: Box;
    shape: string;
  }
  const nodesGroup = findGroup(source, 'pele-nodes');
  const nodes = new Map<string, DrawnNode>();
  for (const el of childGroups(nodesGroup?.inner ?? '')) {
    const id = attr(el.open, 'data-id');
    if (id === undefined) continue;
    const shape = /pele-shape-(\S+?)[\s"]/.exec(el.open)?.[1] ?? 'rect';
    nodes.set(id, { el, at: translateOf(el.open), box: markupBox(el.inner), shape });
  }

  // Innermost group of each node, as Pele resolves it: the first
  // declared subgraph that lists the node wins, and a subgraph hidden
  // inside a collapsed one is no group.
  const into = collapsedInto(model);
  const parentOf = new Map<string, string>();
  for (let i = model.subgraphs.length - 1; i >= 0; i--) {
    const sg = model.subgraphs[i]!;
    if (into.has(sg.id)) continue;
    for (const id of sg.nodes) parentOf.set(id, sg.id);
  }

  // Edge labels, measured by the patch Pele draws behind each one.
  const labelsGroup = findGroup(source, 'pele-edge-labels');
  const labels = new Map<string, { el: Element; box: Box }>();
  for (const el of childGroups(labelsGroup?.inner ?? '')) {
    const id = attr(el.open, 'data-id');
    const box = rectOf(el.inner);
    if (id !== undefined && box) labels.set(id, { el, box });
  }

  const layoutNodes: LayoutNodeInput[] = [];
  for (const [id, n] of nodes) {
    if (isEmpty(n.box)) continue;
    const group = parentOf.get(id);
    layoutNodes.push({
      id,
      // A shape is drawn centered, so twice its farthest reach is the
      // footprint the layout must keep clear.
      width: 2 * Math.max(-n.box.minX, n.box.maxX),
      height: 2 * Math.max(-n.box.minY, n.box.maxY),
      shape: FAMILIES[n.shape] ?? 'box',
      ...(group !== undefined && { group }),
    });
  }
  const placedIds = new Set(layoutNodes.map((n) => n.id));
  const modelEdges = drawnEdges(model, into);
  const layoutEdges: LayoutEdgeInput[] = [];
  for (const { id, start, end } of modelEdges) {
    if (!placedIds.has(start) || !placedIds.has(end)) continue;
    const label = labels.get(id)?.box;
    layoutEdges.push({
      id,
      start,
      end,
      ...(label && { labelWidth: label.maxX - label.minX, labelHeight: label.maxY - label.minY }),
    });
  }

  // Group shapes: the core places them, from the room Pele draws
  // around a group's contents and the size of its title, both read back
  // from Pele's own drawing.
  const clustersGroup = findGroup(source, 'pele-clusters');
  const clusterEls = childGroups(clustersGroup?.inner ?? '');
  const struckEls = childGroups(findGroup(source, 'pele-cluster-titles')?.inner ?? '');
  const clusterById = new Map<string, { el: Element; old: Box; title?: Title }>();
  for (const el of clusterEls) {
    const id = attr(el.open, 'data-id');
    const old = rectOf(el.inner);
    if (id !== undefined && old) clusterById.set(id, { el, old });
  }
  const sizeOf = new Map(layoutNodes.map((n) => [n.id, n]));
  const layoutGroups: LayoutGroupInput[] = [];
  for (const [g, c] of clusterById) {
    const { el, old } = c;
    const before = emptyBox();
    for (const [id, n] of nodes) {
      const s = sizeOf.get(id);
      if (parentOf.get(id) !== g || !s) continue;
      grow(before, n.at.x - s.width / 2, n.at.y - s.height / 2);
      grow(before, n.at.x + s.width / 2, n.at.y + s.height / 2);
    }
    for (const [child, k] of clusterById) {
      if (parentOf.get(child) !== g) continue;
      grow(before, k.old.minX, k.old.minY);
      grow(before, k.old.maxX, k.old.maxY);
    }
    if (isEmpty(before)) continue;
    // Pele's layout can leave a box roomier than Pele pads it, often
    // 40px. The box hugs its contents instead, with less only where
    // Pele's drawing shows less.
    const slack = Math.max(0, Math.min(before.minX - old.minX, old.maxX - before.maxX, old.maxY - before.maxY));
    const side = Math.min(GROUP_PAD, slack);
    // The padding Pele drew: 20, or 12 when it drew tight.
    const drawn = Math.min(PELE_GROUP_PAD, slack);
    const struck = struckEls.find((t) => attr(t.open, 'data-id') === g);
    // A struck title is drawn twice, halo and text; the first will do.
    const titleMarkup = struck ? (/<text\b[\s\S]*?<\/text>/.exec(struck.inner)?.[0] ?? '') : el.inner.replace(/<rect\b[^>]*>/, '');
    const title = titleOf(titleMarkup, old, drawn, options.fontSize ?? 16);
    if (title) c.title = title;
    const parent = parentOf.get(g);
    layoutGroups.push({
      id: g,
      ...(parent !== undefined && clusterById.has(parent) && { parent }),
      // Pele's title room: the label, 8px above it and 8px below.
      padding: { top: title && title.height > 0 ? title.height + 2 * TITLE_DROP : side, right: side, bottom: side, left: side },
      ...(title && { title: { width: title.width, height: title.height } }),
    });
  }

  const result = circularLayout(layoutNodes, layoutEdges, layoutOptions, layoutGroups);
  const placed = new Map(result.nodes.map((n) => [n.id, n]));
  const routed = new Map(result.edges.map((e) => [e.id, e]));
  const shapeOf = new Map<string, GroupShape>();
  for (const g of result.groups ?? []) if (clusterById.has(g.id)) shapeOf.set(g.id, g);

  // Everything is laid out around the origin; `extent` collects what
  // the drawing covers so it can be moved into the frame at the end.
  const extent = emptyBox();
  for (const n of result.nodes) {
    const s = sizeOf.get(n.id)!;
    grow(extent, n.x - s.width / 2, n.y - s.height / 2);
    grow(extent, n.x + s.width / 2, n.y + s.height / 2);
  }
  for (const e of result.edges) for (const p of e.points) grow(extent, p.x, p.y);

  // Group shapes are the core's, each clear of everything outside it.
  // A band's title sits outside the band.
  for (const [g, shape] of shapeOf) {
    const b = groupBounds(shape);
    grow(extent, b.minX, b.minY);
    grow(extent, b.maxX, b.maxY);
    const t = clusterById.get(g)!.title;
    if (shape.kind === 'band' && t) {
      grow(extent, shape.title.x - t.width / 2, shape.title.y - t.height / 2);
      grow(extent, shape.title.x + t.width / 2, shape.title.y + t.height / 2);
    }
  }

  // Label centers: the core's placement, or the path's middle.
  const labelAt = new Map<string, Point>();
  for (const [id, l] of labels) {
    const at = routed.get(id)?.label;
    if (!at) continue;
    const w = l.box.maxX - l.box.minX;
    const h = l.box.maxY - l.box.minY;
    labelAt.set(id, at);
    grow(extent, at.x - w / 2, at.y - h / 2);
    grow(extent, at.x + w / 2, at.y + h / 2);
  }

  // The frame: Pele's padding, and the room its title took above the
  // drawing, which is wherever Pele's own content began below it.
  const titleMatch = /<text\b[^>]*class="pele-title"[^>]*>/.exec(source);
  let titleRoom = 0;
  if (titleMatch) {
    let top = Infinity;
    for (const n of nodes.values()) top = Math.min(top, n.at.y + n.box.minY);
    for (const c of clusterById.values()) top = Math.min(top, c.old.minY);
    if (Number.isFinite(top)) titleRoom = Math.max(0, top - pad);
  }
  if (isEmpty(extent)) grow(extent, 0, 0);
  const width = Math.ceil(Math.max(extent.maxX - extent.minX + 2 * pad, titleWidth));
  // A title wider than the drawing centers the drawing under it.
  const ox = (width - (extent.maxX - extent.minX)) / 2 - extent.minX;
  const oy = pad + titleRoom - extent.minY;
  const height = Math.ceil(extent.maxY - extent.minY + titleRoom + 2 * pad);

  let nodesOut = '';
  for (const [id, n] of nodes) {
    const p = placed.get(id);
    const open = p ? withAttr(n.el.open, 'transform', `translate(${num(p.x + ox)},${num(p.y + oy)})`) : n.el.open;
    nodesOut += open + n.el.inner + '</g>';
  }

  // Filled group boxes, as Pele collects them: an edge over one takes
  // its ink, stretch by stretch.
  const fills: Fill[] = [];
  for (const [id, c] of clusterById) {
    const shape = shapeOf.get(id);
    const rectTag = /<rect\b[^>]*>/.exec(c.el.inner)![0];
    const style = /\sstyle="[^"]*"/.exec(rectTag)?.[0] ?? '';
    if (!shape || !paints(style)) continue;
    const r = groupBounds(shape);
    const box = { minX: r.minX + ox, minY: r.minY + oy, maxX: r.maxX + ox, maxY: r.maxY + oy };
    if (shape.kind === 'box') {
      fills.push({ box, style });
    } else {
      fills.push({ box, style, band: shape.outline.map((p) => ({ x: p.x + ox, y: p.y + oy })) });
    }
  }

  let edgesOut = '';
  // Every redrawn line, so a box's title can step out of their way.
  const drawnLines: Point[][] = [];
  const edgesGroup = findGroup(source, 'pele-edges');
  const modelById = new Map(modelEdges.map(({ e, id }) => [id, e]));
  for (const el of childGroups(edgesGroup?.inner ?? '')) {
    const id = attr(el.open, 'data-id');
    const e = id === undefined ? undefined : modelById.get(id);
    const r = id === undefined ? undefined : routed.get(id);
    if (!e || !r || r.points.length < 2) continue;
    const pts = r.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
    const [startType, endType] = markersOf(e);
    const [sdx, sdy] = unit(pts[1]!, pts[0]!);
    const [edx, edy] = unit(pts[pts.length - 2]!, pts[pts.length - 1]!);
    const tipStart = pts[0]!;
    const tipEnd = pts[pts.length - 1]!;
    // Pele shortens a path under its marker so the line ends inside
    // the arrowhead, not at its tip.
    const line = pts.slice();
    const ts = TRIM[startType] ?? 0;
    const te = TRIM[endType] ?? 0;
    line[0] = { x: tipStart.x - sdx * ts, y: tipStart.y - sdy * ts };
    line[line.length - 1] = { x: tipEnd.x - edx * te, y: tipEnd.y - edy * te };
    drawnLines.push(line);
    const pathTag = /<path\b[^>]*>/.exec(el.inner)?.[0] ?? '<path/>';
    const lineStyle = /\sstyle="[^"]*"/.exec(el.open)?.[0] ?? '';
    const dashes = dashPattern(attr(pathTag, 'stroke-dasharray') ?? /[";]stroke-dasharray:([^;"]+);/.exec(lineStyle)?.[1]);
    // The ink Pele gave the edge in its own layout is stale: it is
    // worked out again from where the edge runs now.
    const { stretches, tips } = paintLine(line, fills, lineStyle, [tipStart, tipEnd], dashes);
    // Pele's markers carry the edge's plain color, unless Pele inked
    // the edge. An inked edge has no stroke color of its own, so its
    // plain color is the theme's line color. The color can come from
    // the diagram's own linkStyle, so it is escaped again before it is
    // written back.
    const plain =
      attr(el.open, 'stroke') !== undefined
        ? 'var(--_l)'
        : escapeAttr(attr(/<[^>]*class="pele-marker"[^>]*>/.exec(el.inner)?.[0] ?? '', 'fill') ?? 'var(--_l)');
    // A marker takes the ink under its tip.
    const startColor = tips[0] ? escapeAttr(tips[0]) : plain;
    const endColor = tips[1] ? escapeAttr(tips[1]) : plain;
    // Pele writes the ink as the group's stroke, after its data-id. A
    // stale one goes. A line in several stretches carries each one's
    // ink on its path. Its dashes run on from one path to the next, and
    // its joins sit in dash gaps. A solid line's paths meet with butt
    // ends, so two round ends don't overlap where a stroke-opacity
    // would show it; its two outer ends reach as far as round ones.
    let open = el.open.replace(/\sstroke="[^"]*"/, '');
    let paths: string;
    const first = stretches[0]!;
    if (stretches.length === 1) {
      if (first.ink) open = open.replace(/\sdata-id="[^"]*"/, (id) => `${id} stroke="${escapeAttr(first.ink!)}"`);
      paths = withAttr(pathTag, 'd', pathD(line));
    } else {
      const half = lineWidth(lineStyle, e.stroke === 'thick') / 2;
      const reach = (p: Point, from: Point): Point => {
        const [ux, uy] = unit(from, p);
        return { x: p.x + ux * half, y: p.y + uy * half };
      };
      paths = stretches
        .map((st, k) => {
          const pts = st.points.slice();
          if (!dashes) {
            if (k === 0) pts[0] = reach(pts[0]!, pts[1]!);
            if (k === stretches.length - 1) pts[pts.length - 1] = reach(pts[pts.length - 1]!, pts[pts.length - 2]!);
          }
          let tag = withAttr(pathTag, 'd', pathD(pts));
          if (st.ink) tag = withAttr(tag, 'stroke', st.ink);
          if (dashes && st.at > 0) tag = withAttr(tag, 'stroke-dashoffset', num(st.at));
          if (!dashes) tag = withAttr(tag, 'stroke-linecap', 'butt');
          return tag;
        })
        .join('');
    }
    edgesOut += open + paths + marker(startType, tipStart, sdx, sdy, startColor) + marker(endType, tipEnd, edx, edy, endColor) + '</g>';
  }

  let labelsOut = '';
  for (const [id, l] of labels) {
    const at = labelAt.get(id);
    if (!at) continue;
    const cx = (l.box.minX + l.box.maxX) / 2;
    const cy = (l.box.minY + l.box.maxY) / 2;
    labelsOut += shifted(l.el, at.x + ox - cx, at.y + oy - cy);
  }

  // A box moves to its new rectangle, and its title moves with the
  // box's top-left corner. A band's rect becomes a path, keeping every
  // attribute but the rect's geometry, and its title moves to the
  // core's title point.
  const clusterShift = new Map<string, Point>();
  let clustersOut = '';
  for (const el of clusterEls) {
    const id = attr(el.open, 'data-id');
    const c = id === undefined ? undefined : clusterById.get(id);
    const shape = id === undefined ? undefined : shapeOf.get(id);
    if (!c || !shape) continue;
    const rectTag = /<rect\b[^>]*>/.exec(el.inner)![0];
    let rest = el.inner.replace(rectTag, '');
    let dx: number;
    let dy: number;
    let wall: string;
    if (shape.kind === 'box') {
      const r = groupBounds(shape);
      dx = r.minX + ox - c.old.minX;
      wall = withAttr(rectTag, 'x', num(r.minX + ox));
      wall = withAttr(wall, 'y', num(r.minY + oy));
      wall = withAttr(wall, 'width', num(r.maxX - r.minX));
      wall = withAttr(wall, 'height', num(r.maxY - r.minY));
      // The core puts the title room at the top or, where spokes or
      // chords cross the top, at the bottom. Along that edge the title
      // takes Pele's spots, in its order: left, middle, right
      // (`clusterTitleX` in Pele's `svg/cluster.ts`), the first that no
      // line runs through, 4px around it as in Pele's `titleCrossed`;
      // failing those, the core's own spot.
      const t = c.title;
      const pad = layoutGroups.find((q) => q.id === id)?.padding;
      const side = pad?.left ?? 0;
      const room = r.minY + oy + (shape.titleSide === 'bottom' ? r.maxY - r.minY - (pad?.top ?? 0) : 0);
      // Pele draws a title TITLE_DROP below its room's top edge.
      dy = room - c.old.minY;
      if (t && t.width > 0) {
        const half = t.width / 2;
        const top = room + TITLE_DROP;
        const spots = [r.minX + ox + side - TITLE_INSET + half, (r.minX + r.maxX) / 2 + ox, r.maxX + ox - side + TITLE_INSET - half];
        const crossed = (x: number) => {
          const around = { minX: x - half - 4, minY: top, maxX: x + half + 4, maxY: top + t.height };
          return drawnLines.some((line) => line.some((a, k) => k + 1 < line.length && clips(a, line[k + 1]!, around)));
        };
        // Where every Pele spot is crossed, the core's spot, which it
        // chose clear of every route.
        const spot = spots.find((x) => !crossed(x)) ?? shape.title.x + ox;
        dx += spot - (t.at.x + dx);
      }
    } else {
      // Pele inks a title for its own fill. A band's title sits outside
      // the band, over the page or over its parent band, so it takes
      // the ink of what is behind it instead.
      const styleOf = (g: string | undefined) =>
        /\sstyle="[^"]*"/.exec(/<rect\b[^>]*>/.exec(g === undefined ? '' : (clusterById.get(g)?.el.inner ?? ''))?.[0] ?? '')?.[0] ?? '';
      const own = styleOf(id);
      const ownInk = paints(own) ? ink(own) : undefined;
      if (ownInk !== undefined) {
        const parent = layoutGroups.find((q) => q.id === id)?.parent;
        const behind = parent !== undefined && shapeOf.get(parent)?.kind === 'band' ? styleOf(parent) : '';
        const backdrop = (paints(behind) ? ink(behind) : undefined) ?? 'var(--_m)';
        rest = rest.replace(/<(?:text|tspan)\b[^>]*>/g, (tag) => (attr(tag, 'fill') === ownInk ? withAttr(tag, 'fill', backdrop) : tag));
      }
      const from = c.title?.at ?? { x: c.old.minX, y: c.old.minY };
      dx = shape.title.x + ox - from.x;
      dy = shape.title.y + oy - from.y;
      wall = withAttr(
        rectTag.replace(/^<rect\b/, '<path').replace(/\s(?:x|y|width|height)="[^"]*"/g, ''),
        'd',
        outlinePath(shape.outline, ox, oy)
      );
    }
    clusterShift.set(id!, { x: dx, y: dy });
    clustersOut += el.open + wall + (rest ? `<g transform="translate(${num(dx)},${num(dy)})">${rest}</g>` : '') + '</g>';
  }
  let titlesOut = '';
  for (const el of struckEls) {
    const id = attr(el.open, 'data-id');
    const s = id === undefined ? undefined : clusterShift.get(id);
    if (s) titlesOut += shifted(el, s.x, s.y);
  }

  // Rebuild the document: Pele's root and head, then each layer in
  // Pele's own order with the same wrappers.
  const openOf = (g: Element | undefined) => g?.open ?? '';
  const layer = (g: Element | undefined, inner: string) => (g && inner ? openOf(g) + inner + '</g>' : '');
  const rootEnd = source.indexOf('>') + 1;
  let root = source.slice(0, rootEnd);
  root = withAttr(root, 'viewBox', `0 0 ${width} ${height}`);
  root = withAttr(root, 'width', String(width));
  root = withAttr(root, 'height', String(height));
  const firstLayer = [titleMatch?.index, findGroup(source, 'pele-clusters')?.start, findGroup(source, 'pele-casings')?.start, edgesGroup?.start, labelsGroup?.start, nodesGroup?.start]
    .filter((i): i is number => i !== undefined)
    .reduce((a, b) => Math.min(a, b), source.length - 6);
  const head = source.slice(rootEnd, firstLayer);
  let title = '';
  if (titleMatch) {
    const end = source.indexOf('</text>', titleMatch.index) + 7;
    // Pele centers the title on its own width; it moves to the new center.
    const shift = num(width / 2 - base.width / 2);
    title = withAttr(titleMatch[0], 'transform', `translate(${shift},0)`) + source.slice(titleMatch.index + titleMatch[0].length, end);
  }
  const svg =
    root +
    head +
    title +
    layer(clustersGroup, clustersOut) +
    layer(edgesGroup, edgesOut) +
    layer(findGroup(source, 'pele-cluster-titles'), titlesOut) +
    layer(labelsGroup, labelsOut) +
    (nodesGroup ? openOf(nodesGroup) + nodesOut + '</g>' : '') +
    '</svg>';
  return { svg, width, height, links: base.links };
};
