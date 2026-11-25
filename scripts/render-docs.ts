// Draws the README and gallery pictures: every demo case with a `doc`
// name, rendered by Pele in Node, on a white card.
//
//   node scripts/render-docs.ts [--out <dir>] [--only <id,id,...>]
//
// It reads the build, not src/: Node can't resolve src/'s `.js` import
// specifiers to `.ts` files. `npm run docs:images` builds first.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { register, render } from 'pele';
import flowchart from 'pele/diagrams/flowchart';
import { withCircularLayout } from '../dist/pele-layout-circular.js';
import { cases, circularSource, peleSource } from '../demo/cases.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'docs/media' },
    only: { type: 'string' },
  },
});
const only = values.only ? new Set(values.only.split(',')) : undefined;

/** White card behind the diagram, so it reads on GitHub's dark theme. */
const PAD = 16; // room between the diagram and the card's edge, in px
const card = (svg: string): string => {
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  if (!m) throw new Error('no viewBox');
  const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
  const W = w + 2 * PAD;
  const H = h + 2 * PAD;
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  // The font line must land on the root's own style, and only once.
  if ((root.match(/ style="/g) ?? []).length !== 1) throw new Error('root <svg> needs exactly one style');
  // Pele measures text with sans-serif metrics. These three fonts share
  // Arial's metrics and cover macOS, Windows and Linux.
  const font = '--pele-font:Helvetica,Arial,&quot;Liberation Sans&quot;,sans-serif;';
  const newRoot = root
    .replace(m[0], `viewBox="${x - PAD} ${y - PAD} ${W} ${H}"`)
    .replace(/ width="[\d.]+" height="[\d.]+"/, ` width="${W}" height="${H}"`)
    .replace(/ style="/, ` style="${font}`);
  const rect = `<rect x="${x - PAD + 0.5}" y="${y - PAD + 0.5}" width="${W - 1}" height="${H - 1}" rx="8" fill="#ffffff" stroke="#d0d7de"/>`;
  return svg.replace(root, newRoot + rect);
};

register(withCircularLayout(flowchart));
mkdirSync(values.out, { recursive: true });

const write = (name: string, source: string) => {
  if (only && !only.has(name)) return;
  const svg = card(render(source).svg);
  writeFileSync(join(values.out, `${name}.svg`), svg);
  const width = /<svg\b[^>]* width="([\d.]+)"/.exec(svg)![1];
  console.log(`${name}.svg  ${width}`);
};

for (const c of cases) {
  if (c.doc) write(c.doc, circularSource(c));
  if (c.docPele) write(c.docPele, peleSource(c));
}
