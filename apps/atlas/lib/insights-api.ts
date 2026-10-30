'use client'

import { useEffect, useState } from 'react'

export type City = { en: string; ar: string | null; districts?: number }

// every figure in Atlas is written in English digits with English separators (docs/atlas-product-foundation.md §5)
export const numberFormat = new Intl.NumberFormat('en-US')

/**
 * Keeps a signed number, a percentage or a date in reading order inside an Arabic line. After an Arabic word the
 * browser reads Latin digits as Arabic numbers, which detaches their sign: «48%» shows as «%48», «−2» as «2−» and
 * «2026-10-28» as «28-10-2026». A left-to-right isolate keeps the figure whole.
 */
export const ltr = (text: string) => `\u2066${text}\u2069`
/** «48%», kept whole inside an Arabic line. */
export const percent = (value: number) => ltr(`${numberFormat.format(value)}%`)

/** POST a read-only market resource through the Atlas proxy and surface its Arabic error. */
export async function postMarket<T>(resource: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/market/${resource}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error((payload && payload.error) || 'تعذر تحميل البيانات.')
  return payload as T
}

/** Cities that have districts in the golden atlas, largest first: every insight works per district, so a city
 * without districts would only show an empty tool. Riyadh is the fallback while loading or on failure. */
export function useCities(): City[] {
  const [cities, setCities] = useState<City[]>([{ en: 'Riyadh', ar: 'الرياض' }])
  useEffect(() => {
    fetch('/api/market/cities')
      .then((response) => response.json())
      .then((rows: City[]) => {
        if (!Array.isArray(rows)) return
        const mapped = rows.some((row) => typeof row.districts === 'number') ? rows.filter((row) => (row.districts ?? 0) > 0) : rows
        if (mapped.length) setCities(mapped)
      })
      .catch(() => undefined)
  }, [])
  return cities
}

export type DistrictFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { id: string | number; ar?: string; district_ar?: string }>

/** Official district outlines of a city (canonical: one feature per district). */
export function useDistricts(city: string) {
  const [features, setFeatures] = useState<DistrictFeature[]>([])
  useEffect(() => {
    let active = true
    setFeatures([])
    fetch(`/api/market/districts?city=${encodeURIComponent(city)}`)
      .then((response) => response.json())
      .then((collection) => { if (active && Array.isArray(collection?.features)) setFeatures(collection.features) })
      .catch(() => undefined)
    return () => { active = false }
  }, [city])
  return features
}

export function districtName(feature: DistrictFeature) {
  return feature.properties.ar || feature.properties.district_ar || String(feature.properties.id)
}
