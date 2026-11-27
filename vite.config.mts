import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The dev server (React Fast Refresh) needs an inline preamble script; production keeps the strict CSP.
const devCsp = (): Plugin => ({
  name: 'dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
});

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), devCsp()],
  resolve: { alias: { '@shared': path.resolve(__dirname, 'src/shared') } },
  build: { outDir: path.resolve(__dirname, 'dist/renderer'), emptyOutDir: true },
  server: { port: 5199, strictPort: false },
});
