import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
