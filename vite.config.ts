import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// «فرق تسعير» — standalone owner-only UI over the Farq API. In dev, /_api/* is
// proxied to api.farq.sa (same path the hosted server.py proxies in production).
// Dev never sends: the targeting send endpoint answers 403 here before any proxy (server.py opens it only with TARGETING_SEND=1).
const blockTargetingSend = {
  name: 'block-targeting-send',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/_targeting/send')) { res.statusCode = 403; res.setHeader('content-type', 'application/json'); res.end('{"ok":false,"error":"SEND_DISABLED"}'); return }
      next()
    })
  },
}

export default defineConfig({
  plugins: [blockTargetingSend, react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5180,
    proxy: {
      // One isolated read-only core for both platforms. Never enabled by default.
      ...(process.env.VITE_FARQ_COMMERCIAL_INTELLIGENCE === '1' ? {
        '/__commercial': { target: 'http://127.0.0.1:8767', changeOrigin: false, rewrite: (p: string) => p.replace(/^\/__commercial/, '') },
      } : {}),
      '/_api': { target: process.env.VITE_API_PROXY_TARGET || 'https://api.farq.sa', changeOrigin: true, rewrite: (p) => p.replace(/^\/_api/, '') },
      // the targeting service run locally without any send keys: `PORT=8766 python3 server.py` in ~/farq-targeting
      '/_targeting': { target: process.env.VITE_TARGETING_TARGET || 'http://127.0.0.1:8766', changeOrigin: true, rewrite: (p) => p.replace(/^\/_targeting/, '') },
    },
  },
  // manifest: server.py reads it to serve only the landing's own files without the site password
  build: { sourcemap: false, manifest: true },
})
