/**
 * The colors of Pele's ink: whether a fill paints, and the color Pele
 * draws a line over it in. Copied from Pele's `svg/ink.ts`, which
 * isn't exported. Only hex and named colors are read: the flowchart
 * grammar can't spell `rgb()` or `hsl()`, whose parentheses it
 * rejects. Any other color counts as opaque and unknown, as in Pele.
 */

/** Named colors that #fff contrasts with more than #1f1f1f does, and
 *  the rest (`DARK` and `LIGHT` in Pele's `svg/ink.ts`). */
const DARK = new Set(
  'black blue blueviolet brown crimson darkblue darkcyan darkgreen darkmagenta darkolivegreen darkorchid darkred darkslateblue darkslategray darkviolet dimgray firebrick forestgreen green indigo maroon mediumblue mediumslateblue mediumvioletred midnightblue navy olive purple rebeccapurple royalblue saddlebrown seagreen sienna slateblue steelblue teal'.split(' ')
);
const LIGHT = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk cyan darkgoldenrod darkgray darkkhaki darkorange darksalmon darkseagreen darkturquoise deeppink deepskyblue dodgerblue floralwhite fuchsia gainsboro ghostwhite gold goldenrod gray greenyellow honeydew hotpink indianred ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightpink lightsalmon lightseagreen lightskyblue lightslategray lightsteelblue lightyellow lime limegreen linen magenta mediumaquamarine mediumorchid mediumpurple mediumseagreen mediumspringgreen mediumturquoise mintcream mistyrose moccasin navajowhite oldlace olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue red rosybrown salmon sandybrown seashell silver skyblue slategray snow springgreen tan thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ')
);

/** Pele's ink over a light fill and over a dark one (`ON_LIGHT` and
 *  `ON_DARK` in Pele's `svg/ink.ts`). */
const ON_LIGHT = 'var(--pele-fg-on-light,#1f1f1f)';
const ON_DARK = 'var(--pele-fg-on-dark,#fff)';

const RE_FILL = /[";]fill:([^;"]*)/;
const RE_OPACITIES = /[";](?:fill-)?opacity:([^;"]*)/g;
const RE_HEX = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (r: number, g: number, b: number): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** The luminance where #1f1f1f and #fff contrast equally (`EVEN` in
 *  Pele's `svg/ink.ts`). */
const EVEN = Math.sqrt(1.05 * (luminance(31 / 255, 31 / 255, 31 / 255) + 0.05)) - 0.05;

/** A share from 0 to 1, or NaN for anything but a plain number or
 *  percentage (`amount` in Pele's `svg/ink.ts`). */
const amount = (raw: string, full: number): number => {
  const m = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(%|deg|grad|rad|turn)?$/i.exec(raw);
  if (!m || (m[1] && m[1] !== '%')) return NaN;
  return Math.min(Math.max(parseFloat(raw) / (m[1] ? 100 : full), 0), 1);
};

/** Luminance and alpha of a hex or named color (`color` in Pele's
 *  `svg/ink.ts`). A named color is 0 or 1, which keeps Pele's choice. */
const color = (raw: string): [number, number] | undefined => {
  const value = raw.trim().toLowerCase();
  const name = value.replace('grey', 'gray');
  if (DARK.has(name)) return [0, 1];
  if (LIGHT.has(name)) return [1, 1];
  if (!RE_HEX.test(value)) return undefined;
  const digits = value.length < 6 ? value.slice(1).replace(/./g, '$&$&') : value.slice(1);
  const n = (i: number): number => parseInt(digits.slice(2 * i, 2 * i + 2), 16) / 255;
  return [luminance(n(0), n(1), n(2)), digits.length === 8 ? n(3) : 1];
};

/** How opaque a style's opacities leave its fill, or NaN when one isn't
 *  a plain number (`opacity` in Pele's `svg/ink.ts`). */
const opacity = (style: string): number => {
  let product = 1;
  for (const [, value] of style.matchAll(RE_OPACITIES)) product *= amount(value!.trim(), 1);
  return product;
};

/** Whether a group's style attribute paints a fill (`paints` in Pele's
 *  `svg/ink.ts`). Unknown colors and opacities count as opaque. */
export const paints = (style: string): boolean => {
  const fill = RE_FILL.exec(style)?.[1]!.trim().toLowerCase();
  if (!fill || fill === 'none' || fill === 'transparent') return false;
  const scale = opacity(style);
  return (color(fill)?.[1] ?? 1) * (Number.isNaN(scale) ? 1 : scale) > 0;
};

/**
 * The color Pele draws a line in over a group's fill, or undefined
 * where that depends on what is under the fill: an unknown color, or
 * one less than half opaque (`ink` and `pick` in Pele's `svg/ink.ts`).
 */
export const ink = (style: string): string | undefined => {
  const fill = RE_FILL.exec(style);
  const found = fill ? color(fill[1]!) : undefined;
  if (!found) return undefined;
  // An opacity that isn't a plain number, such as calc() or var(), may still be low.
  if (!(found[1] * opacity(style) >= 0.5)) return undefined;
  return found[0] > EVEN ? ON_LIGHT : ON_DARK;
};
