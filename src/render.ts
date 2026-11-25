import { circularLayout, groupBounds } from 'layout-circular';
import type {
  CircularLayoutOptions,
  GroupBand,
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
const marker = (type: string, p: Point, dx: number, dy: number, color: string, stroke = 'none'): string => {
  const nx = -dy;
  const ny = dx;
  if (type === 'arrow_point') {
    const bx = p.x - dx * ARROW;
    const by = p.y - dy * ARROW;
    const half = ARROW * 0.42;
    return `<path class="pele-marker" d="M${num(p.x)},${num(p.y)}L${num(bx + nx * half)},${num(by + ny * half)}L${num(
      bx - nx * half
    )},${num(by - ny * half)}Z" fill="${color}" stroke="${stroke}"/>`;
  }
  if (type === 'arrow_circle') {
    return `<circle class="pele-marker" cx="${num(p.x - dx * 4)}" cy="${num(p.y - dy * 4)}" r="3.5" fill="${color}" stroke="${stroke}"/>`;
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

/** How much wider a casing is than its edge (`CASE` in Pele's `svg/edges.ts`). */
const CASE = 4;

/** Pele's own casing layer (`casingsSvg` in Pele's `svg/edges.ts`). */
const CASINGS_OPEN = `<g class="pele-casings" fill="none" stroke="var(--_bg)" stroke-width="${1 + CASE}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none">`;

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
 *  the ring also carries the band, and `box` is its bounds. */
export interface Fill {
  box: Box;
  style: string;
  band?: Band;
}

/** A slice of an annulus around (cx, cy), swept clockwise. */
export interface Band {
  cx: number;
  cy: number;
  rIn: number;
  rOut: number;
  start: number;
  end: number;
}

/** How far a point lies inside a band, px: negative outside. */
const insideBand = (b: Band, p: Point): number => {
  const rho = Math.hypot(p.x - b.cx, p.y - b.cy);
  const tau = 2 * Math.PI;
  const into = (((Math.atan2(p.y - b.cy, p.x - b.cx) - b.start) % tau) + tau) % tau;
  const sweep = b.end - b.start;
  // Past the end ray, the angle wraps round to just short of a turn.
  const toEnds = into <= sweep ? Math.min(into, sweep - into) : -Math.min(into - sweep, tau - into);
  return Math.min(rho - b.rIn, b.rOut - rho, rho * Math.sin(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, toEnds))));
};

/** The line's points, with a point every 4px or closer between them,
 *  so a curved wall can't slip between two far-apart points. */
const dense = (line: Point[]): Point[] => {
  const out: Point[] = [];
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k]!;
    const b = line[k + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let i = 0; i < steps; i++) out.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  }
  if (line.length > 0) out.push(line[line.length - 1]!);
  return out;
};

/**
 * The innermost fill that holds a whole edge and its marker tips, `''`
 * where the edge crosses a fill's border, or undefined off every fill
 * (`fillUnder` and `enters` in Pele's `svg/edges.ts`). An edge that
 * only touches a fill counts. Pele insets each box by half a pixel, so
 * an edge along a border doesn't count as entering.
 */
const fillUnder = (line: Point[], tips: Point[], fills: Fill[]): Fill | '' | undefined => {
  const bounds = emptyBox();
  for (const p of line.concat(tips)) grow(bounds, p.x, p.y);
  let holder: Fill | undefined;
  let least = Infinity;
  for (const fill of fills) {
    const f = fill.box;
    const inset = { minX: f.minX + 0.5, minY: f.minY + 0.5, maxX: f.maxX - 0.5, maxY: f.maxY - 0.5 };
    if (bounds.maxX < inset.minX || bounds.minX > inset.maxX || bounds.maxY < inset.minY || bounds.minY > inset.maxY) continue;
    if (fill.band) {
      // A band's wall is curved: the line, sampled densely, enters it
      // where a point lies more than half a pixel inside.
      const band = fill.band;
      const points = dense(line).concat(tips);
      if (!points.some((p) => insideBand(band, p) > 0.5)) continue;
      if (points.some((p) => insideBand(band, p) < 0)) return '';
      const area = ((band.end - band.start) / 2) * (band.rOut * band.rOut - band.rIn * band.rIn);
      if (area < least) {
        least = area;
        holder = fill;
      }
      continue;
    }
    let touched = false;
    for (let k = 0; k + 1 < line.length && !touched; k++) {
      const a = line[k]!;
      const b = line[k + 1]!;
      const off =
        (a.x < inset.minX && b.x < inset.minX) ||
        (a.x > inset.maxX && b.x > inset.maxX) ||
        (a.y < inset.minY && b.y < inset.minY) ||
        (a.y > inset.maxY && b.y > inset.maxY);
      touched = !off && clips(a, b, inset);
    }
    for (const t of tips) touched ||= t.x > inset.minX && t.x < inset.maxX && t.y > inset.minY && t.y < inset.maxY;
    if (!touched) continue;
    if (bounds.minX < f.minX || bounds.maxX > f.maxX || bounds.minY < f.minY || bounds.maxY > f.maxY) return '';
    const area = (f.maxX - f.minX) * (f.maxY - f.minY);
    if (area < least) {
      least = area;
      holder = fill;
    }
  }
  return holder;
};

/**
 * The ink for an edge drawn over the fills: the color of the innermost
 * fill that holds it, `''` for a casing, or undefined off every fill
 * (`overFills` and `edgeInk` in Pele's `svg/edges.ts`). An edge with
 * its own stroke color, or over a fill whose ink is unknown, gets a
 * casing instead of an ink.
 */
