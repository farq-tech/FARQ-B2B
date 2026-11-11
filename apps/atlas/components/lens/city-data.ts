'use client'

import { useEffect, useState } from 'react'
import { districtName, postMarket, type DistrictFeature } from '@/lib/insights-api'
import { isCityDistrictFeatureCollection } from '@/lib/district-features'
import { isDistrictCountResponse, isDistrictScopeSummary, type DistrictScopeSummary } from '@/lib/district-counts'
import { isDistrictIncomeResponse, type DistrictIncomeResponse } from '@/lib/income-response'
import { isPopulationResponse, type PopulationResponse } from '@/lib/population-response'
import { isRealEstateDistrictResponse, type RealEstateDistrictResponse } from '@/lib/real-estate-district-response'
import { isRegisteredDealsResponse, type RegisteredDealRow, type RegisteredDealsResponse } from '@/lib/registered-deals-response'
import {
  isDemandDistrictResponse,
  isMenuPriceDistrictResponse,
  isRestaurantDistrictResponse,
  type DemandDistrictRow,
  type DemandTerm as FarqDemandTerm,
  type FarqDistrictResponse,
  type MenuPriceDistrictRow,
  type RestaurantDistrictRow,
} from '@/lib/farq-district-responses'
import { requestWithDeadline, type CityDataSource } from '@/lib/optional-source'
import { joinDistrictByIdOrUniqueName, uniqueDistrictIdJoin } from '@/lib/district-join'

export type { DistrictScopeSummary } from '@/lib/district-counts'
export { districtKey } from '@/lib/district-join'

/**
 * One row per canonical district of a city, joined from the golden tables (docs/golden-data.md): the outline and
 * name from the atlas, population, growth, housing, listings, restaurants and Farq signals by canonical district id;
 * directory counts and sources that publish names only join by a unique canonical name. A missing figure stays null.
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
  /** Average monthly income per working person, read from 910ths by the targeted population segment. */
  income: number | null
  incomeMale: number | null
  incomeFemale: number | null
  incomeSaudi: number | null
  incomeNonSaudi: number | null
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

export type CityData = {
  city: string
  status: 'loading' | 'ready' | 'error'
  features: DistrictFeature[]
  rows: DistrictRow[]
  total: number | null
  districtSummary: DistrictScopeSummary | null
  districtSummaryStatus: 'loading' | 'ready' | 'error'
  /** Optional sources still loading after the map has become usable. */
  pendingSources: CityDataSource[]
  /** Optional source requests that failed; distinct from sources that replied with genuinely unavailable data. */
  failedSources: CityDataSource[]
  /** Load the city again after a failure. */
  reload?: () => void
}

const CITY_DATA_SOURCES: CityDataSource[] = ['population', 'businesses', 'income', 'growth', 'housing', 'realEstate', 'deals', 'restaurants', 'menuPrices', 'demand']

/** Counts plus the derived per-district figures, each computed once in the service (server.py enrich_district_counts):
 * area, residents per business, businesses per km², density. The map reads these; it never recomputes them. */
type CountRow = { district_id?: string | null; district_ar: string; n: number; area_km2?: number | null; residents_per?: number | null; per_km2?: number | null; density?: number | null }
type GrowthRow = { district_id: string | number; district_ar: string; under_construction: number | null; new_buildings: number | null }
type HousingRow = { district_id: string | number; district_ar: string; villa_share_pct: number }
type DealRow = RegisteredDealRow
export type DemandTerm = FarqDemandTerm

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(String(response.status))
  return response.json() as Promise<T>
}

/** The district shapes are the one source the map cannot open without: a brief upstream hiccup (5xx or a dropped
 * connection) gets one quiet retry before the visitor sees «تعذر تحميل بيانات المدينة». */
