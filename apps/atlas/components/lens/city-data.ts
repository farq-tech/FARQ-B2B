'use client'

import { useEffect, useState } from 'react'
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
  realEstate: Partial<Record<RealEstateGroup, { median: number; listings: number }>>
  /** Median price per m² paid in registered sale deals, by classification, and the deals behind it. */
  deals: { residential: { median: number; deals: number } | null; commercial: { median: number; deals: number } | null }
}

/** `${deal}_${group}`: sale_residential, rent_year_commercial, rent_month_residential, rent_unstated_office … each its
 * own median, in its own period (lib/real-estate.ts groupLabel names them). */
export type RealEstateGroup = string

export type CityData = {
  status: 'loading' | 'ready' | 'error'
  features: DistrictFeature[]
  rows: DistrictRow[]
  total: number | null
  /** Load the city again after a failure. */
  reload?: () => void
}

type PopulationRow = { district_id: string | number; district_ar: string; population: number | null; source?: string | null }
type CountRow = { district_ar: string; n: number }
type IncomeRow = { district_ar: string; income_all?: number | null }
type GrowthRow = { district_ar: string; under_construction: number; new_buildings: number }
type HousingRow = { district_ar: string; villa_share_pct: number }
type RealEstateRow = { district_id: string; groups: Partial<Record<RealEstateGroup, { listings: number; median_sar_per_sqm: number }>> }
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

export function useCityData(city: string): CityData {
  const [data, setData] = useState<CityData>({ status: 'loading', features: [], rows: [], total: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setData({ status: 'loading', features: [], rows: [], total: null })
    const optional = <T,>(promise: Promise<T>) => promise.catch(() => null)
    Promise.all([
      getJson<{ features?: DistrictFeature[] }>(`/api/market/districts?city=${encodeURIComponent(city)}`),
      optional(getJson<{ districts?: PopulationRow[] }>(`/api/market/population-districts?city=${encodeURIComponent(city)}`)),
      optional(postMarket<{ districts?: CountRow[]; total?: number }>('district-counts', { city })),
      optional(postMarket<{ districts?: IncomeRow[] }>('district-income', { city })),
      optional(postMarket<{ districts?: GrowthRow[] }>('growth', { city })),
      optional(postMarket<{ districts?: HousingRow[] }>('housing-level', { city })),
      optional(postMarket<{ districts?: RealEstateRow[] }>('real-estate', { city })),
      optional(postMarket<{ districts?: DealRow[] }>('registered-deals', { city })),
      optional(getJson<{ districts?: RestaurantRow[] }>(`/api/farq/restaurants?city=${encodeURIComponent(city)}`)),
      optional(getJson<{ districts?: MenuPriceRow[] }>(`/api/farq/menu-prices?city=${encodeURIComponent(city)}`)),
      optional(getJson<{ districts?: DemandRow[] }>(`/api/farq/demand?city=${encodeURIComponent(city)}`)),
    ]).then(([atlas, population, counts, income, growth, housing, property, registered, restaurants, menuPrices, demand]) => {
      if (!active) return
      const features = atlas.features ?? []
      const people = new Map((population?.districts ?? []).map((row) => [String(row.district_id), row]))
      const eateries = new Map((restaurants?.districts ?? []).map((row) => [row.district_id, row.restaurants]))
      const paid = new Map((registered?.districts ?? []).map((row) => [districtKey(row.district_ar), row]))
      const menus = new Map((menuPrices?.districts ?? []).map((row) => [row.district_id, row]))
      const wanted = new Map((demand?.districts ?? []).map((row) => [row.district_id, row]))
      const byName = <R extends { district_ar: string }>(list?: R[]) => new Map((list ?? []).map((row) => [row.district_ar, row]))
      const count = byName(counts?.districts)
      const pay = byName(income?.districts)
      const built = byName(growth?.districts)
      const homes = byName(housing?.districts)
      const listings = new Map((property?.districts ?? []).map((row) => [String(row.district_id), row.groups]))
      const rows = features.map((feature): DistrictRow => {
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
          realEstate: Object.fromEntries(Object.entries(listings.get(id) ?? {}).map(([group, value]) => [group, { median: value!.median_sar_per_sqm, listings: value!.listings }])),
        }
      })
      setData({ status: 'ready', features, rows, total: counts?.total ?? null })
    }).catch(() => { if (active) setData({ status: 'error', features: [], rows: [], total: null }) })
    return () => { active = false }
  }, [city, attempt])

  return { ...data, reload: () => setAttempt((n) => n + 1) }
}

/** Sum of a field over rows; null when any row lacks it, so a partial total is never shown as the whole. */
export function sumOf(rows: DistrictRow[], key: keyof Omit<DistrictRow, 'id' | 'name' | 'populationSource' | 'unmetTerms' | 'realEstate' | 'deals'>): number | null {
  if (!rows.length || rows.some((row) => row[key] == null)) return null
  return rows.reduce((total, row) => total + (row[key] as number), 0)
}
