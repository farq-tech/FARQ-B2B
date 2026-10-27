'use client'

import { useEffect, useState } from 'react'

export type City = { en: string; ar: string | null }

export const numberFormat = new Intl.NumberFormat('ar-SA-u-nu-latn')

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

/** The directory's cities, largest first, with Riyadh as a fallback while loading or on failure. */
export function useCities(): City[] {
  const [cities, setCities] = useState<City[]>([{ en: 'Riyadh', ar: 'الرياض' }])
  useEffect(() => {
    fetch('/api/market/cities')
      .then((response) => response.json())
      .then((rows: City[]) => { if (Array.isArray(rows) && rows.length) setCities(rows) })
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
