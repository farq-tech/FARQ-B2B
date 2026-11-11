'use client'

import { useCallback, useEffect, useState, type SetStateAction } from 'react'
import { activityKey, fold, studiedFrom, type Activity } from './activity-query.ts'

// A filter outlives the step tab that shows it: moving between steps unmounts a tool, and coming back must find
// the same choices. The values live for the page's life, never in storage. Every mounted user of a key hears a change,
// so a value set by the page (such as the activity a shared link names) reaches the steps already open.
const store = new Map<string, unknown>()
const listeners = new Map<string, Set<(value: unknown) => void>>()

export function useStickyState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial))
  useEffect(() => {
    const hear = (next: unknown) => setValue(next as T)
    let set = listeners.get(key)
    if (!set) { set = new Set(); listeners.set(key, set) }
    set.add(hear)
    // a change made between this render and the subscription is not missed
    if (store.has(key)) setValue(store.get(key) as T)
    return () => { set.delete(hear) }
  }, [key])
  const set = useCallback((next: SetStateAction<T>) => {
    const previous = (store.has(key) ? store.get(key) : initial) as T
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
    setSticky(key, resolved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return [value, set] as const
}

// hears every key: the map writes the choices it keeps in its address (components/lens/map-query.ts) as they change
const watchers = new Set<(key: string) => void>()

/** Sets a key from outside a step (the address read on arrival); every mounted user of it hears, as with its setter. */
export function setSticky(key: string, value: unknown) {
  store.set(key, value)
  for (const hear of listeners.get(key) ?? []) hear(value)
  for (const watch of watchers) watch(key)
}

/** A key's value, or undefined while it was never set (its users still hold their own default). */
export function getSticky(key: string): unknown {
  return store.get(key)
}

/** Calls `watch` after any key changes; returns the unsubscribe. */
export function watchSticky(watch: (key: string) => void) {
  watchers.add(watch)
  return () => { watchers.delete(watch) }
}

/** Whether a key was ever set on this page (by a pick, a shared link or another step), as opposed to still holding
 * its default. Read during render: a set always re-renders every user of the key. */
export function stickyHas(key: string): boolean {
  return store.has(key)
}

/** The activity the user is studying: typed (q), a picked subcategory or specialty (sub_ids / specialty_ids, from
 * market-activities), or an older main activity (main_id) a saved link may still name. */
export type StudiedActivity = { q?: string; main_id?: string; sub_ids?: string[]; specialty_ids?: string[]; label: string }

/** One activity across every step: picked in «أين ينقص نشاطي؟», it is still the one in «المنافسون». */
export function useStudiedActivity() {
  return useStickyState<StudiedActivity>('activity', { q: 'صيدلية', label: 'صيدلية' })
}

/** The main activity whose Arabic name is `label` (spaces and the definite article aside), or null. */
export function matchMain(activities: readonly { main_id: string; main_ar: string }[], label: string): string | null {
  const plain = (text: string) => text.trim().replace(/\s+/g, ' ').replace(/^ال/, '')
  const wanted = plain(label)
  if (!wanted) return null
  return activities.find((activity) => plain(activity.main_ar) === wanted)?.main_id ?? null
}

/** A main-activity picker that also offers «all»: it opens on the studied main activity, and picking one studies it in every step. */
export function useStudiedMainId(activities: { main_id: string; main_ar: string }[]) {
  const [studied, setStudied] = useStudiedActivity()
  const [mainId, setMainId] = useState(studied.main_id ?? '')
  // an activity set elsewhere (another step, or a shared link read after this step mounted) reaches the picker too
  useEffect(() => { if (studied.main_id) setMainId(studied.main_id) }, [studied.main_id])
  // an activity the customer typed in an earlier step («صيدلية») carries over when it is one of the main activities by
  // name, so «نشاط عملائك» and «منشآت الأحياء» open on it; the default nobody picked never does
  const carried = !studied.main_id && stickyHas('activity') ? matchMain(activities, studied.label) : null
  useEffect(() => { if (carried) setMainId((current) => current || carried) }, [carried])
  const pick = useCallback((id: string) => {
    setMainId(id)
    const item = activities.find((activity) => activity.main_id === id)
    if (item) setStudied({ main_id: item.main_id, label: item.main_ar })
  }, [activities, setStudied])
  return [mainId, pick] as const
}

/** The city's entry whose shop name is `label` (spaces and the definite article aside), or undefined. */
export function matchActivity(activities: readonly Activity[], label: string): Activity | undefined {
  const plain = (text: string) => fold(text).replace(/^ال/, '')
  const wanted = plain(label)
  if (!wanted) return undefined
  return activities.find((activity) => plain(activity.name_ar) === wanted)
}

/**
 * An activity picker that also offers «all» (null): it opens on the studied activity when it is a picked subcategory
 * or specialty, or a typed one that names an entry exactly («صيدلية»), and picking one studies it in every step.
 */
export function useStudiedPick(activities: readonly Activity[]) {
  const [studied, setStudied] = useStudiedActivity()
  const studiedPicked = Boolean(studied.sub_ids?.length || studied.specialty_ids?.length || studied.main_id)
  const [picked, setPicked] = useState<StudiedActivity | null>(() => (studiedPicked ? studied : null))
  const studiedKey = activityKey(studied)
  // an activity picked elsewhere (another step, or a shared link read after this step mounted) reaches the picker too
  useEffect(() => { if (studiedPicked) setPicked(studied) }, [studiedKey])  // eslint-disable-line react-hooks/exhaustive-deps
  // a typed activity carries over when it names one of the city's entries; the default nobody picked never does
  const carried = !studiedPicked && stickyHas('activity') ? matchActivity(activities, studied.label) : undefined
  useEffect(() => { if (carried) setPicked((current) => current ?? studiedFrom(carried)) }, [carried])
  const pick = useCallback((item: Activity | null) => {
    const next = item ? studiedFrom(item) : null
    setPicked(next)
    if (next) setStudied(next)
  }, [setStudied])
  return [picked, pick] as const
}
