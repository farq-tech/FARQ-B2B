/** Pure activity helpers (no React, no app imports), so node --test reads them as they are. */

/**
 * What a reader picks and every figure counts: a subcategory («مغسلة ملابس»، «صيدلية») or a specialty that has
 * businesses in the city («برجر»، «بيتزا»), as market-activities lists them (owner 2026-11-11: shops are specialties,
 * so a main activity like «أغذية ومشروبات» is a heading, never a pick). `query` is the exact request fragment that
 * returns `n` in district-counts, market-summary, market-gaps, brands and territories.
 */
export type Activity = {
  kind: 'sub' | 'specialty'
  key: string
  name_ar: string
  parent_ar: string
  main_id: string
  main_ar: string
  n: number
  query: { sub_ids?: string[]; specialty_ids?: string[] }
}

/** The ways an activity reaches the service: typed words, a picked subcategory or specialty, or an older main id. */
export type ActivityQuery = { q?: string; main_id?: string; sub_ids?: string[]; specialty_ids?: string[] }

const ID = /^[a-z0-9_.]{1,80}$/
const ids = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length >= 1 && value.length <= max && value.every((item) => typeof item === 'string' && ID.test(item))

/** An entry as the service must send it; anything else is dropped rather than shown. */
export function isActivity(value: unknown): value is Activity {
  const item = value as Activity
  return item != null && (item.kind === 'sub' || item.kind === 'specialty') && typeof item.name_ar === 'string' && item.name_ar.length > 0
    && typeof item.main_ar === 'string' && typeof item.n === 'number' && Number.isFinite(item.n) && item.query != null
    && (item.kind === 'sub' ? ids(item.query.sub_ids, 1) : ids(item.query.specialty_ids, 20))
}

/** The request fragment for an activity: exactly one way of naming it, the most exact first. */
export function activityBody(activity: ActivityQuery | null | undefined): ActivityQuery {
  if (!activity) return {}
  if (activity.q) return { q: activity.q }
  if (activity.specialty_ids?.length) return { specialty_ids: activity.specialty_ids }
  if (activity.sub_ids?.length) return { sub_ids: activity.sub_ids }
  if (activity.main_id) return { main_id: activity.main_id }
  return {}
}

/** One string per activity, for keying answers: a new activity never shows the last one's figures. */
export function activityKey(activity: ActivityQuery | null | undefined): string {
  const body = activityBody(activity)
  return body.q ? `q:${body.q}` : body.specialty_ids ? `spec:${body.specialty_ids.join(',')}`
    : body.sub_ids ? `sub:${body.sub_ids.join(',')}` : body.main_id ? `main:${body.main_id}` : ''
}

/** A picked subcategory or specialty as the address and this browser keep it (`pick`), or null for anything else. */
export function pickToken(activity: ActivityQuery | null | undefined): string | null {
  const body = activityBody(activity)
  const token = body.specialty_ids ? `spec:${body.specialty_ids.join(',')}` : body.sub_ids ? `sub:${body.sub_ids.join(',')}` : null
  return token && PICK.test(token) ? token : null
}

export const PICK = /^(?:sub:[a-z0-9_.]{1,80}|spec:[a-z0-9_.]{1,80}(?:,[a-z0-9_.]{1,80}){0,19})$/

/** The city's entry a `pick` names, once its list has loaded; undefined when it names none there. */
export function activityForToken(token: string, activities: readonly Activity[]): Activity | undefined {
  return activities.find((item) => pickToken(item.query) === token)
}

/** The studied activity a picked entry becomes: its own query and its shop name. */
export function studiedFrom(item: Activity): ActivityQuery & { label: string } {
  return { ...item.query, label: item.name_ar }
}

/** Arabic folded for matching what a reader types: hamza forms, taa marbuta, alef maqsura, tatweel and marks. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim()
}

/**
 * The entries a reader's words find: by the shop name first, then its parent subcategory or heading; the article
 * «ال» is ignored at the start of a word. Without words, the city's largest. Order within each rank stays the
 * service's (largest first).
 */
export function searchActivities(activities: readonly Activity[], text: string, limit = 40): Activity[] {
  const words = fold(text).split(' ').map((word) => word.replace(/^ال/, '')).filter(Boolean)
  if (!words.length) return activities.slice(0, limit)
  const has = (field: string) => { const folded = fold(field); return words.every((word) => folded.includes(word)) }
  const byName = activities.filter((item) => has(item.name_ar))
  const byParent = activities.filter((item) => !byName.includes(item) && has(`${item.parent_ar} ${item.main_ar}`))
  return [...byName, ...byParent].slice(0, limit)
}
