'use client'

import { useCallback, useState, type SetStateAction } from 'react'

// A filter outlives the step tab that shows it: moving between steps unmounts a tool, and coming back must find
// the same choices. The values live for the page's life, never in storage.
const store = new Map<string, unknown>()

export function useStickyState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial))
  const set = useCallback((next: SetStateAction<T>) => {
    setValue((previous) => {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
      store.set(key, resolved)
      return resolved
    })
  }, [key])
  return [value, set] as const
}

/** The activity the user is studying: typed (q) or a main activity (main_id). */
export type StudiedActivity = { q?: string; main_id?: string; label: string }

/** One activity across every step: picked in «أين ينقص نشاطي؟», it is still the one in «المنافسون». */
export function useStudiedActivity() {
  return useStickyState<StudiedActivity>('activity', { q: 'صيدلية', label: 'صيدلية' })
}

/** A main-activity picker that also offers «all»: it opens on the studied main activity, and picking one studies it in every step. */
export function useStudiedMainId(activities: { main_id: string; main_ar: string }[]) {
  const [studied, setStudied] = useStudiedActivity()
  const [mainId, setMainId] = useState(studied.main_id ?? '')
  const pick = useCallback((id: string) => {
    setMainId(id)
    const item = activities.find((activity) => activity.main_id === id)
    if (item) setStudied({ main_id: item.main_id, label: item.main_ar })
  }, [activities, setStudied])
  return [mainId, pick] as const
}
