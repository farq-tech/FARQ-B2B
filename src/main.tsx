import { Component, lazy, StrictMode, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

/*
 * Two separate bundles behind one index.html:
 *   / and /landing   public landing (src/pages/landing) — imports no app code and no API client
 *   everything else  the owner-only app (src/App) — server.py keeps these chunks behind the site gate
 * Dev only (dropped from `vite build`): /ui component gallery, /live-bg background preview, ?harness= fixtures.
 */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <main dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">تعذّر تحميل الصفحة</h1>
      <p>تأكد من الاتصال، ثم حاول مرة ثانية.</p>
      <button type="button" onClick={() => window.location.reload()} className="rounded-lg border px-6 py-3 focus-visible:outline-2">إعادة المحاولة</button>
    </main>
  }
}
const Landing = lazy(() => import('./pages/landing'))
const App = lazy(() => import('./App'))

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const search = new URLSearchParams(window.location.search)
const harness = import.meta.env.DEV ? search.get('harness') : null

if (import.meta.env.DEV && import.meta.env.VITE_FARQ_COMMERCIAL_INTELLIGENCE === '1' && path === '/commercial-review') {
  void import('./dev/CommercialReview').then((m) => createRoot(document.getElementById('root')!).render(<m.default />))
} else if (import.meta.env.DEV && path === '/ui') {
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
      <PageBoundary><Suspense fallback={<output aria-live="polite" className="flex min-h-screen items-center justify-center p-6">جارٍ تحميل الصفحة…</output>}>{isLanding ? <Landing /> : <App />}</Suspense></PageBoundary>
    </StrictMode>,
  )
}
