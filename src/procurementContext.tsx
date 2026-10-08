import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AppView } from './types'

/* Minimal navigation state for «فرق تسعير»: which screen, which request. */
type Ctx = {
  view: AppView
  navigate: (v: AppView) => void
  selectedRfqId: string | null
  setSelectedRfqId: (id: string | null) => void
}
const C = createContext<Ctx | null>(null)

export function ProcurementProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('rfq-list')
  const [selectedRfqId, setSelectedRfqId] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get('rfq') } catch { return null }
  })
  const navigate = useCallback((v: AppView) => { setView(v); window.scrollTo({ top: 0 }) }, [])
  const value = useMemo(() => ({ view, navigate, selectedRfqId, setSelectedRfqId }), [view, navigate, selectedRfqId])
  return <C.Provider value={value}>{children}</C.Provider>
}

export function useProcurement(): Ctx {
  const v = useContext(C)
  if (!v) throw new Error('useProcurement outside provider')
  return v
}
