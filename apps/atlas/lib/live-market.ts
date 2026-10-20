import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'

export type DistrictCount = { district_ar: string; n: number; n_whatsapp?: number; n_wholesale?: number }
export type MarketSummary = {
  ok?: boolean
  summary?: {
    total?: number
    districts_count?: number
    n_whatsapp?: number
    n_wholesale?: number
    basis?: string
  }
}

export type LiveMarket = {
  districts: FeatureCollection<Geometry, GeoJsonProperties>
  counts: DistrictCount[]
  summary: MarketSummary['summary']
}

async function request<T>(resource: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/market/${resource}`, { cache: 'no-store', ...init })
  if (!response.ok) throw new Error('market-unavailable')
  return response.json() as Promise<T>
}

function asFeatureCollection(value: unknown): FeatureCollection<Geometry, GeoJsonProperties> {
  if (!value || typeof value !== 'object') throw new Error('invalid-districts')
  const raw = value as { type?: unknown; features?: unknown }
  if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) throw new Error('invalid-districts')
  return raw as FeatureCollection<Geometry, GeoJsonProperties>
}

export async function loadLiveMarket(city: string, q?: string): Promise<LiveMarket> {
  const apiCity = ({ riyadh: 'Riyadh', jeddah: 'Jeddah', dammam: 'Dammam' } as Record<string, string>)[city.toLowerCase()] ?? city
  const query = { city: apiCity, ...(q?.trim() ? { q: q.trim() } : {}) }
  const [districtsRaw, countsRaw, summaryRaw] = await Promise.all([
    request<unknown>(`districts?city=${encodeURIComponent(apiCity)}`),
    request<{ districts?: unknown }>('district-counts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) }),
    request<MarketSummary>('market-summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) }),
  ])
  return {
    districts: asFeatureCollection(districtsRaw),
    counts: Array.isArray(countsRaw?.districts) ? countsRaw.districts.filter((item): item is DistrictCount => Boolean(item && typeof item === 'object' && typeof (item as DistrictCount).district_ar === 'string')) : [],
    summary: summaryRaw?.summary,
  }
}
