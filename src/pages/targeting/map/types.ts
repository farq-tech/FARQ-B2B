import type { TradeCluster } from '../../../api/targetingClient'
import type { District, Layer, Pin } from './model'

/** The customer's site and delivery radius (owner 2026-10-16). */
export type Site = { lat: number; lon: number; km: number }

/** What both maps (Mapbox and the drawn fallback) draw. */
export type LayerMapProps = {
  districts: District[]
  chosen: Set<string>
  onDistrict: (id: string) => void
  pins: Pin[]
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
}
