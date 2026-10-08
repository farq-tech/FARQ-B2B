import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

/*
 * Two separate bundles behind one index.html:
 *   / and /landing   public landing (src/pages/landing) — imports no app code and no API client
 *   everything else  the owner-only app (src/App) — server.py keeps these chunks behind the site gate
 * Dev only (dropped from `vite build`): /ui component gallery, /live-bg background preview, ?harness= fixtures.
 */
const Landing = lazy(() => import('./pages/landing'))
const App = lazy(() => import('./App'))

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const search = new URLSearchParams(window.location.search)
const harness = import.meta.env.DEV ? search.get('harness') : null

if (import.meta.env.DEV && path === '/ui') {
  void import('./dev/uiGallery').then((m) => m.mountGallery())
} else if (import.meta.env.DEV && path === '/live-bg') {
  void import('./live-bg/DevPage').then((m) => createRoot(document.getElementById('root')!).render(<m.default />))
} else if (import.meta.env.DEV && harness) {
  void import('./dev/harness').then((m) => m.mountHarness(harness))
} else {
  // `/?rfq=<id>` is the legacy request link: it still opens the app.
  const isLanding = (path === '/' && !search.has('rfq')) || path === '/landing'
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>{isLanding ? <Landing /> : <App />}</Suspense>
    </StrictMode>,
  )
}
