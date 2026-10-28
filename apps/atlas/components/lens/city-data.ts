'use client'

import { useEffect, useState } from 'react'
import { districtName, postMarket, type DistrictFeature } from '@/lib/insights-api'

/**
 * One row per canonical district of a city, joined from the golden tables (docs/golden-data.md): the outline and
 * name from the atlas, population by district id, directory counts by canonical name, income and growth, and restaurants on delivery apps by
 * district id from Farq. A missing figure stays null and is shown as «غير متاح», never as zero.
 */
export type DistrictRow = {
  id: string
  name: string
  population: number | null
  populationSource: string | null
  businesses: number | null
  whatsapp: number | null
  restaurants: number | null
  /** Median menu-item price of the district's restaurants, and how many restaurants it rests on. */
  menuPrice: number | null
  menuPricePlaces: number | null
  income: number | null
  underConstruction: number | null
  newBuildings: number | null
  /** Share of the district's homes that are villas (buildings layer), a stand-in for income where none is published. */
  villaShare: number | null
}

export type CityData = {
  status: 'loading' | 'ready' | 'error'
  features: DistrictFeature[]
  rows: DistrictRow[]
  total: number | null
}

type PopulationRow = { district_id: string | number; district_ar: string; population: number | null; source?: string | null }
type CountRow = { district_ar: string; n: number; n_whatsapp?: number }
type IncomeRow = { district_ar: string; income_all?: number | null }
type GrowthRow = { district_ar: string; under_construction: number; new_buildings: number }
type HousingRow = { district_ar: string; villa_share_pct: number }
type RestaurantRow = { district_id: string; restaurants: number }
type MenuPriceRow = { district_id: string; price: number; places: number | null }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(String(response.status))
  return response.json() as Promise<T>
}

export function useCityData(city: string): CityData {
  const [data, setData] = useState<CityData>({ status: 'loading', features: [], rows: [], total: null })

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
      optional(getJson<{ districts?: RestaurantRow[] }>(`/api/farq/restaurants?city=${encodeURIComponent(city)}`)),
      optional(getJson<{ districts?: MenuPriceRow[] }>(`/api/farq/menu-prices?city=${encodeURIComponent(city)}`)),
    ]).then(([atlas, population, counts, income, growth, housing, restaurants, menuPrices]) => {
      if (!active) return
      const features = atlas.features ?? []
      const people = new Map((population?.districts ?? []).map((row) => [String(row.district_id), row]))
      const eateries = new Map((restaurants?.districts ?? []).map((row) => [row.district_id, row.restaurants]))
      const menus = new Map((menuPrices?.districts ?? []).map((row) => [row.district_id, row]))
      const byName = <R extends { district_ar: string }>(list?: R[]) => new Map((list ?? []).map((row) => [row.district_ar, row]))
      const count = byName(counts?.districts)
      const pay = byName(income?.districts)
      const built = byName(growth?.districts)
      const homes = byName(housing?.districts)
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
          whatsapp: c?.n_whatsapp ?? null,
          restaurants: eateries.get(id) ?? null,
          menuPrice: menus.get(id)?.price ?? null,
          menuPricePlaces: menus.get(id)?.places ?? null,
          income: pay.get(name)?.income_all ?? null,
          underConstruction: g ? g.under_construction : null,
          newBuildings: g ? g.new_buildings : null,
          villaShare: homes.get(name)?.villa_share_pct ?? null,
        }
      })
      setData({ status: 'ready', features, rows, total: counts?.total ?? null })
    }).catch(() => { if (active) setData({ status: 'error', features: [], rows: [], total: null }) })
    return () => { active = false }
  }, [city])

  return data
}

/** Sum of a field over rows; null when any row lacks it, so a partial total is never shown as the whole. */
export function sumOf(rows: DistrictRow[], key: keyof Omit<DistrictRow, 'id' | 'name' | 'populationSource'>): number | null {
  if (!rows.length || rows.some((row) => row[key] == null)) return null
  return rows.reduce((total, row) => total + (row[key] as number), 0)
}
