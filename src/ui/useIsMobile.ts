import { useSyncExternalStore } from 'react'

/*
 * Phone layout switch (Figma «Mobile — 390»): below 768px.
 * Structural mobile variants are rendered instead of the desktop ones (not hidden
 * with CSS), so each layout's DOM carries only what it shows.
 */
const QUERY = '(max-width: 767px)'
const MAP_COMPACT_QUERY = '(max-width: 1000px)'
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const subscribeMapCompact = (cb: () => void) => {
  const m = window.matchMedia(MAP_COMPACT_QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}

/** The map needs a stacked layout before the app shell leaves enough room for two desktop columns. */
export function useIsMapCompact(): boolean {
  return useSyncExternalStore(subscribeMapCompact, () => window.matchMedia(MAP_COMPACT_QUERY).matches, () => false)
}
