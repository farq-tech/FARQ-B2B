import { useSyncExternalStore } from 'react'

/*
 * Phone layout switch (Figma «Mobile — 390»): below 768px.
 * Structural mobile variants are rendered instead of the desktop ones (not hidden
 * with CSS), so each layout's DOM carries only what it shows.
 */
const QUERY = '(max-width: 767px)'
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
