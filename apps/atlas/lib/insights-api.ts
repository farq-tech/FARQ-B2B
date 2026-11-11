'use client'

import { useEffect, useState } from 'react'
import { numberFormat } from './number-format.ts'

export { numberFormat }

export type City = { en: string; ar: string | null; districts?: number }
export type CityCatalogStatus = 'loading' | 'ready' | 'error'
const FALLBACK_CITIES: City[] = [{ en: 'Riyadh', ar: 'الرياض' }]

/** Validate the whole city catalog before a truncated or malformed response can hide cities. */
export function parseCityCatalog(payload: unknown): City[] {
  if (!Array.isArray(payload) || payload.length === 0) throw new Error('Missing city catalog')
  const rows = payload as unknown[]
  const hasDistrictCounts = rows.some((row) => typeof row === 'object' && row !== null && 'districts' in row)
  const parsed = rows.map((row) => {
    if (typeof row !== 'object' || row === null) throw new Error('Invalid city catalog row')
    const item = row as Record<string, unknown>
    if (typeof item.en !== 'string' || !item.en.trim() || !(typeof item.ar === 'string' || item.ar === null)) throw new Error('Invalid city identity')
    if (hasDistrictCounts && (!Number.isInteger(item.districts) || (item.districts as number) < 0)) throw new Error('Invalid district count')
    return { en: item.en, ar: item.ar, ...(hasDistrictCounts ? { districts: item.districts as number } : {}) }
  })
  return parsed
}

/** Keep cities without neighborhood boundaries selectable, but make that data gap visible in every city picker. */
export function cityLabel(city: City): string {
  const name = city.ar || city.en
  return city.districts === 0 ? `${name} · الأحياء غير متاحة` : name
}

/**
 * Keeps a signed number, a percentage or a date in reading order inside an Arabic line. After an Arabic word the
 * browser reads Latin digits as Arabic numbers, which detaches their sign: «48%» shows as «%48», «−2» as «2−» and
 * «2026-10-28» as «28-10-2026». A left-to-right isolate keeps the figure whole.
 */
export const ltr = (text: string) => `\u2066${text}\u2069`
/** «48%», kept whole inside an Arabic line. */
export const percent = (value: number) => ltr(`${numberFormat.format(value)}%`)

// one, two, 3–10, a figure ending 11–99, and the singular after any other figure from 100 up (100, 105, 1,000 …)
const NOUNS = {
  district: ['حي واحد', 'حيّان', 'أحياء', 'حياً', 'حي'],
  branch: ['فرع واحد', 'فرعان', 'فروع', 'فرعاً', 'فرع'],
  business: ['منشأة واحدة', 'منشأتان', 'منشآت', 'منشأة', 'منشأة'],
} as const

/** A count with its noun in Arabic agreement: «حي واحد», «حيّان», «5 أحياء», «23 حياً», «100 حي». */
export function counted(value: number, noun: keyof typeof NOUNS): string {
  const [one, two] = NOUNS[noun]
  if (value === 1) return one
  if (value === 2) return two
  return `${numberFormat.format(value)} ${nounAfter(value, noun)}`
}

/** The noun that follows a written figure, for a figure set apart (a signed change): «+1 فرع», «+5 فروع», «+30 فرعاً». */
export function nounAfter(value: number, noun: keyof typeof NOUNS): string {
  const [, , few, many, hundred] = NOUNS[noun]
  // the plural only for 3–10 itself: «105 منشآت» is correct Arabic but reads as a different word beside «144 منشأة»
  const size = Math.abs(value)
  if (size >= 3 && size <= 10) return few
  return size % 100 >= 11 ? many : hundred
}

/** POST a read-only market resource through the Atlas proxy and surface its Arabic error. */
export async function postMarket<T>(resource: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/market/${resource}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error((payload && payload.error) || 'تعذر تحميل البيانات.')
  return payload as T
}

export type MainActivity = { main_id: string; main_ar: string }

/** Preserve a cross-city activity choice when the destination city has no records in that category. */
export function resolveMainActivitySelection(activities: MainActivity[], value: string, valueLabel?: string) {
  const listed = activities.find((item) => item.main_id === value)
  const missing = !listed && !!value && !!valueLabel
  return {
    activity: listed ?? (missing ? { main_id: value, main_ar: valueLabel! } : null),
    missing,
  }
}

/** Load the city's approved activity list without making a failed request look like an empty catalog. */
export function useMainActivities(city: string) {
  const [activities, setActivities] = useState<MainActivity[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setActivities([])
    setStatus('loading')
    postMarket<{ summary?: { main_activities?: MainActivity[] } }>('market-summary', { city })
      .then((payload) => {
        if (!active) return
        if (!Array.isArray(payload.summary?.main_activities)) throw new Error('Missing activity list')
        setActivities(payload.summary.main_activities)
        setStatus('ready')
      })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [city, attempt])

  return { activities, status, retry: () => setAttempt((value) => value + 1) }
}

/** Cities that have districts in the golden atlas; failures retain a visible Riyadh fallback with retry status. */
export function useCities(): { cities: City[]; status: CityCatalogStatus; retry: () => void } {
  const [cities, setCities] = useState<City[]>(FALLBACK_CITIES)
  const [status, setStatus] = useState<CityCatalogStatus>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setStatus('loading')
    fetch('/api/market/cities')
      .then(async (response) => {
        if (!response.ok) throw new Error(`City catalog request failed: ${response.status}`)
        return parseCityCatalog(await response.json())
      })
      .then((items) => {
        if (!active) return
        setCities(items)
        setStatus('ready')
      })
      .catch(() => { if (active) { setCities(FALLBACK_CITIES); setStatus('error') } })
    return () => { active = false }
  }, [attempt])
  return { cities, status, retry: () => setAttempt((value) => value + 1) }
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
