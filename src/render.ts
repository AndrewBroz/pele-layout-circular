import { circularLayout } from 'layout-circular';
import type { CircularLayoutOptions, LayoutEdgeInput, LayoutNodeInput, Point } from 'layout-circular';
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
 *  it (`Fill` in Pele's `svg/edges.ts`). */
export interface Fill {
  box: Box;
  style: string;
}

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

  const result = circularLayout(layoutNodes, layoutEdges, layoutOptions);
  const placed = new Map(result.nodes.map((n) => [n.id, n]));
  const routed = new Map(result.edges.map((e) => [e.id, e]));
  const sizeOf = new Map(layoutNodes.map((n) => [n.id, n]));

  // Everything is laid out around the origin; `extent` collects what
  // the drawing covers so it can be moved into the frame at the end.
  const extent = emptyBox();
  for (const n of result.nodes) {
    const s = sizeOf.get(n.id)!;
    grow(extent, n.x - s.width / 2, n.y - s.height / 2);
    grow(extent, n.x + s.width / 2, n.y + s.height / 2);
  }
  for (const e of result.edges) for (const p of e.points) grow(extent, p.x, p.y);

  // Group boxes wrap wherever their members landed, keeping the room
  // Pele left between each box and its contents on every side.
  const clustersGroup = findGroup(source, 'pele-clusters');
  const clusterEls = childGroups(clustersGroup?.inner ?? '');
  const clusterById = new Map<string, { el: Element; old: Box }>();
  for (const el of clusterEls) {
    const id = attr(el.open, 'data-id');
    const old = rectOf(el.inner);
    if (id !== undefined && old) clusterById.set(id, { el, old });
  }
  const groupParent = new Map<string, string>();
  for (const id of clusterById.keys()) {
    const p = parentOf.get(id);
    if (p !== undefined) groupParent.set(id, p);
  }
  const depth = (id: string): number => {
    let d = 0;
    for (let p = groupParent.get(id); p !== undefined && d < 100; p = groupParent.get(p)) d++;
    return d;
  };
  const newRect = new Map<string, Box>();
  const deepFirst = [...clusterById.keys()].sort((a, b) => depth(b) - depth(a));
  for (const g of deepFirst) {
    const before = emptyBox();
    const after = emptyBox();
    for (const [id, n] of nodes) {
      if (parentOf.get(id) !== g) continue;
      const p = placed.get(id);
      const s = sizeOf.get(id);
      if (!p || !s) continue;
      grow(before, n.at.x - s.width / 2, n.at.y - s.height / 2);
      grow(before, n.at.x + s.width / 2, n.at.y + s.height / 2);
      grow(after, p.x - s.width / 2, p.y - s.height / 2);
      grow(after, p.x + s.width / 2, p.y + s.height / 2);
    }
    for (const [child, parent] of groupParent) {
      if (parent !== g) continue;
      const cOld = clusterById.get(child)?.old;
      const cNew = newRect.get(child);
      if (cOld) {
        grow(before, cOld.minX, cOld.minY);
        grow(before, cOld.maxX, cOld.maxY);
      }
      if (cNew) {
        grow(after, cNew.minX, cNew.minY);
        grow(after, cNew.maxX, cNew.maxY);
      }
    }
    if (isEmpty(before) || isEmpty(after)) continue;
    const old = clusterById.get(g)!.old;
    const r = {
      minX: after.minX - (before.minX - old.minX),
      minY: after.minY - (before.minY - old.minY),
      maxX: after.maxX + (old.maxX - before.maxX),
      maxY: after.maxY + (old.maxY - before.maxY),
    };
    newRect.set(g, r);
    grow(extent, r.minX, r.minY);
    grow(extent, r.maxX, r.maxY);
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
    const r = newRect.get(id);
    const rectTag = /<rect\b[^>]*>/.exec(c.el.inner)![0];
    const style = /\sstyle="[^"]*"/.exec(rectTag)?.[0] ?? '';
    if (!r || !paints(style)) continue;
    fills.push({ box: { minX: r.minX + ox, minY: r.minY + oy, maxX: r.maxX + ox, maxY: r.maxY + oy }, style });
  }

  let casingsOut = '';
  let edgesOut = '';
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

  // A group box moves to its new rectangle; its title moves with the
  // box's top-left corner.
  const clusterShift = new Map<string, Point>();
  let clustersOut = '';
  for (const el of clusterEls) {
    const id = attr(el.open, 'data-id');
    const c = id === undefined ? undefined : clusterById.get(id);
    const r = id === undefined ? undefined : newRect.get(id);
    if (!c || !r) continue;
    const dx = r.minX + ox - c.old.minX;
    const dy = r.minY + oy - c.old.minY;
    clusterShift.set(id!, { x: dx, y: dy });
    const rectTag = /<rect\b[^>]*>/.exec(el.inner)![0];
    let rect = withAttr(rectTag, 'x', num(r.minX + ox));
    rect = withAttr(rect, 'y', num(r.minY + oy));
    rect = withAttr(rect, 'width', num(r.maxX - r.minX));
    rect = withAttr(rect, 'height', num(r.maxY - r.minY));
    const rest = el.inner.replace(rectTag, '');
    clustersOut += el.open + rect + (rest ? `<g transform="translate(${num(dx)},${num(dy)})">${rest}</g>` : '') + '</g>';
  }
  let titlesOut = '';
  for (const el of childGroups(findGroup(source, 'pele-cluster-titles')?.inner ?? '')) {
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