export const overFills = (line: Point[], tips: Point[], fills: Fill[], lineStyle: string): string | undefined => {
  const fill = fillUnder(line, tips, fills);
  if (!fill) return fill;
  return (/[";]stroke:/.test(lineStyle) ? undefined : ink(fill.style)) ?? '';
};

/**
 * A wider page-colored stroke under an edge, as faint as it, with its
 * markers stripped of their class so marker styles skip them (`casing`
 * in Pele's `svg/edges.ts`). `line` is the edge's style attribute as
 * Pele wrote it, still escaped, so what is copied from it stays safe.
 */
const casing = (d: string, markers: string, line: string, thick: boolean): string => {
  const decl = (prop: string): string | undefined =>
    line.includes(prop) ? new RegExp(`[";]${prop}:([^;"]+);`).exec(line)?.[1]!.trim() : undefined;
  const stroke = decl('stroke');
  if (stroke === 'none' || stroke === 'transparent') return '';
  // Pele draws a thick edge 2.5 wide.
  const width = thick ? '2.5' : decl('stroke-width');
  let attrs = '';
  let style = '';
  if (width !== undefined && /^[\d.]+(?:px)?$/.test(width)) {
    if (parseFloat(width) !== 1) attrs = ` stroke-width="${num(parseFloat(width) + CASE)}"`;
  } else if (width !== undefined) {
    style += `stroke-width:calc(${width} + ${CASE}px);`;
  }
  for (const prop of ['opacity', 'stroke-opacity']) {
    const value = decl(prop);
    if (value !== undefined) style += `${prop}:${value};`;
  }
  const body = `<path d="${d}"/>` + markers.replace(/ class="pele-marker"/g, '');
  return attrs || style ? `<g${attrs}${style ? ` style="${style}"` : ''}>${body}</g>` : body;
};

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

/** A band's outline: the outer arc clockwise, the inner arc back. */
const bandPath = (b: GroupBand, ox: number, oy: number): string => {
  const at = (r: number, a: number) => `${num(ox + b.center.x + r * Math.cos(a))},${num(oy + b.center.y + r * Math.sin(a))}`;
  const large = b.endAngle - b.startAngle > Math.PI ? 1 : 0;
  const outer = `M${at(b.outerRadius, b.startAngle)}A${num(b.outerRadius)},${num(b.outerRadius)} 0 ${large} 1 ${at(b.outerRadius, b.endAngle)}`;
  if (b.innerRadius <= 0) return `${outer}L${num(ox + b.center.x)},${num(oy + b.center.y)}Z`;
  return `${outer}L${at(b.innerRadius, b.endAngle)}A${num(b.innerRadius)},${num(b.innerRadius)} 0 ${large} 0 ${at(b.innerRadius, b.startAngle)}Z`;
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
  // its ink, and an edge that crosses one's border gets a casing.
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
      const { center, innerRadius: rIn, outerRadius: rOut, startAngle: start, endAngle: end } = shape;
      fills.push({ box, style, band: { cx: center.x + ox, cy: center.y + oy, rIn, rOut, start, end } });
    }
  }

  let casingsOut = '';
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
    const d = 'M' + line.map((p) => `${num(p.x)},${num(p.y)}`).join('L');
    const pathTag = /<path\b[^>]*>/.exec(el.inner)?.[0] ?? '<path/>';
    const lineStyle = /\sstyle="[^"]*"/.exec(el.open)?.[0] ?? '';
    // The ink Pele gave the edge in its own layout is stale: it is
    // worked out again from where the edge runs now.
    const over = overFills(line, [tipStart, tipEnd], fills, lineStyle);
    // Pele's markers carry the edge's plain color, unless Pele inked
    // the edge. An inked edge has no stroke color of its own, so its
    // plain color is the theme's line color. The color can come from
    // the diagram's own linkStyle, so it is escaped again before it is
    // written back.
    const plain =
      attr(el.open, 'stroke') !== undefined
        ? 'var(--_l)'
        : escapeAttr(attr(/<[^>]*class="pele-marker"[^>]*>/.exec(el.inner)?.[0] ?? '', 'fill') ?? 'var(--_l)');
    const color = over || plain;
    if (over === '') {
      const bg = 'var(--_bg)';
      casingsOut += casing(
        d,
        marker(startType, tipStart, sdx, sdy, bg, bg) + marker(endType, tipEnd, edx, edy, bg, bg),
        lineStyle,
        e.stroke === 'thick'
      );
    }
    // Pele writes the ink as the group's stroke, after its data-id. A
    // stale one goes.
    let open = el.open.replace(/\sstroke="[^"]*"/, '');
    if (over) open = open.replace(/\sdata-id="[^"]*"/, (id) => `${id} stroke="${escapeAttr(over)}"`);
    edgesOut +=
      open +
      withAttr(pathTag, 'd', d) +
      marker(startType, tipStart, sdx, sdy, color) +
      marker(endType, tipEnd, edx, edy, color) +
      '</g>';
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
        bandPath(shape, ox, oy)
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
    (casingsOut ? CASINGS_OPEN + casingsOut + '</g>' : '') +
    layer(edgesGroup, edgesOut) +
    layer(findGroup(source, 'pele-cluster-titles'), titlesOut) +
    layer(labelsGroup, labelsOut) +
    (nodesGroup ? openOf(nodesGroup) + nodesOut + '</g>' : '') +
    '</svg>';
  return { svg, width, height, links: base.links };
};
