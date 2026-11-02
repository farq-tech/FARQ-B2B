/**
 * The map's view in its address, so a link opens the same city, group, step, districts and search. Everything read
 * from the address is untrusted: each value is checked against what it may be, and anything else falls back to the
 * default (nothing is shown from it as is).
 */
export type MapQuery = {
  city: string | null
  lens: string | null
  tool: string | null
  districts: string[]
  q: string | null
  /** The studied activity typed as words (`activity`), or a main activity by id (`main`); one or the other. */
  activity: string | null
  main: string | null
}

export type MapView = { city: string; lens: string; tool: string; districts: string[]; q: string | null; activity?: string | null; main?: string | null }

/** Values the map starts on, which the address leaves out to stay short. */
export const MAP_DEFAULTS = { city: 'Riyadh', lens: 'shops', activity: 'صيدلية' } as const

const CITY = /^[A-Za-z][A-Za-z .'-]{0,39}$/
const DISTRICT = /^[A-Za-z0-9_-]{1,40}$/
const MAIN = /^[A-Za-z0-9_-]{1,40}$/
const MAX_DISTRICTS = 12
const MAX_QUERY = 80

/** A search as typed: control characters and angle brackets dropped, spaces folded, at most 80 characters. */
export function cleanQuery(raw: string | null | undefined): string | null {
  if (raw == null) return null
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY).trim()
  return text || null
}

/**
 * Reads the address. `lenses` maps each group to its steps; a lens outside it, or a step outside the lens it would
 * open in, is dropped. A city or a district only passes its shape here: whether it exists is checked once the city's
 * list and districts load.
 */
export function readMapQuery(search: string, lenses: Record<string, string[]>, goalLens: Record<string, string> = {}): MapQuery {
  const query = new URLSearchParams(search)
  const city = query.get('city')
  const rawLens = query.get('lens') ?? goalLens[query.get('goal') ?? ''] ?? null
  const lens = rawLens != null && Object.prototype.hasOwnProperty.call(lenses, rawLens) ? rawLens : null
  const rawTool = query.get('tool')
  const tool = rawTool != null && (lenses[lens ?? MAP_DEFAULTS.lens] ?? []).includes(rawTool) ? rawTool : null
  const districts = [...new Set((query.get('district') ?? '').split(',').map((id) => id.trim()).filter((id) => DISTRICT.test(id)))].slice(0, MAX_DISTRICTS)
  const main = query.get('main')
  const validMain = main != null && MAIN.test(main) ? main : null
  // a main activity named by id wins over typed words; its name is checked against the city's list once it loads
  return { city: city != null && CITY.test(city) ? city : null, lens, tool, districts, q: cleanQuery(query.get('q')), main: validMain, activity: validMain ? null : cleanQuery(query.get('activity')) }
}

/**
 * Writes the view into `search`, keeping any other parameter it holds. Defaults are left out (the first step of the
 * lens, Riyadh, the shops lens), and the landing's one-time `goal` and `search` go once they have been acted on.
 */
export function writeMapQuery(search: string, view: MapView, firstStep: string): string {
  const query = new URLSearchParams(search)
  const set = (key: string, value: string | null) => { if (value) query.set(key, value); else query.delete(key) }
  // one-time intents from a landing link: the lens they chose is now in the address, and the search box was focused
  query.delete('goal')
  query.delete('search')
  set('city', view.city === MAP_DEFAULTS.city ? null : view.city)
  set('lens', view.lens === MAP_DEFAULTS.lens ? null : view.lens)
  set('tool', view.tool === firstStep ? null : view.tool)
  set('district', view.districts.slice(0, MAX_DISTRICTS).join(',') || null)
  set('q', cleanQuery(view.q))
  const activity = cleanQuery(view.activity)
  set('main', view.main && MAIN.test(view.main) ? view.main : null)
  set('activity', view.main || activity === MAP_DEFAULTS.activity ? null : activity)
  const text = query.toString()
  return text ? `?${text}` : ''
}
