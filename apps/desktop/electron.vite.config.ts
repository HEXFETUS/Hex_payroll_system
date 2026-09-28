import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/*
 * Only `main` and `preload` are built here.
 *
 * The renderer is apps/web, which owns its own Vite pipeline (React, Tailwind,
 * router, query client). That separation is deliberate: apps/web must stay
 * capable of building for a plain browser with no Electron coupling, and
 * duplicating its plugin configuration into this file would guarantee the two
 * drift apart.
 *
 * This file is CommonJS (apps/desktop/package.json has no "type": "module"),
 * which is why __dirname is available.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
});
