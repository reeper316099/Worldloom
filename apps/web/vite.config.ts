import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only CSP (HMR needs inline/eval). Production gets its strict CSP as an HTTP header from the local server. */
const devCsp = (): Plugin => ({
  name: 'dev-csp',
  apply: 'serve',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://localhost:* http://127.0.0.1:*; script-src 'self' 'unsafe-inline' 'unsafe-eval'" }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  plugins: [react(), devCsp()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:4777', changeOrigin: false, timeout: 0, proxyTimeout: 0 }, '/healthz': 'http://127.0.0.1:4777' } },
});
