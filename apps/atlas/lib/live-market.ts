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

/** Read-only street geometry and density, aggregated by the targeting service. */
export type StreetDensityProperties = GeoJsonProperties & {
  label_ar?: string
  street_ar?: string
  district_ar?: string
  n?: number
  n_whatsapp?: number
  n_wholesale?: number
  lift?: number
}

/** A geographically aggregated market result. It deliberately contains no contacts. */
export type MarketCluster = {
  level?: 'street' | 'district' | 'cell'
  label_ar?: string
  district_ar?: string
  street_ar?: string
  n?: number
  n_whatsapp?: number
  n_wholesale?: number
  lat?: number
  lon?: number
}

export type LiveMarket = {
  districts: FeatureCollection<Geometry, GeoJsonProperties>
  counts: DistrictCount[]
  summary: MarketSummary['summary']
  streets: FeatureCollection<Geometry, StreetDensityProperties>
  clusters: MarketCluster[]
}

const EMPTY_STREETS: FeatureCollection<Geometry, StreetDensityProperties> = { type: 'FeatureCollection', features: [] }

async function request<T>(resource: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/market/${resource}`, { cache: 'no-store', ...init })
  if (!response.ok) throw new Error('market-unavailable')
  return response.json() as Promise<T>
}

function asFeatureCollection<T extends GeoJsonProperties = GeoJsonProperties>(value: unknown): FeatureCollection<Geometry, T> {
  if (!value || typeof value !== 'object') throw new Error('invalid-market-geometry')
  const raw = value as { type?: unknown; features?: unknown }
  if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) throw new Error('invalid-market-geometry')
  return raw as FeatureCollection<Geometry, T>
}

function clusters(value: unknown): MarketCluster[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { clusters?: unknown }).clusters)) return []
  return (value as { clusters: unknown[] }).clusters.filter((item): item is MarketCluster => {
    if (!item || typeof item !== 'object') return false
    const cluster = item as MarketCluster
    return typeof cluster.lat === 'number' && typeof cluster.lon === 'number' && typeof cluster.n === 'number'
  })
}

export async function loadLiveMarket(city: string, q?: string): Promise<LiveMarket> {
  const apiCity = ({ riyadh: 'Riyadh', jeddah: 'Jeddah', dammam: 'Dammam' } as Record<string, string>)[city.toLowerCase()] ?? city
  const query = { city: apiCity, ...(q?.trim() ? { q: q.trim() } : {}) }
  const json = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) }
  // The base market view is required; the two visual overlays must not take it down
  // when an upstream aggregation is temporarily unavailable.
  const [districtsRaw, countsRaw, summaryRaw] = await Promise.all([
    request<unknown>(`districts?city=${encodeURIComponent(apiCity)}`),
    request<{ districts?: unknown }>('district-counts', json),
    request<MarketSummary>('market-summary', json),
  ])
  const [streetsResult, clustersResult] = await Promise.allSettled([
    request<unknown>('street-density', json),
    request<unknown>('clusters', json),
  ])
  const streets = streetsResult.status === 'fulfilled'
    ? (() => { try { return asFeatureCollection<StreetDensityProperties>(streetsResult.value) } catch { return EMPTY_STREETS } })()
    : EMPTY_STREETS
  const marketClusters = clustersResult.status === 'fulfilled' ? clusters(clustersResult.value) : []
  return {
    districts: asFeatureCollection(districtsRaw),
    counts: Array.isArray(countsRaw?.districts) ? countsRaw.districts.filter((item): item is DistrictCount => Boolean(item && typeof item === 'object' && typeof (item as DistrictCount).district_ar === 'string')) : [],
    summary: summaryRaw?.summary,
    streets,
    clusters: marketClusters,
  }
}
