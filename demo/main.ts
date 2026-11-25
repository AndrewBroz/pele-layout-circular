import { register, render } from 'pele';
import flowchart from 'pele/diagrams/flowchart';
import { withCircularLayout } from '../src/index.js';
import { cases, circularSource, peleSource } from './cases.js';

register(withCircularLayout(flowchart));

const gallery = document.querySelector('#gallery')!;

/** One labelled pane: the diagram, or the error that stopped it. */
const pane = (label: string, source: string): HTMLElement => {
  const el = document.createElement('div');
  el.className = 'pane';
  const h = document.createElement('h2');
  h.textContent = label;
  const holder = document.createElement('div');
  holder.className = 'diagram';
  try {
    holder.innerHTML = render(source).svg;
  } catch (error) {
    const message = document.createElement('div');
    message.className = 'error';
    message.textContent = String(error);
    holder.replaceChildren(message);
  }
  el.append(h, holder);
  return el;
};

for (const c of cases) {
  const figure = document.createElement('figure');
  if (c.wide) figure.classList.add('wide');
  const caption = document.createElement('figcaption');
  caption.textContent = c.title;
  const pair = document.createElement('div');
  pair.className = 'pair';
  pair.append(pane(c.layout ?? 'circular', circularSource(c)), pane('Pele', peleSource(c)));
  figure.append(caption, pair);
  gallery.append(figure);
}

const button = document.querySelector<HTMLButtonElement>('#theme')!;
const setTheme = (dark: boolean) => {
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
  button.textContent = dark ? 'Switch to light' : 'Switch to dark';
};
button.addEventListener('click', () => setTheme(!document.body.classList.contains('theme-dark')));
if (new URLSearchParams(location.search).get('theme') === 'dark') setTheme(true);
