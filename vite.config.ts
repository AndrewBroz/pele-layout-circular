import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'pele-layout-circular',
    },
    rollupOptions: {
      // Pele is the host; layout-circular is compiled in.
      external: [/^pele(\/|$)/],
    },
  },
});
