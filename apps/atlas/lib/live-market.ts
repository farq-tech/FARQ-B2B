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
    densest_street?: {
      street_ar?: string
      district_ar?: string
      n?: number
      length_m?: number
      per_100m?: number
      sub_ar?: string
    }
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

/** A live activity scope supplied by the read-only street density catalog. */
export type LiveActivityMain = {
  main_id: string
  main_ar: string
  streets: number
  shops: number
  subs: { sub_id: string; sub_ar: string; streets: number; shops: number }[]
}

export type LiveMarketScope = {
  q?: string
  mainId?: string
  subIds?: string[]
  /** Canonical Arabic district names accepted by the aggregate market service. */
  districts?: string[]
}

export type LiveMarket = {
  districts: FeatureCollection<Geometry, GeoJsonProperties>
  counts: DistrictCount[]
  summary: MarketSummary['summary']
  streets: FeatureCollection<Geometry, StreetDensityProperties>
  clusters: MarketCluster[]
  /** Optional aggregate feeds that were unavailable for this read. The map remains usable when its geometry loaded. */
  unavailable: Array<'districtCounts' | 'summary' | 'streets' | 'clusters'>
  /** Time the current aggregate response reached Atlas, not a claim about source-record freshness. */
  loadedAt: string
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

function activityCatalog(value: unknown): LiveActivityMain[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { mains?: unknown }).mains)) return []
  return (value as { mains: unknown[] }).mains.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const main = item as Partial<LiveActivityMain>
    if (typeof main.main_id !== 'string' || typeof main.main_ar !== 'string') return []
    const subs = Array.isArray(main.subs)
      ? main.subs.flatMap((sub) => sub && typeof sub === 'object' && typeof (sub as { sub_id?: unknown }).sub_id === 'string' && typeof (sub as { sub_ar?: unknown }).sub_ar === 'string'
        ? [{
            sub_id: (sub as { sub_id: string }).sub_id,
            sub_ar: (sub as { sub_ar: string }).sub_ar,
            streets: typeof (sub as { streets?: unknown }).streets === 'number' ? (sub as { streets: number }).streets : 0,
            shops: typeof (sub as { shops?: unknown }).shops === 'number' ? (sub as { shops: number }).shops : 0,
          }]
        : [])
      : []
    return [{ main_id: main.main_id, main_ar: main.main_ar, streets: typeof main.streets === 'number' ? main.streets : 0, shops: typeof main.shops === 'number' ? main.shops : 0, subs }]
  })
}

export async function loadLiveActivityCatalog(city: string, scope: Pick<LiveMarketScope, 'districts'> = {}): Promise<LiveActivityMain[]> {
  const apiCity = ({ riyadh: 'Riyadh', jeddah: 'Jeddah', dammam: 'Dammam' } as Record<string, string>)[city.toLowerCase()] ?? city
  const response = await request<unknown>('street-density/catalog', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ city: apiCity, ...(scope.districts?.length ? { districts: scope.districts.slice(0, 30) } : {}) }),
  })
  return activityCatalog(response)
}

export async function loadLiveMarket(city: string, scope: LiveMarketScope = {}): Promise<LiveMarket> {
  const apiCity = ({ riyadh: 'Riyadh', jeddah: 'Jeddah', dammam: 'Dammam' } as Record<string, string>)[city.toLowerCase()] ?? city
  const query = {
    city: apiCity,
    ...(scope.q?.trim() ? { q: scope.q.trim() } : {}),
    ...(scope.mainId ? { main_id: scope.mainId } : {}),
    ...(scope.subIds?.length ? { sub_ids: scope.subIds.slice(0, 20) } : {}),
    ...(scope.districts?.length ? { districts: scope.districts.slice(0, 30) } : {}),
  }
  const json = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) }
  // District geometry is the minimum viable market view. The other aggregate
  // reads enrich it, but a transient upstream failure must not blank the map.
  const [districtsResult, countsResult, summaryResult, streetsResult, clustersResult] = await Promise.allSettled([
    request<unknown>(`districts?city=${encodeURIComponent(apiCity)}`),
    request<{ districts?: unknown }>('district-counts', json),
    request<MarketSummary>('market-summary', json),
    request<unknown>('street-density', json),
    request<unknown>('clusters', json),
  ])
  if (districtsResult.status !== 'fulfilled') throw new Error('districts-unavailable')

  const unavailable: LiveMarket['unavailable'] = []
  if (countsResult.status !== 'fulfilled') unavailable.push('districtCounts')
  if (summaryResult.status !== 'fulfilled') unavailable.push('summary')
  if (streetsResult.status !== 'fulfilled') unavailable.push('streets')
  if (clustersResult.status !== 'fulfilled') unavailable.push('clusters')

  const streets = streetsResult.status === 'fulfilled'
    ? (() => { try { return asFeatureCollection<StreetDensityProperties>(streetsResult.value) } catch { unavailable.push('streets'); return EMPTY_STREETS } })()
    : EMPTY_STREETS
  const scopedDistricts = new Set(scope.districts ?? [])
  // The cluster feed is pre-aggregated. Keep only clusters whose district is
  // explicitly in scope; unknown-location aggregates are hidden rather than
  // appearing to belong to a selected district.
  const marketClusters = clustersResult.status === 'fulfilled'
    ? clusters(clustersResult.value).filter((cluster) => !scopedDistricts.size || (typeof cluster.district_ar === 'string' && scopedDistricts.has(cluster.district_ar)))
    : []
  return {
    districts: asFeatureCollection(districtsResult.value),
    counts: countsResult.status === 'fulfilled' && Array.isArray(countsResult.value?.districts)
      ? countsResult.value.districts.filter((item): item is DistrictCount => Boolean(item && typeof item === 'object' && typeof (item as DistrictCount).district_ar === 'string'))
      : [],
    summary: summaryResult.status === 'fulfilled' ? summaryResult.value?.summary : undefined,
    streets,
    clusters: marketClusters,
    unavailable,
    loadedAt: new Date().toISOString(),
  }
}
