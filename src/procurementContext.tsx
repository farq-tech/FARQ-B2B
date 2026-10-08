import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppView } from './types'

/*
 * Minimal navigation state for «فرق تسعير»: which screen, which request —
 * mirrored in the URL so links can be shared and the back button works:
 *   /requests                 طلبات التسعير
 *   /new                      طلب جديد
 *   /requests/:id             متابعة الطلب
 *   /requests/:id/compare     مقارنة العروض
 * `/` opens the list for now (the public landing takes `/` in M5). The legacy
 * `?rfq=<id>` link still opens that request. The dev harness (`?harness=`) is left alone.
 */
type Ctx = {
  view: AppView
  navigate: (v: AppView) => void
  selectedRfqId: string | null
  setSelectedRfqId: (id: string | null) => void
}
const C = createContext<Ctx | null>(null)

type Route = { view: AppView; rfqId: string | null }

export function parseRoute(pathname: string, search = ''): Route {
  const legacy = new URLSearchParams(search).get('rfq')
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/new') return { view: 'create-upload', rfqId: null }
  const m = /^\/requests\/([^/]+)(\/compare)?$/.exec(p)
  if (m) return { view: m[2] ? 'comparison' : 'rfq-detail', rfqId: decodeURIComponent(m[1]) }
  if (legacy) return { view: 'rfq-detail', rfqId: legacy }
  return { view: 'rfq-list', rfqId: null }
}

export function routePath(view: AppView, rfqId: string | null): string {
  if (view === 'create-upload') return '/new'
  if (view === 'rfq-detail' && rfqId) return `/requests/${encodeURIComponent(rfqId)}`
  if (view === 'comparison' && rfqId) return `/requests/${encodeURIComponent(rfqId)}/compare`
  return '/requests'
}

const syncUrl = () => typeof window !== 'undefined' && !new URLSearchParams(window.location.search).has('harness')

export function ProcurementProvider({ children }: { children: ReactNode }) {
  const initial = useRef<Route>(syncUrl() ? parseRoute(window.location.pathname, window.location.search) : { view: 'rfq-list', rfqId: null })
  const [view, setView] = useState<AppView>(initial.current.view)
  const [selectedRfqId, setSelectedRfqId] = useState<string | null>(initial.current.rfqId)
  const fromHistory = useRef(false)

  const navigate = useCallback((v: AppView) => { setView(v); window.scrollTo({ top: 0 }) }, [])

  // State → URL (push for user navigation, replace for the first render and history moves).
  const first = useRef(true)
  useEffect(() => {
    if (!syncUrl()) return
    const path = routePath(view, selectedRfqId)
    if (path === window.location.pathname && !window.location.search) { first.current = false; return }
    if (first.current || fromHistory.current) window.history.replaceState(null, '', path)
    else window.history.pushState(null, '', path)
    first.current = false
    fromHistory.current = false
  }, [view, selectedRfqId])

  // URL → state (back / forward).
  useEffect(() => {
    if (!syncUrl()) return
    const onPop = () => {
      const r = parseRoute(window.location.pathname, window.location.search)
      fromHistory.current = true
      setView(r.view)
      if (r.rfqId) setSelectedRfqId(r.rfqId)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const value = useMemo(() => ({ view, navigate, selectedRfqId, setSelectedRfqId }), [view, navigate, selectedRfqId])
  return <C.Provider value={value}>{children}</C.Provider>
}

export function useProcurement(): Ctx {
  const v = useContext(C)
  if (!v) throw new Error('useProcurement outside provider')
  return v
}