async function getRequired<T>(url: string, parentSignal: AbortSignal): Promise<T> {
  try {
    return await requestWithDeadline((signal) => getJson<T>(url, signal), parentSignal)
  } catch (error) {
    if (parentSignal.aborted) throw error
    const status = Number((error as Error).message)
    if (status && status < 500) throw error
    await new Promise((resolve) => setTimeout(resolve, 800))
    return requestWithDeadline((signal) => getJson<T>(url, signal), parentSignal)
  }
}

function emptyDistrictRow(feature: DistrictFeature): DistrictRow {
  return {
    id: String(feature.properties.id), name: districtName(feature),
    population: null, populationSource: null, businesses: null, areaKm2: null,
    residentsPerBusiness: null, businessesPerKm2: null, density: null,
    restaurants: null, menuPrice: null, menuPricePlaces: null, searches: null,
    unmetSearches: null, unmetTerms: [], income: null, incomeMale: null,
    incomeFemale: null, incomeSaudi: null, incomeNonSaudi: null,
    underConstruction: null, newBuildings: null, villaShare: null,
    realEstate: {}, deals: { residential: null, commercial: null },
  }
}

function loadingCityData(city: string): CityData {
  return { city, status: 'loading', features: [], rows: [], total: null, districtSummary: null, districtSummaryStatus: 'loading', pendingSources: [], failedSources: [] }
}

