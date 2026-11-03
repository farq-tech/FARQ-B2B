'use client'

import { useEffect, useRef, useState } from 'react'
import { districtName, postMarket, type DistrictFeature } from '@/lib/insights-api'

/**
 * One row per canonical district of a city, joined from the golden tables (docs/golden-data.md): the outline and
 * name from the atlas, population by district id, directory counts by canonical name, income and growth, restaurants on delivery apps and unmet
 * searches by district id from Farq. A missing figure stays null and is shown as «غير متاح», never as zero.
 */
export type DistrictRow = {
  id: string
  name: string
  population: number | null
  populationSource: string | null
  businesses: number | null
  /** District area in km², the one authoritative figure from the service (server.py _area_km2). */
  areaKm2: number | null
  /** Derived in the service, read here verbatim: residents ÷ businesses, businesses ÷ km², residents ÷ km². */
  residentsPerBusiness: number | null
  businessesPerKm2: number | null
  density: number | null
  restaurants: number | null
  /** Median menu-item price of the district's restaurants, and how many restaurants it rests on. */
  menuPrice: number | null
  menuPricePlaces: number | null
  /** Located Farq searches near the district in 90 days, and how many found nothing (null below the threshold). */
  searches: number | null
  unmetSearches: number | null
  unmetTerms: DemandTerm[]
  income: number | null
  underConstruction: number | null
  newBuildings: number | null
  /** Share of the district's homes that are villas (buildings layer), a stand-in for income where none is published. */
  villaShare: number | null
  /** Median asking price per m² from current listings (rent per year), by property group; null below the listing floor. */
  /** Per group: the median and its listings, and the same split by the building's age where enough ads state it (new = 2 years or less). */
  realEstate: Partial<Record<RealEstateGroup, { median: number; listings: number; byAge?: { new?: { median: number; listings: number }; older?: { median: number; listings: number } } }>>
  /** Median price per m² paid in registered sale deals, by classification, and the deals behind it. */
  deals: { residential: { median: number; deals: number } | null; commercial: { median: number; deals: number } | null }
}

/** `${deal}_${group}`: sale_residential, rent_year_commercial, rent_month_residential, rent_unstated_office … each its
 * own median, in its own period (lib/real-estate.ts groupLabel names them). */
export type RealEstateGroup = string

/** The tables a city's rows are joined from, besides the district outlines the map cannot open without. */
export type CityTable = 'population' | 'counts' | 'income' | 'growth' | 'housing' | 'realEstate' | 'deals' | 'restaurants' | 'menuPrices' | 'demand'

export type CityData = {
  /** `loading` may already carry the city's outlines (`features`), drawn while the figures still load; `rows` come with `ready`. */
  status: 'loading' | 'ready' | 'error'
  features: DistrictFeature[]
  rows: DistrictRow[]
  /** The rows joined from the tables in so far, while the rest load: for the map's shading only (a panel or a tool
   * reading them would take a table not yet in for a district without the figure). */
  early: DistrictRow[]
  /** Tables still being asked (a retry asks only the failed ones). */
  pending: CityTable[]
  total: number | null
  /** Tables that failed to load this time: their figures are null in every row because they did not arrive, not
   * because the district lacks them, so the page says «تعذّر التحميل» with a retry instead of «غير متاح». */
  failed: CityTable[]
  /** After a failed table, ask the failed tables again; after a failed city, load it again. */
  reload?: () => void
}

type PopulationRow = { district_id: string | number; district_ar: string; population: number | null; source?: string | null }
/** Counts plus the derived per-district figures, each computed once in the service (server.py enrich_district_counts):
 * area, residents per business, businesses per km², density. The map reads these; it never recomputes them. */
type CountRow = { district_ar: string; n: number; area_km2?: number | null; residents_per?: number | null; per_km2?: number | null; density?: number | null }
type IncomeRow = { district_ar: string; income_all?: number | null }
type GrowthRow = { district_ar: string; under_construction: number; new_buildings: number }
type HousingRow = { district_ar: string; villa_share_pct: number }
type AgeBand = { listings: number; median_sar_per_sqm: number }
type RealEstateRow = { district_id: string; groups: Partial<Record<RealEstateGroup, { listings: number; median_sar_per_sqm: number; by_age?: { new?: AgeBand; older?: AgeBand } }>> }
type DealRow = { district_ar: string; residential?: { deals: number; median_sar_per_sqm: number }; commercial?: { deals: number; median_sar_per_sqm: number } }
type RestaurantRow = { district_id: string; restaurants: number }
type MenuPriceRow = { district_id: string; price: number; places: number | null }
export type DemandTerm = { term: string; searches: number; unmet: number }
type DemandRow = { district_id: string; searches: number; unmet: number; unmetTerms: DemandTerm[] }

