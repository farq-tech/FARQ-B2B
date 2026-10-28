import type { ReactNode } from 'react'
import type { Area, Circle, ListingDot, MapPoint, Site } from '../lens-map-canvas'

/** What a tool draws on the shared lens map: its own district colours, a circle, listings, a card over the map, and whether clicks pick a point. */
export type Overlay = {
  colors?: Map<string, string> | null
  circle?: Circle | null
  onPick?: ((point: { lon: number; lat: number }) => void) | null
  points?: MapPoint[] | null
  lines?: GeoJSON.LineString[] | null
  start?: { lon: number; lat: number } | null
  areas?: Area[] | null
  sites?: Site[] | null
  listings?: ListingDot[] | null
  onListing?: ((id: string) => void) | null
  focus?: { lon: number; lat: number } | null
  /** A card the tool floats over the map, such as the listing a click opened. */
  popup?: ReactNode
}