export function useCityData(city: string, expectedDistrictCount?: number): CityData {
  const [data, setData] = useState<CityData>(() => loadingCityData(city))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let mapReady = false
    const queuedUpdates: (() => void)[] = []
    const cityRequests = new AbortController()
    setData(loadingCityData(city))
    const isCanonicalDistrictId = (id: unknown) => (typeof id === 'string' && id.trim().length > 0)
      || (typeof id === 'number' && Number.isSafeInteger(id))
    const hasCanonicalDistrictRows = (value: { available?: unknown; districts?: unknown }) => typeof value.available === 'boolean'
      && Array.isArray(value.districts) && value.districts.every((row) =>
        typeof row === 'object' && row !== null && !Array.isArray(row)
        && isCanonicalDistrictId((row as { district_id?: unknown }).district_id))
    const hasGrowthRows = (value: { available?: unknown; districts?: unknown }) => hasCanonicalDistrictRows(value)
      && Array.isArray(value.districts) && value.districts.every((row) => {
        const item = row as { under_construction?: unknown; new_buildings?: unknown }
        const validCount = (count: unknown) => count == null || (typeof count === 'number' && Number.isFinite(count) && count >= 0)
        return validCount(item.under_construction) && validCount(item.new_buildings)
      })
    const hasHousingRows = (value: { available?: unknown; districts?: unknown }) => hasCanonicalDistrictRows(value)
      && Array.isArray(value.districts) && value.districts.every((row) => {
        const share = (row as { villa_share_pct?: unknown }).villa_share_pct
        return typeof share === 'number' && Number.isFinite(share) && share >= 0 && share <= 100
      })
    const attachSource = <T,>(
      source: CityDataSource,
      request: Promise<T>,
      isValid: (value: T) => boolean,
      apply: (current: CityData, value: T) => CityData,
    ) => {
      void request.then((value) => {
        if (!isValid(value)) throw new Error(`Invalid ${source} response`)
        if (!active) return
        const commit = () => setData((current) => current.status !== 'ready' ? current : {
            ...apply(current, value),
            pendingSources: current.pendingSources.filter((item) => item !== source),
          })
        if (mapReady) commit()
        else queuedUpdates.push(commit)
      }).catch(() => {
        if (!active) return
        const commit = () => setData((current) => ({
            ...current,
            pendingSources: current.pendingSources.filter((item) => item !== source),
            failedSources: current.failedSources.includes(source) ? current.failedSources : [...current.failedSources, source],
            ...(source === 'businesses' ? { districtSummaryStatus: 'error' as const } : {}),
          }))
        if (mapReady) commit()
        else queuedUpdates.push(commit)
      })
    }
    const cityQuery = encodeURIComponent(city)
    const updateRows = (current: CityData, update: (row: DistrictRow) => DistrictRow) => ({ ...current, rows: current.rows.map(update) })

    attachSource('population', requestWithDeadline((signal) => getJson<PopulationResponse>(`/api/market/population-districts?city=${cityQuery}`, signal), cityRequests.signal), (value) => isPopulationResponse(value, city), (current, value) => {
      const people = uniqueDistrictIdJoin(current.rows.map((row) => row.id), value.districts)
      return updateRows(current, (row) => ({ ...row, population: people.get(row.id)?.population ?? null, populationSource: people.get(row.id)?.source ?? null }))
    })
    attachSource('businesses', requestWithDeadline((signal) => postMarket<{ districts?: CountRow[]; total?: number; scope_summary?: DistrictScopeSummary }>('district-counts', { city }, signal), cityRequests.signal), isDistrictCountResponse, (current, value) => {
      const counts = joinDistrictByIdOrUniqueName(current.rows.map((row) => ({ id: row.id, name: row.name })), value.districts!)
      const districtSummary = isDistrictScopeSummary(value.scope_summary) ? value.scope_summary : null
      return {
        ...updateRows(current, (row) => {
          const count = counts.get(row.id)
          return { ...row, businesses: count?.n ?? null, areaKm2: count?.area_km2 ?? null, residentsPerBusiness: count?.residents_per ?? null, businessesPerKm2: count?.per_km2 ?? null, density: count?.density ?? null }
        }),
        total: value.total!, districtSummary,
        districtSummaryStatus: districtSummary ? 'ready' : 'error',
      }
    })
    attachSource('income', requestWithDeadline((signal) => postMarket<DistrictIncomeResponse>('district-income', { city }, signal), cityRequests.signal), isDistrictIncomeResponse, (current, value) => {
      const income = joinDistrictByIdOrUniqueName(current.rows, value.districts!)
      return updateRows(current, (row) => {
        const item = income.get(row.id)
        return { ...row, income: item?.income_all ?? null, incomeMale: item?.income_male ?? null, incomeFemale: item?.income_female ?? null, incomeSaudi: item?.income_saudi ?? null, incomeNonSaudi: item?.income_non_saudi ?? null }
      })
    })
    attachSource('growth', requestWithDeadline((signal) => postMarket<{ available?: boolean; districts?: GrowthRow[] }>('growth', { city }, signal), cityRequests.signal), hasGrowthRows, (current, value) => {
      const growth = uniqueDistrictIdJoin(current.rows.map((row) => row.id), value.districts!)
      return updateRows(current, (row) => { const item = growth.get(row.id); return { ...row, underConstruction: item?.under_construction ?? null, newBuildings: item?.new_buildings ?? null } })
    })
    attachSource('housing', requestWithDeadline((signal) => postMarket<{ available?: boolean; districts?: HousingRow[] }>('housing-level', { city }, signal), cityRequests.signal), hasHousingRows, (current, value) => {
      const homes = uniqueDistrictIdJoin(current.rows.map((row) => row.id), value.districts!)
      return updateRows(current, (row) => ({ ...row, villaShare: homes.get(row.id)?.villa_share_pct ?? null }))
    })
    attachSource('realEstate', requestWithDeadline((signal) => postMarket<RealEstateDistrictResponse>('real-estate', { city }, signal), cityRequests.signal), isRealEstateDistrictResponse, (current, value) => {
      const listings = uniqueDistrictIdJoin(current.rows.map((row) => row.id), value.districts)
      return updateRows(current, (row) => ({ ...row, realEstate: Object.fromEntries(Object.entries(listings.get(row.id)?.groups ?? {}).map(([group, item]) => [group, {
        median: item.median_sar_per_sqm, listings: item.listings,
        ...(item.by_age ? { byAge: Object.fromEntries(Object.entries(item.by_age).map(([band, figure]) => [band, { median: figure!.median_sar_per_sqm, listings: figure!.listings }])) } : {}),
      }])) }))
    })
    attachSource('deals', requestWithDeadline((signal) => postMarket<RegisteredDealsResponse>('registered-deals', { city }, signal), cityRequests.signal), (value) => isRegisteredDealsResponse(value, city), (current, value) => {
      const paid = joinDistrictByIdOrUniqueName(current.rows, value.districts)
      return updateRows(current, (row) => {
        const deal = paid.get(row.id)
        const pick = (item?: { deals: number; median_sar_per_sqm: number }) => item ? { median: item.median_sar_per_sqm, deals: item.deals } : null
        return { ...row, deals: { residential: pick(deal?.residential), commercial: pick(deal?.commercial) } }
      })
    })
    attachSource('restaurants', requestWithDeadline((signal) => getJson<FarqDistrictResponse<RestaurantDistrictRow>>(`/api/farq/restaurants?city=${cityQuery}`, signal), cityRequests.signal), isRestaurantDistrictResponse, (current, value) => {
      const restaurants = uniqueDistrictIdJoin(current.rows.map((row) => row.id), value.districts)
      return updateRows(current, (row) => ({ ...row, restaurants: restaurants.get(row.id)?.restaurants ?? null }))
    })
    attachSource('menuPrices', requestWithDeadline((signal) => getJson<FarqDistrictResponse<MenuPriceDistrictRow>>(`/api/farq/menu-prices?city=${cityQuery}`, signal), cityRequests.signal), isMenuPriceDistrictResponse, (current, value) => {
      const menus = uniqueDistrictIdJoin(current.rows.map((row) => row.id), value.districts)
      return updateRows(current, (row) => ({ ...row, menuPrice: menus.get(row.id)?.price ?? null, menuPricePlaces: menus.get(row.id)?.places ?? null }))
    })
    attachSource('demand', requestWithDeadline((signal) => getJson<FarqDistrictResponse<DemandDistrictRow>>(`/api/farq/demand?city=${cityQuery}`, signal), cityRequests.signal), isDemandDistrictResponse, (current, value) => {
      const demand = uniqueDistrictIdJoin(current.rows.map((row) => row.id), value.districts)
      return updateRows(current, (row) => { const item = demand.get(row.id); return { ...row, searches: item?.searches ?? null, unmetSearches: item?.unmet ?? null, unmetTerms: item?.unmetTerms ?? [] } })
    })

    getRequired<{ features?: DistrictFeature[] }>(`/api/market/districts?city=${cityQuery}`, cityRequests.signal).then((atlas) => {
      if (!active) return
      if (!isCityDistrictFeatureCollection(atlas.features, expectedDistrictCount)) throw new Error('District outlines are missing or invalid')
      const features = atlas.features
      setData({ city, status: 'ready', features, rows: features.map(emptyDistrictRow), total: null, districtSummary: null, districtSummaryStatus: 'loading', pendingSources: CITY_DATA_SOURCES, failedSources: [] })
      mapReady = true
      queuedUpdates.splice(0).forEach((commit) => commit())
    }).catch(() => {
      if (active) setData({ city, status: 'error', features: [], rows: [], total: null, districtSummary: null, districtSummaryStatus: 'error', pendingSources: [], failedSources: [] })
      cityRequests.abort()
      queuedUpdates.length = 0
    })
    return () => { active = false; cityRequests.abort() }
  }, [city, attempt, expectedDistrictCount])

  const reload = () => setAttempt((n) => n + 1)
  // Effects clear the old request after render; never expose the previous city's ready data for that render frame.
  return data.city === city ? { ...data, reload } : { ...loadingCityData(city), reload }
}

/** Sum of a field over rows; null when any row lacks it, so a partial total is never shown as the whole. */
export function sumOf(rows: DistrictRow[], key: keyof Omit<DistrictRow, 'id' | 'name' | 'populationSource' | 'unmetTerms' | 'realEstate' | 'deals'>): number | null {
  if (!rows.length || rows.some((row) => row[key] == null)) return null
  return rows.reduce((total, row) => total + (row[key] as number), 0)
}
