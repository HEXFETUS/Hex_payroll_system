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
  },
});
