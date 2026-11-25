/**
 * Reading Pele's SVG output. Pele writes it deterministically, with
 * stable class names and `data-id`s that its CSS themes rely on, so a
 * small scanner is enough: no DOM, no XML parser.
 */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

export const grow = (b: Box, x: number, y: number): void => {
  b.minX = Math.min(b.minX, x);
  b.minY = Math.min(b.minY, y);
  b.maxX = Math.max(b.maxX, x);
  b.maxY = Math.max(b.maxY, y);
};

export const isEmpty = (b: Box): boolean => !Number.isFinite(b.minX);

/** Two decimals, as Pele writes coordinates. */
export const num = (v: number): string => String(Math.round(v * 100) / 100 || 0);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** An attribute's text with Pele's escapes undone. */
export const unescape = (text: string): string =>
  text.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (m, name: string, dec?: string, hex?: string) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[name.toLowerCase()] ?? m;
  });

/** The value of `name` in an opening tag, unescaped. */
export const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescape(m[1]!) : undefined;
};

/** Text made safe inside a double-quoted attribute. Whatever `attr`
 *  decoded must pass through here before it is written back. */
export const escapeAttr = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`);

/** The opening tag with `name` set to `value`, added when absent. */
export const withAttr = (tag: string, name: string, value: string): string => {
  const safe = escapeAttr(value);
  const re = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, (_, open: string, close: string) => open + safe + close);
  return tag.replace(/(\/?>)$/, (end: string) => ` ${name}="${safe}"${end}`);
};

/** End of the element that starts at `from`, which must be a `<g`. */
const groupEnd = (svg: string, from: number): number => {
  const re = /<g[\s>]|<\/g>/g;
  re.lastIndex = from;
  let depth = 0;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    depth += m[0] === '</g>' ? -1 : 1;
    if (depth === 0) return m.index + 4;
  }
  return svg.length;
};

/** An element: its opening tag, its inner markup, and its span in the source. */
export interface Element {
  open: string;
  inner: string;
  start: number;
  end: number;
}

const elementAt = (svg: string, start: number): Element => {
  const end = groupEnd(svg, start);
  const openEnd = svg.indexOf('>', start) + 1;
  return { open: svg.slice(start, openEnd), inner: svg.slice(openEnd, end - 4), start, end };
};

/** The group whose class list starts with `className`, if Pele drew one. */
export const findGroup = (svg: string, className: string): Element | undefined => {
  const at = svg.indexOf(`<g class="${className}"`);
  return at < 0 ? undefined : elementAt(svg, at);
};

/** The `<g>` children of a group's inner markup. Other children are skipped. */
export const childGroups = (inner: string): Element[] => {
  const out: Element[] = [];
  for (let i = inner.indexOf('<g'); i >= 0; ) {
    const el = elementAt(inner, i);
    out.push(el);
    i = inner.indexOf('<g', el.end);
  }
  return out;
};

/** Numbers in an attribute such as `points` or a path's `d`. */
const numbers = (text: string): number[] => (text.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);

/** Points along a path, close enough to bound it: every vertex and
 *  control point, and arcs sampled along their true curve. */
const pathPoints = (d: string): [number, number][] => {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  // Numbers per segment; a command's arguments may hold several.
  const STEP: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
  for (const [, cmd, rest] of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const op = cmd!.toUpperCase();
    const rel = cmd !== op;
    const args = numbers(rest!);
    if (op === 'Z') {
      x = sx;
      y = sy;
      continue;
    }
    const step = STEP[op]!;
    for (let i = 0; i + step <= args.length; i += step) {
      const seg = args.slice(i, i + step);
      const bx = rel ? x : 0;
      const by = rel ? y : 0;
      if (op === 'H') {
        x = bx + seg[0]!;
      } else if (op === 'V') {
        y = by + seg[0]!;
      } else if (op === 'A') {
        const [rx, ry, rot, large, sweep, ex, ey] = seg as [number, number, number, number, number, number, number];
        out.push(...arcPoints(x, y, rx, ry, rot, large !== 0, sweep !== 0, bx + ex, by + ey));
        x = bx + ex;
        y = by + ey;
        continue;
      } else {
        // Control points bound a Bézier curve, so they stand in for it.
        for (let j = 0; j < step; j += 2) out.push([bx + seg[j]!, by + seg[j + 1]!]);
        x = bx + seg[step - 2]!;
        y = by + seg[step - 1]!;
        if (op === 'M' && i === 0) {
          sx = x;
          sy = y;
        }
        continue;
      }
      out.push([x, y]);
    }
  }
  return out;
};

/** Samples of an SVG elliptical arc, by the endpoint-to-center
 *  conversion in the SVG spec (appendix B.2.4). */
const arcPoints = (
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotDeg: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): [number, number][] => {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const scale = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
  const cxp = (k * rx * y1p) / ry;
  const cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const out: [number, number][] = [];
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const t = t1 + (dt * i) / steps;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
  return out;
};

/**
 * The drawn extent of a node's markup, in its own coordinates. Text is
 * left out: Pele sizes every shape to hold its label. A nested icon
 * `<svg>` counts by its own box, not by the paths inside its viewBox.
 */
export const markupBox = (inner: string): Box => {
  const markup = inner
    .replace(/<text\b[\s\S]*?<\/text>/g, '')
    .replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/g, '<svg$1/>')
    .replace(/<title\b[\s\S]*?<\/title>/g, '');
  const b = emptyBox();
  const n = (tag: string, name: string) => Number(attr(tag, name) ?? 0);
  for (const m of markup.matchAll(/<(rect|image|svg|circle|ellipse|polygon|polyline|line|path)\b[^>]*>/g)) {
    const tag = m[0];
    switch (m[1]) {
      case 'rect':
      case 'image':
      case 'svg':
        grow(b, n(tag, 'x'), n(tag, 'y'));
        grow(b, n(tag, 'x') + n(tag, 'width'), n(tag, 'y') + n(tag, 'height'));
        break;
      case 'circle':
      case 'ellipse': {
        const rx = n(tag, m[1] === 'circle' ? 'r' : 'rx');
        const ry = n(tag, m[1] === 'circle' ? 'r' : 'ry');
        grow(b, n(tag, 'cx') - rx, n(tag, 'cy') - ry);
        grow(b, n(tag, 'cx') + rx, n(tag, 'cy') + ry);
        break;
      }
      case 'line':
        grow(b, n(tag, 'x1'), n(tag, 'y1'));
        grow(b, n(tag, 'x2'), n(tag, 'y2'));
        break;
      case 'polygon':
      case 'polyline': {
        const v = numbers(attr(tag, 'points') ?? '');
        for (let i = 0; i + 1 < v.length; i += 2) grow(b, v[i]!, v[i + 1]!);
        break;
      }
      case 'path':
        for (const [x, y] of pathPoints(attr(tag, 'd') ?? '')) grow(b, x, y);
        break;
    }
  }
  return b;
};
