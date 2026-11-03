import type { ReactNode } from 'react'
import type { Area, Circle, ListingDot, MapPoint, Site, StreetLine } from '../lens-map-canvas'
import type { Legend } from './map-legend'

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
  /** Trade corridors drawn along their streets, and what a click on one opens. */
  streets?: StreetLine[] | null
  onStreet?: ((id: string) => void) | null
  focus?: { lon: number; lat: number } | null
  /** The key to the tool's colours, shown in the map's corner. */
  legend?: Legend | null
  /** The step's answer in one line, from the API's values as returned, for the phone's sheet while it only peeks. */
  summary?: string | null
  /** The district the step's answer puts first (as the API ordered it), offered to a first visit as «أرني الأعلى». */
  lead?: string | null
  /** While the tool colours the districts: one line per district id for the card beside the pointer, from the
   * tool's own answer, so a colour reads as its figure before any click. */
  hover?: Map<string, string> | null
  /** The step's answer for one district, in one line, by district id: the card a click on the map opens leads with it.
   * A district the step has no figure for is left out (the card then says «غير متاح»), never given a zero. */
  facts?: Map<string, string> | null
  /** A card the tool floats over the map, such as the listing a click opened. */
  popup?: ReactNode
  /** The step's own request while it has no answer: `loading` (and `slow` once it has taken long), or `error` with the
   * step's `retry`. The map says it where the step's line goes (the phone's peeking sheet) and, when slow, why and
   * what to do; a step that is waiting for the customer posts none. */
  state?: 'loading' | 'error' | null
  slow?: boolean
  retry?: (() => void) | null
}

/** The overlay of a step whose answer is not in yet: its request's state as `useAnswer` holds it, nothing when idle. */
export function waiting(answer: { status: 'idle' | 'loading' | 'ready' | 'error'; slow: boolean; retry: () => void }): Overlay {
  if (answer.status === 'loading') return { state: 'loading', slow: answer.slow }
  if (answer.status === 'error') return { state: 'error', retry: answer.retry }
  return {}
}
