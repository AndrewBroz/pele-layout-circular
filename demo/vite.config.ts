import { defineConfig } from 'vite';

/** A page of the demo, as a file path. The demo's tsconfig has no
 *  Node types, so the path comes from a URL, not node:path. */
const page = (name: string) => decodeURIComponent(new URL(name, import.meta.url).pathname);

/** Static build of the demo for GitHub Pages: the playground and the
 *  gallery, with relative asset paths so the site works from a
 *  project subpath. `npm run dev` ignores this build config. */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: { index: page('index.html'), gallery: page('gallery.html') },
    },
  },
});
