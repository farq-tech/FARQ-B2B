// with extensions, so node --test can load this file for lib/saved-views.test.ts
import { safeMapOrigin } from './handoff.ts'

/**
 * A comparison saved inside Atlas by name (docs/atlas-product-foundation.md §3.4, §9.9): the map's address that reopens
 * it (the city, the group, the step and the two districts) and what it compares, as the map named it. No figure is
 * stored: reopening works the comparison out again from today's numbers. Kept on this device with the requests.
 */
export type SavedView = {
  id: string
  name: string
  /** A `/map?…` address (handoff.safeMapOrigin). */
  href: string
  city: string
  cityName: string
  /** The districts compared, by name as the map showed them. */
  districts: string[]
  createdAt: string
  /** What is compared: two districts (absent, the first kind saved) or a shop owner's candidate sites, named by their
   * slot and district in `districts` (additive: an older reader shows them as it shows districts). */
  kind?: 'sites'
  /** Kept in the signed-in account as well (lib/saved-views.ts mergeSavedViews); absent while on this device only. */
  synced?: boolean
}

const MAX_NAME = 80
export const MAX_VIEWS = 50

/** A name as typed: control characters and angle brackets dropped, spaces folded, at most 80 characters. */
export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim()
}

/** The name a comparison is offered: its districts, «أ مقابل ب». */
export const defaultName = (districts: readonly string[]) => districts.join(' مقابل ')

/** A saved view read back from storage, or null when anything about it is not what was saved. */
export function readView(value: unknown): SavedView | null {
  if (!value || typeof value !== 'object') return null
  const view = value as Partial<SavedView>
  const href = safeMapOrigin(view.href)
  if (typeof view.id !== 'string' || typeof view.name !== 'string' || !href || typeof view.city !== 'string' || typeof view.cityName !== 'string'
    || !Array.isArray(view.districts) || !view.districts.every((name) => typeof name === 'string') || typeof view.createdAt !== 'string') return null
  const name = cleanName(view.name)
  if (!name) return null
  const clean: SavedView = { id: view.id, name, href, city: view.city, cityName: view.cityName, districts: view.districts.slice(0, 12), createdAt: view.createdAt, ...(view.kind === 'sites' ? { kind: 'sites' as const } : {}) }
  return view.synced === true ? { ...clean, synced: true } : clean
}

/**
 * The list with `view` saved: the same address saved again takes its new name and moves to the top instead of a
 * second copy; the newest first, at most MAX_VIEWS. A view whose address or name does not pass is not saved.
 */
export function saveView(list: readonly SavedView[], view: SavedView): SavedView[] {
  const clean = readView(view)
  if (!clean) return [...list]
  return [clean, ...list.filter((item) => item.href !== clean.href)].slice(0, MAX_VIEWS)
}

// ── the account copy ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What makes two saved comparisons the same one: the same map view, whatever order its address lists its parts in.
 * `/map?b=2&a=1` and `/map?a=1&b=2` are one item.
 */
export function viewKey(href: string): string {
  const [path, query = ''] = href.split('?')
  const params = new URLSearchParams(query)
  const sorted = [...params.entries()].sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
  return sorted.length ? `${path}?${new URLSearchParams(sorted)}` : path
}

const newestFirst = (a: SavedView, b: SavedView) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)

/** One item per view (the newest kept), newest first. */
export function dedupeViews(list: readonly SavedView[]): SavedView[] {
  const seen = new Set<string>()
  return [...list].sort(newestFirst).filter((view) => { const key = viewKey(view.href); return !seen.has(key) && Boolean(seen.add(key)) })
}

export type ViewSync = {
  /** The list to show: the account's comparisons with this device's own joined in, newest first, at most MAX_VIEWS. */
  views: SavedView[]
  /** This device's comparisons the account does not have yet (or has under an older name): to send to it. */
  upload: SavedView[]
  /** Addresses to take out of the account: deleted here while the account could not be reached, or beyond the cap. */
  remove: string[]
}

/**
 * The account's saved comparisons joined to this device's, on sign-in and on every load while signed in.
 *
 * - The same view is one item: the account's copy, unless this device renamed it since (its own, newer copy is sent).
 * - A comparison saved on this device while signed out (not `synced`) is kept and sent to the account.
 * - A comparison this device had from the account (`synced`) that the account no longer has was deleted on another
 *   device: it goes here too, instead of coming back.
 * - `removed` (addresses deleted here that the account has not confirmed) stay out, and are asked again.
 * - Newest first, at most MAX_VIEWS: what falls off the end is taken out of the account as well.
 */
export function mergeSavedViews(local: readonly SavedView[], cloud: readonly SavedView[], removed: readonly string[] = []): ViewSync {
  const gone = new Set(removed.map(viewKey))
  const account = new Map(dedupeViews(cloud).map((view) => [viewKey(view.href), { ...view, synced: true as const }]))
  const remove = new Set(removed.filter((href) => account.has(viewKey(href))))
  const kept = new Map<string, SavedView>()
  const upload = new Set<string>()
  for (const [key, view] of account) if (!gone.has(key)) kept.set(key, view)
  for (const view of dedupeViews(local)) {
    const key = viewKey(view.href)
    if (gone.has(key)) continue
    const theirs = account.get(key)
    if (theirs) {
      if (!view.synced && view.createdAt > theirs.createdAt) { kept.set(key, { ...view, id: theirs.id, synced: false }); upload.add(key) }
    } else if (!view.synced) {
      kept.set(key, view)
      upload.add(key)
    }
  }
  const all = [...kept.values()].sort(newestFirst)
  const views = all.slice(0, MAX_VIEWS)
  for (const view of all.slice(MAX_VIEWS)) if (account.has(viewKey(view.href))) remove.add(view.href)
  return { views, upload: views.filter((view) => upload.has(viewKey(view.href))), remove: [...remove] }
}

/** Signed out: only what was saved on this device stays; the account's comparisons stay in the account. */
export const deviceOnlyViews = (list: readonly SavedView[]) => list.filter((view) => !view.synced)

/** The account's record of one comparison: its address, name and districts (and the city's names), never a figure. */
export const VIEW_SCHEMA = 'atlas-saved-view-v1'
export function viewPayload(view: SavedView) {
  const { synced: _synced, ...stored } = view
  return { schema: VIEW_SCHEMA, view: stored }
}
