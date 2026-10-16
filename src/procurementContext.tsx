import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppView } from './types'

/*
 * Minimal navigation state for «فرق تسعير»: which screen, which request —
 * mirrored in the URL so links can be shared and the back button works:
 *   /requests                 طلبات التسعير
 *   /new                      طلب جديد
 *   /requests/:id             متابعة الطلب
 *   /requests/:id/compare     مقارنة العروض
 *   /requests/:id/award       تأكيد الترسية (05) — deep link; 04 opens the same sheet in place
 *   /requests/:id/review      → متابعة الطلب: review (02) is a step of /new, before the request has an id
 *   /inbox                    صندوق الوارد (06)
 *   /explore                  استكشف (discovery: أبي أشتري / أبي أبيع)
 *   /opportunity-map                خريطة الفرص (Figma M07 map, was «حملات الموردين») — confirm sheet in place
 *   /opportunity-map/new            خريطة الفرص with «طلب جديد» open (the one place to start anything)
 *   /opportunity-map/templates      قوالب واتساب (09)
 *   /opportunity-map/templates/new  محرر قالب واتساب (08)
 *   /targeting, /targeting/templates, /targeting/templates/new — old links, replaced by the paths above
 *   /login                    دخول فرق (the app shows the login on any route while signed out)
 * `/` is the public landing (main.tsx); the app never renders there except for the legacy
 * `?rfq=<id>` link, which still opens that request. The dev harness (`?harness=`) is left alone.
 */
/** App screens: the copied AppView plus the inbox (not a فرق بناء view, so not added to types.ts). */
export type View = AppView | 'goal-new' | 'explore' | 'inbox' | 'targeting' | 'targeting-new' | 'templates' | 'template-new' | 'account' | 'opportunities'
type Ctx = {
  view: View
  navigate: (v: View) => void
  selectedRfqId: string | null
  setSelectedRfqId: (id: string | null) => void
}
const C = createContext<Ctx | null>(null)

type Route = { view: View; rfqId: string | null }

export function parseRoute(pathname: string, search = ''): Route {
  const legacy = new URLSearchParams(search).get('rfq')
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/account') return { view: 'account', rfqId: null }
  if (p === '/opportunities') return { view: 'opportunities', rfqId: null }
  if (p === '/explore') return { view: 'explore', rfqId: null }
  if (p === '/goals/new') return { view: 'goal-new', rfqId: null }
  if (p === '/new') return { view: 'create-upload', rfqId: null }
  if (p === '/inbox') return { view: 'inbox', rfqId: null }
  // «خريطة الفرص»; the old /targeting links open the same screens (the URL is then replaced)
  if (p === '/opportunity-map' || p === '/targeting') return { view: 'targeting', rfqId: null }
  if (p === '/opportunity-map/new') return { view: 'targeting-new', rfqId: null }
  if (p === '/opportunity-map/templates' || p === '/targeting/templates') return { view: 'templates', rfqId: null }
  if (p === '/opportunity-map/templates/new' || p === '/targeting/templates/new') return { view: 'template-new', rfqId: null }
  if (p === '/login') return { view: 'login', rfqId: null }
  const m = /^\/requests\/([^/]+)(?:\/(compare|award|review))?$/.exec(p)
  if (m) return { view: m[2] === 'compare' ? 'comparison' : m[2] === 'award' ? 'award' : 'rfq-detail', rfqId: decodeURIComponent(m[1]) }
  if (legacy) return { view: 'rfq-detail', rfqId: legacy }
  return { view: 'rfq-list', rfqId: null }
}

export function routePath(view: View, rfqId: string | null): string {
  if (view === 'account') return '/account'
  if (view === 'opportunities') return '/opportunities'
  if (view === 'goal-new') return '/goals/new'
  if (view === 'explore') return '/explore'
  if (view === 'create-upload') return '/new'
  if (view === 'inbox') return '/inbox'
  if (view === 'targeting') return '/opportunity-map'
  if (view === 'targeting-new') return '/opportunity-map/new'
  if (view === 'templates') return '/opportunity-map/templates'
  if (view === 'template-new') return '/opportunity-map/templates/new'
  if (view === 'login') return '/login'
  if (view === 'award' && rfqId) return `/requests/${encodeURIComponent(rfqId)}/award`
  if (view === 'rfq-detail' && rfqId) return `/requests/${encodeURIComponent(rfqId)}`
  if (view === 'comparison' && rfqId) return `/requests/${encodeURIComponent(rfqId)}/compare`
  return '/requests'
}

const syncUrl = () => typeof window !== 'undefined' && !new URLSearchParams(window.location.search).has('harness')

export function ProcurementProvider({ children }: { children: ReactNode }) {
  const initial = useRef<Route>(syncUrl() ? parseRoute(window.location.pathname, window.location.search) : { view: 'rfq-list', rfqId: null })
  const [view, setView] = useState<View>(initial.current.view)
  const [selectedRfqId, setSelectedRfqId] = useState<string | null>(initial.current.rfqId)
  const fromHistory = useRef(false)

  const navigate = useCallback((v: View) => { setView(v); window.scrollTo({ top: 0 }) }, [])

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
      setSelectedRfqId(r.rfqId)
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