/** A district name folded the way the service folds it (canonical_data.district_key), to join tables named differently. */
export function districtKey(name: string): string {
  return name.replace(/^(حي|حى)\s+/, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u0652\u0640]/g, '').replace(/\s+/g, ' ').trim()
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(String(response.status))
  return response.json() as Promise<T>
}

/** The district shapes are the one source the map cannot open without: a brief upstream hiccup (5xx or a dropped
 * connection) gets one quiet retry before the visitor sees «تعذر تحميل بيانات المدينة». */
async function getRequired<T>(url: string): Promise<T> {
  try {
    return await getJson<T>(url)
  } catch (error) {
    const status = Number((error as Error).message)
    if (status && status < 500) throw error
    await new Promise((resolve) => setTimeout(resolve, 800))
    return getJson<T>(url)
  }
}

type Tables = {
  population?: { districts?: PopulationRow[] } | null
  counts?: { districts?: CountRow[]; total?: number } | null
  income?: { districts?: IncomeRow[] } | null
  growth?: { districts?: GrowthRow[] } | null
  housing?: { districts?: HousingRow[] } | null
  realEstate?: { districts?: RealEstateRow[] } | null
  deals?: { districts?: DealRow[] } | null
  restaurants?: { districts?: RestaurantRow[] } | null
  menuPrices?: { districts?: MenuPriceRow[] } | null
  demand?: { districts?: DemandRow[] } | null
}

/** Where each table comes from. A table in `Tables` is `undefined` while asked, `null` once it failed. */
const SOURCES: { [K in CityTable]: (city: string) => Promise<NonNullable<Tables[K]>> } = {
  population: (city) => getJson(`/api/market/population-districts?city=${encodeURIComponent(city)}`),
  counts: (city) => postMarket('district-counts', { city }),
  income: (city) => postMarket('district-income', { city }),
  growth: (city) => postMarket('growth', { city }),
  housing: (city) => postMarket('housing-level', { city }),
  realEstate: (city) => postMarket('real-estate', { city }),
  deals: (city) => postMarket('registered-deals', { city }),
  restaurants: (city) => getJson(`/api/farq/restaurants?city=${encodeURIComponent(city)}`),
  menuPrices: (city) => getJson(`/api/farq/menu-prices?city=${encodeURIComponent(city)}`),
  demand: (city) => getJson(`/api/farq/demand?city=${encodeURIComponent(city)}`),
}
export const CITY_TABLES = Object.keys(SOURCES) as CityTable[]

/** The tables asked first: the one the map is coloured by goes ahead of the rest (a browser opens only a few
 * connections to one host at a time, so the eleventh request waits for the first ones). */
export function loadOrder(first?: CityTable | null): CityTable[] {
  return first && CITY_TABLES.includes(first) ? [first, ...CITY_TABLES.filter((table) => table !== first)] : CITY_TABLES
}

/** One row per district outline, joined from the tables in so far; a table not in (or failed) leaves its figures null. */
export function joinRows(features: DistrictFeature[], tables: Tables): DistrictRow[] {
  const people = new Map((tables.population?.districts ?? []).map((row) => [String(row.district_id), row]))
  const eateries = new Map((tables.restaurants?.districts ?? []).map((row) => [row.district_id, row.restaurants]))
  const paid = new Map((tables.deals?.districts ?? []).map((row) => [districtKey(row.district_ar), row]))
  const menus = new Map((tables.menuPrices?.districts ?? []).map((row) => [row.district_id, row]))
  const wanted = new Map((tables.demand?.districts ?? []).map((row) => [row.district_id, row]))
  const byName = <R extends { district_ar: string }>(list?: R[]) => new Map((list ?? []).map((row) => [row.district_ar, row]))
  const count = byName(tables.counts?.districts)
  const pay = byName(tables.income?.districts)
  const built = byName(tables.growth?.districts)
  const homes = byName(tables.housing?.districts)
  const listings = new Map((tables.realEstate?.districts ?? []).map((row) => [String(row.district_id), row.groups]))
  return features.map((feature): DistrictRow => {
    const id = String(feature.properties.id)
    const name = districtName(feature)
    const c = count.get(name)
    const g = built.get(name)
    return {
      id,
      name,
      population: people.get(id)?.population ?? null,
      populationSource: people.get(id)?.source ?? null,
      businesses: c ? c.n : null,
      areaKm2: c?.area_km2 ?? null,
      residentsPerBusiness: c?.residents_per ?? null,
      businessesPerKm2: c?.per_km2 ?? null,
      density: c?.density ?? null,
      restaurants: eateries.get(id) ?? null,
      menuPrice: menus.get(id)?.price ?? null,
      menuPricePlaces: menus.get(id)?.places ?? null,
      searches: wanted.get(id)?.searches ?? null,
      unmetSearches: wanted.get(id)?.unmet ?? null,
      unmetTerms: wanted.get(id)?.unmetTerms ?? [],
      income: pay.get(name)?.income_all ?? null,
      underConstruction: g ? g.under_construction : null,
      newBuildings: g ? g.new_buildings : null,
      villaShare: homes.get(name)?.villa_share_pct ?? null,
      deals: (() => {
        const row = paid.get(districtKey(name))
        const pick = (value?: { deals: number; median_sar_per_sqm: number }) => (value ? { median: value.median_sar_per_sqm, deals: value.deals } : null)
        return { residential: pick(row?.residential), commercial: pick(row?.commercial) }
      })(),
      realEstate: Object.fromEntries(Object.entries(listings.get(id) ?? {}).map(([group, value]) => [group, {
        median: value!.median_sar_per_sqm, listings: value!.listings,
        ...(value!.by_age ? { byAge: Object.fromEntries(Object.entries(value!.by_age).map(([band, figure]) => [band, { median: figure!.median_sar_per_sqm, listings: figure!.listings }])) } : {}),
      }])),
    }
  })
}

