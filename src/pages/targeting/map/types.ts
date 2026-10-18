import type { TradeCluster } from '../../../api/targetingClient'
import type { District, Layer, Pin, Street } from './model'

/** The customer's site and delivery radius (owner 2026-10-16). */
export type Site = { lat: number; lon: number; km: number }

/** What both maps (Mapbox and the drawn fallback) draw. */
export type LayerMapProps = {
  city: string
  /** Tell Mapbox when the containing page switches between normal and full-screen layout. */
  focusMode?: boolean
  districts: District[]
  chosen: Set<string>
  onDistrict: (id: string) => void
  pins: Pin[]
  /** Result card or keyboard focus currently highlighting a precise map pin. */
  highlightedPinKey?: string | null
  /** Authenticated, aggregated business vector tiles for the current city/activity/district cohort. */
  tileQuery?: string
  onTileRefresh?: () => void
  layer: Layer
  onPin: (key: string) => void
  /** names for the pins (tooltip / accessible name) */
  nameOf: (key: string) => string
  clusters: TradeCluster[]
  onCluster: (c: TradeCluster) => void
  site: Site | null
  /** «حدد موقعك»: the next tap on the map places the site */
  placingSite: boolean
  onPlaceSite: (lat: number, lon: number) => void
  /** fit to these bounds when it changes ([w, s, e, n]) */
  fit: { bounds: [number, number, number, number]; at: number } | null
  /** rows' extent before any district geometry is known */
  extent: [number, number, number, number] | null
  /** the densest streets of this request, drawn along the street */
  streets: Street[]
  activeStreet: string | null
  onStreet: (id: string) => void
  /** places per district for the choropleth (district id → n) and its maximum */
  density: Map<string, number>
  densityMax: number
  /** Display-only layer toggles; they never alter the query or selected records. */
  showDensity: boolean
  showDistricts: boolean
  /** City-wide aggregated market clusters, separate from individual establishment points. */
  showClusters: boolean
  showPlaces: boolean
  showStreets: boolean
}
