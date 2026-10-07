import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative asset paths so the production build works when Electron loads it
  // over the file:// protocol. This is also why the app uses HashRouter.
  base: './',

  plugins: [react(), tailwindcss()],

  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      onwarn(warning, warn) {
        // Zod's prose comments mention @__PURE__ without annotating a call.
        // Rollup already discards these comments; retain every other warning.
        const id = warning.id?.replaceAll('\\', '/');
        if (
          warning.code === 'INVALID_ANNOTATION' &&
          id?.includes('/node_modules/') &&
          /\/zod\/v4\/core\/(regexes|util)\.js$/.test(id)
        )
          return;
        warn(warning);
      },
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/');
          if (!moduleId.includes('/node_modules/')) return;
          if (moduleId.includes('/zod/')) return 'validation';
          if (/\/(react|react-dom|scheduler)\//.test(moduleId)) return 'react';
        },
      },
    },
  },
});