const EMPTY_CITY: Omit<CityData, 'reload'> = { status: 'loading', features: [], rows: [], early: [], total: null, failed: [], pending: CITY_TABLES }

/**
 * A city's outlines and figures, table by table. The outlines reach the map first; each table joins the rows as it
 * arrives (`early`, for the map's shading), and `rows` come once every table has answered (the panels and tools
 * read only those). `first` (read when a city starts loading) is asked ahead of the rest. A retry after a failed
 * table asks only the failed tables again and keeps everything else, the outlines and the camera included.
 */
export function useCityData(city: string, first?: CityTable | null): CityData {
  const [data, setData] = useState<Omit<CityData, 'reload'>>(EMPTY_CITY)
  const [attempt, setAttempt] = useState(0)
  const firstTable = useRef(first)
  firstTable.current = first
  // what this city has so far, kept across a retry of its failed tables
  const store = useRef<{ city: string | null; features: DistrictFeature[]; tables: Tables }>({ city: null, features: [], tables: {} })
  const retryFailed = useRef(false)

  useEffect(() => {
    let active = true
    const partial = retryFailed.current && store.current.city === city && store.current.features.length > 0
    retryFailed.current = false
    if (!partial) store.current = { city, features: [], tables: {} }
    const held = store.current
    const tables = held.tables as Record<CityTable, unknown>
    const asked = partial ? CITY_TABLES.filter((table) => tables[table] === null) : loadOrder(firstTable.current)
    for (const table of asked) delete tables[table]
    const publish = () => {
      if (!active) return
      const pending = CITY_TABLES.filter((table) => tables[table] === undefined)
      const failed = CITY_TABLES.filter((table) => tables[table] === null)
      const total = held.tables.counts?.total ?? null
      if (!held.features.length) { setData({ ...EMPTY_CITY, pending }); return }
      const joined = joinRows(held.features, held.tables)
      if (!pending.length) setData({ status: 'ready', features: held.features, rows: joined, early: joined, total, failed, pending })
      // while a retry runs the page keeps its rows; the retried figures show once they answer
      else setData((current) => ({ status: partial ? 'ready' : 'loading', features: held.features, rows: partial ? current.rows : [], early: joined, total: partial ? current.total : total, failed, pending }))
    }
    if (partial) publish()
    else {
      setData(EMPTY_CITY)
      getRequired<{ features?: DistrictFeature[] }>(`/api/market/districts?city=${encodeURIComponent(city)}`).then((atlas) => {
        if (!active) return
        held.features = atlas.features ?? []
        publish()
      }, () => { if (active) setData({ ...EMPTY_CITY, status: 'error', pending: [] }) })
    }
    for (const table of asked) {
      ;(SOURCES[table](city) as Promise<unknown>).then((value) => { tables[table] = value }, () => { tables[table] = null })
        .then(() => { if (active && store.current === held) publish() })
    }
    return () => { active = false }
  }, [city, attempt])

  const reload = () => { retryFailed.current = data.status !== 'error'; setAttempt((n) => n + 1) }
  return { ...data, reload }
}

/** Sum of a field over rows; null when any row lacks it, so a partial total is never shown as the whole. */
/**
 * The sum over the districts that have the figure, with how many do: a city where a few districts lack a figure still
 * has a total for the rest, said as such («في 186 من 192 حياً»), instead of «غير متاح» for the whole city. Null when
 * no district has it.
 */
export function sumKnown(rows: DistrictRow[], key: Parameters<typeof sumOf>[1]): { total: number; known: number; of: number } | null {
  const known = rows.filter((row) => row[key] != null)
  if (!known.length) return null
  return { total: known.reduce((sum, row) => sum + (row[key] as number), 0), known: known.length, of: rows.length }
}

export function sumOf(rows: DistrictRow[], key: keyof Omit<DistrictRow, 'id' | 'name' | 'populationSource' | 'unmetTerms' | 'realEstate' | 'deals'>): number | null {
  if (!rows.length || rows.some((row) => row[key] == null)) return null
  return rows.reduce((total, row) => total + (row[key] as number), 0)
}
