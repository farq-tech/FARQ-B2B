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
  return name ? { id: view.id, name, href, city: view.city, cityName: view.cityName, districts: view.districts.slice(0, 12), createdAt: view.createdAt } : null
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
