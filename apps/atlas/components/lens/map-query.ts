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
  /** A picked subcategory or specialty (`pick`: «sub:personal.laundry», «spec:a,b»); it wins over both above. */
  pick: string | null
  /** The figure shading the districts (`layer`), one of the lens's own figures. */
  layer: string | null
}

export type MapView = { city: string; lens: string; tool: string; districts: string[]; q: string | null; activity?: string | null; main?: string | null; pick?: string | null; layer?: string | null }

/** Values the map starts on, which the address leaves out to stay short. */
export const MAP_DEFAULTS = { city: 'Riyadh', lens: 'shops', activity: 'صيدلية' } as const

const CITY = /^[A-Za-z][A-Za-z .'-]{0,39}$/
const DISTRICT = /^[A-Za-z0-9_-]{1,40}$/
const MAIN = /^[A-Za-z0-9_-]{1,40}$/
// lib/activity-query PICK: a subcategory id, or up to 20 specialty ids of one entry
const PICK = /^(?:sub:[a-z0-9_.]{1,80}|spec:[a-z0-9_.]{1,80}(?:,[a-z0-9_.]{1,80}){0,19})$/
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
 * list and districts load. `layers` maps each group to the figures that may shade its map; a `layer` outside the
 * lens it would open in is dropped.
 */
export function readMapQuery(search: string, lenses: Record<string, string[]>, goalLens: Record<string, string> = {}, layers: Record<string, string[]> = {}): MapQuery {
  const query = new URLSearchParams(search)
  const city = query.get('city')
  const rawLens = query.get('lens') ?? goalLens[query.get('goal') ?? ''] ?? null
  const lens = rawLens != null && Object.prototype.hasOwnProperty.call(lenses, rawLens) ? rawLens : null
  const rawTool = query.get('tool')
  const tool = rawTool != null && (lenses[lens ?? MAP_DEFAULTS.lens] ?? []).includes(rawTool) ? rawTool : null
  const districts = [...new Set((query.get('district') ?? '').split(',').map((id) => id.trim()).filter((id) => DISTRICT.test(id)))].slice(0, MAX_DISTRICTS)
  const rawPick = query.get('pick')
  const pick = rawPick != null && PICK.test(rawPick) ? rawPick : null
  const main = query.get('main')
  const validMain = !pick && main != null && MAIN.test(main) ? main : null
  const rawLayer = query.get('layer')
  const layer = rawLayer != null && (layers[lens ?? MAP_DEFAULTS.lens] ?? []).includes(rawLayer) ? rawLayer : null
  // a picked subcategory or specialty, then a main activity named by id, win over typed words; the name of either is
  // checked against the city's list once it loads
  return { city: city != null && CITY.test(city) ? city : null, lens, tool, districts, q: cleanQuery(query.get('q')), main: validMain, pick, activity: validMain || pick ? null : cleanQuery(query.get('activity')), layer }
}

/**
 * Writes the view into `search`, keeping any other parameter it holds. Defaults are left out (the first step of the
 * lens, Riyadh, the shops lens, the lens's own shading figure `firstLayer`), and the landing's one-time `goal` and
 * `search` go once they have been acted on.
 */
export function writeMapQuery(search: string, view: MapView, firstStep: string, firstLayer?: string): string {
  const query = new URLSearchParams(search)
  const set = (key: string, value: string | null) => { if (value) query.set(key, value); else query.delete(key) }
  // one-time intents from a landing link: the lens they chose is now in the address, and the search box was focused
  query.delete('goal')
  query.delete('search')
  // a saved view's «open on its decision» (lens-map takeClose) is read once, never written back
  query.delete('close')
  set('city', view.city === MAP_DEFAULTS.city ? null : view.city)
  set('lens', view.lens === MAP_DEFAULTS.lens ? null : view.lens)
  set('tool', view.tool === firstStep ? null : view.tool)
  set('district', view.districts.slice(0, MAX_DISTRICTS).join(',') || null)
  set('q', cleanQuery(view.q))
  const activity = cleanQuery(view.activity)
  const pick = view.pick && PICK.test(view.pick) ? view.pick : null
  set('pick', pick)
  set('main', !pick && view.main && MAIN.test(view.main) ? view.main : null)
  // the activity the page passes is one the customer chose (lens-map passes none otherwise), so a chosen «صيدلية»
  // stays in the link: a step waits for a chosen activity and would not compute on one the link dropped
  set('activity', view.main || pick ? null : activity)
  set('layer', view.layer && view.layer !== firstLayer ? view.layer : null)
  const text = query.toString()
  return text ? `?${text}` : ''
}

/**
 * The choices made inside a step, kept in the address beside the view, so a reload or a shared link opens the step
 * as it was left: the sort orders, the second activity of «قارن بنشاط آخر», the homes filters, the reps and days of
 * the territories, the audience filters, the reach of «قارن المواقع», and the business list's search and open card.
 *
 * Each one is a value of lib/sticky-state (its `sticky` key, the same one the step reads), written under a short
 * parameter only while it differs from the step's own default, and read back only when it is one of the values the
 * step offers. `tools` names the steps it belongs to: the address keeps the options of the open lens's steps only
 * (null: every lens). The defaults and values here repeat the steps' own (named beside each list below).
 */
export type MapOption = {
  sticky: string
  params: string[]
  tools: string[] | null
  initial: unknown
  /** The value the address holds, or undefined when it holds none or one the step does not offer. */
  read: (query: URLSearchParams) => unknown
  /** The parameters for a value; a value the step does not offer writes nothing. */
  write: (value: unknown) => Record<string, string | null>
}

const one = (param: string, sticky: string, tools: string[] | null, values: readonly string[], initial: string): MapOption => ({
  sticky, params: [param], tools, initial,
  read: (query) => { const raw = query.get(param); return raw != null && values.includes(raw) ? raw : undefined },
  write: (value) => ({ [param]: typeof value === 'string' && values.includes(value) ? value : null }),
})
const whole = (param: string, sticky: string, tools: string[] | null, allowed: (value: number) => boolean, initial: number): MapOption => ({
  sticky, params: [param], tools, initial,
  read: (query) => {
    const raw = query.get(param)
    const value = raw != null && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN
    return Number.isSafeInteger(value) && allowed(value) ? value : undefined
  },
  write: (value) => ({ [param]: typeof value === 'number' && Number.isSafeInteger(value) && allowed(value) ? String(value) : null }),
})
const inRange = (min: number, max: number) => (value: number) => value >= min && value <= max
// eslint-disable-next-line no-control-regex
const BUSINESS_ID = /^[^\u0000- \u007f<>"'`\\]{1,180}$/

// the values each step offers: tools/around-tool REACHES, tools/audience-tool INCOMES, lib/real-estate LISTING_TYPES
// and BUDGETS, tools/territories-tool MIN_REPS..MAX_REPS and its day steppers
const REACH_METRES = [500, 1000, 2000]
// the Kingdom's box, generously: a site outside it is not one the map can measure
const SITE_LON = (value: number) => Number.isFinite(value) && value >= 34 && value <= 56
const SITE_LAT = (value: number) => Number.isFinite(value) && value >= 16 && value <= 33
const REACH_MINUTES = [5, 10, 15]
const INCOMES = [0, 8000, 12000, 16000]
const LISTING_TYPES = ['room', 'apartment', 'floor', 'villa', 'store', 'office', 'warehouse', 'land']
const BUDGETS: Record<string, number[]> = {
  rent_year: [30000, 50000, 80000, 120000, 200000],
  rent_month: [2000, 3000, 5000, 8000, 12000],
  rent_unstated: [30000, 50000, 80000, 120000, 200000],
  sale: [700000, 1000000, 1500000, 2500000, 4000000],
}
const ANY_BUDGET = new Set(Object.values(BUDGETS).flat())
/** The homes step keeps the shops lens's choices (store rents) apart from the homes lens's (tools/homes-tool). */
export const homesSticky = (lens: string) => `homes.${lens === 'shops' ? 'preset' : 'plain'}`

/** The options of a lens's steps, in the order they are written. */
export function mapOptions(lens: string): MapOption[] {
  const homes = homesSticky(lens)
  const preset = lens === 'shops'
  return [
    one('order', 'competitors.order', ['competitors'], ['dense', 'light'], 'dense'),
    one('view', 'competitors.view', ['competitors'], ['districts', 'brands'], 'districts'),
    {
      // the second activity of «قارن بنشاط آخر»: typed words (vs) or a main activity by id (vsmain), like the studied
      // one; a main activity reads back without its name, which the page takes from the city's list
      sticky: 'competitors.rival', params: ['vs', 'vsmain'], tools: ['competitors'], initial: null,
      read: (query) => {
        const main = query.get('vsmain')
        if (main != null && MAIN.test(main)) return { main_id: main }
        const q = cleanQuery(query.get('vs'))
        return q ? { q, label: q } : undefined
      },
      write: (value) => {
        const rival = value as { q?: string; main_id?: string } | null
        const main = rival?.main_id && MAIN.test(rival.main_id) ? rival.main_id : null
        return { vsmain: main, vs: main ? null : cleanQuery(rival?.q) }
      },
    },
    one('vsorder', 'competitors.rivalOrder', ['competitors'], ['first', 'gap'], 'gap'),
    {
      sticky: 'around.reach', params: ['reach'], tools: ['around'], initial: { kind: 'radius', metres: 1000 },
      read: (query) => {
        const match = /^(\d{1,5})(m|min)$/.exec(query.get('reach') ?? '')
        const n = match ? Number(match[1]) : NaN
        if (match?.[2] === 'm' && REACH_METRES.includes(n)) return { kind: 'radius', metres: n }
        if (match?.[2] === 'min' && REACH_MINUTES.includes(n)) return { kind: 'drive', minutes: n }
        return undefined
      },
      write: (value) => {
        const reach = value as { kind?: string; metres?: number; minutes?: number } | null
        return {
          reach: reach?.kind === 'radius' && REACH_METRES.includes(reach.metres ?? NaN) ? `${reach.metres}m`
            : reach?.kind === 'drive' && REACH_MINUTES.includes(reach.minutes ?? NaN) ? `${reach.minutes}min` : null,
        }
      },
    },
    {
      // the candidate sites of «قارن المواقع», in slot order: «lon,lat;lon,lat» to 5 decimals (about a metre), at most
      // three, each inside the Kingdom's box; so a comparison reopens (and is saved by name) with its sites
      sticky: 'around.sites', params: ['sites'], tools: ['around'], initial: [],
      read: (query) => {
        const raw = query.get('sites')
        if (!raw || raw.length > 80) return undefined
        const points = raw.split(';').slice(0, 3).map((pair) => pair.split(',').map(Number)).filter(([lon, lat]) => SITE_LON(lon) && SITE_LAT(lat)).map(([lon, lat]) => ({ lon, lat }))
        return points.length ? points : undefined
      },
      write: (value) => {
        const points = Array.isArray(value) ? (value as { lon?: unknown; lat?: unknown }[]).filter((point) => SITE_LON(Number(point?.lon)) && SITE_LAT(Number(point?.lat))).slice(0, 3) : []
        return { sites: points.length ? points.map((point) => `${Number(point.lon).toFixed(5)},${Number(point.lat).toFixed(5)}`).join(';') : null }
      },
    },
    one('aud', 'audience.mode', ['audience'], ['people', 'businesses'], 'people'),
    one('sex', 'audience.sex', ['audience'], ['all', 'men', 'women'], 'all'),
    one('nat', 'audience.nationality', ['audience'], ['all', 'saudi', 'non_saudi'], 'all'),
    whole('income', 'audience.minIncome', ['audience'], (value) => INCOMES.includes(value), 0),
    one('rank', 'audience.rankBy', ['audience'], ['sex', 'nationality'], 'sex'),
    one('scope', 'territories.scope', ['territories'], ['all', 'activity'], 'activity'),
    whole('reps', 'territories.count', ['territories'], inRange(2, 50), 5),
    one('weight', 'territories.weight', ['territories'], ['population', 'businesses'], 'businesses'),
    whole('days', 'territories.days', ['territories'], inRange(1, 6), 5),
    whole('perday', 'territories.perDay', ['territories'], inRange(1, 100), 20),
    one('kind', `${homes}.kind`, ['homes'], ['rent', 'sale'], 'rent'),
    one('type', `${homes}.type`, ['homes'], LISTING_TYPES, preset ? 'store' : 'apartment'),
    one('deal', `${homes}.rentDeal`, ['homes'], ['all', 'rent_year', 'rent_month', 'rent_unstated'], preset ? 'all' : 'rent_year'),
    whole('budget', `${homes}.budget`, ['homes'], (value) => value === 0 || ANY_BUDGET.has(value), 0),
    {
      // the business list's own search: an activity, or «كل الأنشطة» (*). The page keeps it with the list it was made
      // in (`scope`: the city, districts and top search); read from the address it fits the first list that opens
      sticky: 'businesses.search', params: ['bq'], tools: null, initial: null,
      read: (query) => {
        const raw = query.get('bq')
        const q = raw === '*' ? '' : cleanQuery(raw)
        return q == null ? undefined : { q, scope: null }
      },
      write: (value) => {
        const q = (value as { q?: unknown } | null)?.q
        return { bq: q === '' ? '*' : typeof q === 'string' ? cleanQuery(q) : null }
      },
    },
    {
      // the business whose directory card is open, by its key; it opens once the list holding it loads
      sticky: 'businesses.open', params: ['biz'], tools: null, initial: null,
      read: (query) => { const raw = query.get('biz'); return raw != null && BUSINESS_ID.test(raw) ? raw : undefined },
      write: (value) => ({ biz: typeof value === 'string' && BUSINESS_ID.test(value) ? value : null }),
    },
  ]
}

const belongs = (option: MapOption, steps: readonly string[]) => option.tools == null || option.tools.some((tool) => steps.includes(tool))
const same = (a: Record<string, string | null>, b: Record<string, string | null>) => Object.keys({ ...a, ...b }).every((key) => (a[key] ?? null) === (b[key] ?? null))

/**
 * The options the address holds for a lens whose steps are `steps`, by sticky key; a value a step does not offer is
 * left out (the step keeps its own default). A budget is kept only with the deal it belongs to.
 */
export function readMapOptions(search: string, lens: string, steps: readonly string[]): Record<string, unknown> {
  const query = new URLSearchParams(search)
  const options = mapOptions(lens)
  const values: Record<string, unknown> = {}
  for (const option of options) {
    if (!belongs(option, steps)) continue
    const value = option.read(query)
    if (value !== undefined) values[option.sticky] = value
  }
  const homes = homesSticky(lens)
  const budget = values[`${homes}.budget`]
  if (typeof budget === 'number' && budget > 0) {
    const pick = (key: string) => values[`${homes}.${key}`] ?? options.find((option) => option.sticky === `${homes}.${key}`)?.initial
    // «all» rent periods take no budget (tools/homes-tool)
    const deal = pick('kind') === 'sale' ? 'sale' : String(pick('rentDeal'))
    if (!(BUDGETS[deal] ?? []).includes(budget)) delete values[`${homes}.budget`]
  }
  return values
}

/**
 * Writes the options into `search`, keeping every other parameter. `value(key)` gives a sticky key's current value,
 * or undefined while it was never set (the step's default). An option of another lens's steps, or one back on its
 * default, leaves the address.
 */
export function writeMapOptions(search: string, lens: string, steps: readonly string[], value: (sticky: string) => unknown): string {
  const query = new URLSearchParams(search)
  const options = mapOptions(lens)
  for (const option of options) for (const param of option.params) query.delete(param)
  for (const option of options) {
    if (!belongs(option, steps)) continue
    const current = value(option.sticky)
    if (current === undefined) continue
    const written = option.write(current)
    if (same(written, option.write(option.initial))) continue
    for (const [param, text] of Object.entries(written)) if (text) query.set(param, text)
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}
