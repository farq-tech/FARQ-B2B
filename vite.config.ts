import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// «فرق تسعير» — standalone owner-only UI over the Farq API. In dev, /_api/* is
// proxied to api.farq.sa (same path the hosted server.py proxies in production).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5180,
    proxy: { '/_api': { target: process.env.VITE_API_PROXY_TARGET || 'https://api.farq.sa', changeOrigin: true, rewrite: (p) => p.replace(/^\/_api/, '') } },
  },
  // manifest: server.py reads it to serve only the landing's own files without the site password
  build: { sourcemap: false, manifest: true },
})
