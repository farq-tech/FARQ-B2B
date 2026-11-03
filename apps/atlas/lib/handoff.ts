// with extensions, so node --test can load this file for lib/handoff.test.ts
/**
 * The links between Atlas's surfaces, in one place: each hand-off carries what the person has already told Atlas (the
 * city, the district, the deal and type, the area, the activity) in the address of the page it opens, so nothing is
 * typed twice and the link reopens the same view for whoever it is shared with. Every value read back from an address
 * is checked by the page that reads it; these builders only write values the page offers.
 */

/** The city every surface opens on, which an address leaves out. */
export const DEFAULT_CITY = 'Riyadh'

const ID = /^[A-Za-z0-9_-]{1,40}$/
const CITY = /^[A-Za-z][A-Za-z .'-]{0,39}$/

const href = (path: string, query: URLSearchParams) => {
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

// ── «سعّر عقارك» ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The answers the price page offers (components/price/price-estimator.tsx), in its own ids. */
export const PRICE_DEALS = ['rent_year', 'rent_month', 'sale'] as const
export const PRICE_TYPES = ['apartment', 'floor', 'villa'] as const

/** A building's age in years as the price page's age chip. */
export function ageBucket(age: number | null | undefined): string | null {
  if (age == null || !Number.isFinite(age) || age < 0) return null
  if (age === 0) return '0'
  if (age <= 2) return '1-2'
  if (age <= 5) return '3-5'
  if (age <= 10) return '6-10'
  return '11+'
}

/** A street's width in metres as the price page's width chip. */
export function widthBucket(width: number | null | undefined): string | null {
  if (width == null || !Number.isFinite(width) || width <= 0) return null
  if (width < 15) return 'lt15'
  if (width < 20) return '15-19'
  if (width < 30) return '20-29'
  return '30+'
}

type Priceable = {
  city: string
  district_id: string | null
  deal: string | null
  type: string
  area_sqm: number | null
  age?: number
  street_width?: number
  features?: Partial<Record<string, 0 | 1>>
}

/**
 * The price page with a listing's own facts as its answers, so «سعّر عقاراً مثله» prices it at once. Null when the page
 * cannot price it (a type or a deal it does not offer, no district or no area): no link then, never a half-filled form.
 */
export function priceHref(listing: Priceable): string | null {
  if (!listing.district_id || !ID.test(listing.district_id) || !listing.area_sqm || listing.area_sqm < 10) return null
  if (!(PRICE_DEALS as readonly string[]).includes(listing.deal ?? '') || !(PRICE_TYPES as readonly string[]).includes(listing.type)) return null
  const query = new URLSearchParams()
  if (listing.city && listing.city !== DEFAULT_CITY && CITY.test(listing.city)) query.set('city', listing.city)
  query.set('district', listing.district_id)
  if (listing.deal !== 'rent_year') query.set('deal', listing.deal as string)
  if (listing.type !== 'floor') query.set('type', listing.type)
  query.set('area', String(Math.round(listing.area_sqm)))
  const age = ageBucket(listing.age)
  if (age) query.set('age', age)
  const width = widthBucket(listing.street_width)
  if (width) query.set('width', width)
  // furnishing is read from the ad's form only when it says so; unstated stays the page's default
  if (listing.features?.furnished === 1) query.set('furnished', 'yes')
  return href('/price', query)
}

// ── «العقار» ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type HomesKind = 'rent' | 'sale'
/** What «العقار» keeps in its address: the city, the deal (a sale or one rent period), the types and the districts. */
export type HomesView = { city: string; kind: HomesKind; rentDeal: string; types: string[]; districts: string[] }
export const HOMES_DEFAULTS: HomesView = { city: DEFAULT_CITY, kind: 'rent', rentDeal: 'rent_year', types: ['apartment'], districts: [] }
const MAX_DISTRICTS = 12

/**
 * Reads «العقار»'s address. `rentDeals` and `types` are the periods and types the page offers (each type with the
 * deals it is offered for); anything else falls back to the default. Districts pass their shape here, and the page keeps
 * only those its city has once they load.
 */
export function readHomesQuery(search: string, rentDeals: readonly string[], types: readonly { id: string; kinds: readonly string[] }[]): HomesView {
  const query = new URLSearchParams(search)
  const city = query.get('city')
  const deal = query.get('deal')
  const kind: HomesKind = deal === 'sale' ? 'sale' : 'rent'
  const rentDeal = deal && deal !== 'sale' && rentDeals.includes(deal) ? deal : HOMES_DEFAULTS.rentDeal
  const wanted = [...new Set((query.get('type') ?? '').split(',').map((id) => id.trim()))]
  const kept = wanted.filter((id) => types.some((item) => item.id === id && item.kinds.includes(kind)))
  const districts = [...new Set((query.get('district') ?? '').split(',').map((id) => id.trim()).filter((id) => ID.test(id)))].slice(0, MAX_DISTRICTS)
  return {
    city: city && CITY.test(city) ? city : HOMES_DEFAULTS.city,
    kind,
    rentDeal,
    types: kept.length ? kept : HOMES_DEFAULTS.types,
    districts,
  }
}

/** Writes «العقار»'s view, leaving out what is at its default so a plain visit keeps a plain address. */
export function writeHomesQuery(view: Partial<HomesView>): string {
  const query = new URLSearchParams()
  if (view.city && view.city !== DEFAULT_CITY && CITY.test(view.city)) query.set('city', view.city)
  const deal = view.kind === 'sale' ? 'sale' : view.rentDeal ?? HOMES_DEFAULTS.rentDeal
  if (deal !== HOMES_DEFAULTS.rentDeal) query.set('deal', deal)
  const types = (view.types ?? []).filter((id) => ID.test(id))
  if (types.length && types.join(',') !== HOMES_DEFAULTS.types.join(',')) query.set('type', types.join(','))
  const districts = (view.districts ?? []).filter((id) => ID.test(id)).slice(0, MAX_DISTRICTS)
  if (districts.length) query.set('district', districts.join(','))
  return query.toString()
}

/** «العقار» opened on a view (a district's listings, the same deal and type as a priced property). */
export function homesHref(view: Partial<HomesView>): string {
  const text = writeHomesQuery(view)
  return text ? `/homes?${text}` : '/homes'
}

// ── الخريطة ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The map opened on a view: a city, a group and its step, districts, a search. The map checks each value (map-query.ts)
 * and leaves out its defaults itself; here only well-shaped values are written.
 */
export function mapHref(view: { city?: string | null; lens?: string | null; tool?: string | null; districts?: string[]; q?: string | null }): string {
  const query = new URLSearchParams()
  if (view.city && view.city !== DEFAULT_CITY && CITY.test(view.city)) query.set('city', view.city)
  if (view.lens && ID.test(view.lens) && view.lens !== 'shops') query.set('lens', view.lens)
  if (view.tool && ID.test(view.tool)) query.set('tool', view.tool)
  const districts = (view.districts ?? []).filter((id) => ID.test(id)).slice(0, MAX_DISTRICTS)
  if (districts.length) query.set('district', districts.join(','))
  const q = view.q?.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (q) query.set('q', q)
  return href('/map', query)
}

/** A district on the map in the property seekers' «تعرّف على الحي» step: its summary, framed. */
export function districtMapHref(city: string, districtId: string | null | undefined): string | null {
  if (!districtId || !ID.test(districtId)) return null
  return mapHref({ city, lens: 'property', tool: 'district', districts: [districtId] })
}

/** A request's way back to the map view it was made from: only an address inside the map is followed. */
export function safeMapOrigin(origin: string | null | undefined): string | null {
  if (!origin || origin.length > 600) return null
  return /^\/map(?:\?[^#\s<>"']*)?$/.test(origin) ? origin : null
}

/** The city's English key from a request's lower-cased id, through the shared city list. */
export function cityKey(cityId: string, cities: readonly { en: string }[]): string | null {
  const id = cityId.toLowerCase()
  return cities.find((city) => city.en.toLowerCase() === id)?.en ?? null
}

// ── the last view of each surface ───────────────────────────────────────────────────────────────────────────────────

const VIEW_KEY = 'atlas.view|'
/** The surfaces whose view the main navigation brings back. */
export const REMEMBERED = ['/map', '/homes', '/price'] as const

/** Keeps a surface's address (its query) for this tab, so the main navigation goes back to the same view. */
export function rememberView(path: string, search: string) {
  try { globalThis.sessionStorage?.setItem(VIEW_KEY + path, search.startsWith('?') || !search ? search : `?${search}`) } catch { /* private window: the nav opens the default view */ }
}

/** The surface's last view in this tab, as a path with its query; the bare path when nothing was kept. */
export function lastView(path: string): string {
  try {
    const saved = globalThis.sessionStorage?.getItem(VIEW_KEY + path) ?? ''
    // only a query is kept; anything else is ignored
    return /^(\?[^#\s<>"']*)?$/.test(saved) && saved.length <= 600 ? `${path}${saved}` : path
  } catch { return path }
}

/** The page's own address as a login's `next`, so signing in comes back to the same view. */
export function loginHref(here: string): string {
  const next = here.startsWith('/') && !here.startsWith('//') ? here : '/map'
  return `/login?next=${encodeURIComponent(next)}`
}
