/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import gallery from '../docs/GALLERY.md?raw';
import { cases, circularSource, examples } from './cases.js';

test('the water cycle is the first example', () => {
  expect(examples[0]).toMatchObject({ name: 'water-cycle', label: 'The water cycle' });
  expect(examples[0]?.section).toBeUndefined();
});

test('the other examples are the gallery headings, in order, under their sections', () => {
  const expected: { section: string; label: string }[] = [];
  let section = '';
  for (const [, level, title] of gallery.matchAll(/^(##|###) (.+)$/gm)) {
    if (level === '##') section = title!;
    else expected.push({ section, label: title! });
  }
  expect(examples.slice(1).map(({ section, label }) => ({ section, label }))).toEqual(expected);
});

test('each example has its case text', () => {
  for (const e of examples) {
    const c = cases.find((x) => x.doc === e.name);
    expect(c).toBeDefined();
    expect(e.text).toBe(circularSource(c!));
  }
});

test('example names are unique', () => {
  expect(new Set(examples.map((e) => e.name)).size).toBe(examples.length);
});
