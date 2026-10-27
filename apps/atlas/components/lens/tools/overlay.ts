import type { Circle } from '../lens-map-canvas'

/** What a tool draws on the shared lens map: its own district colours, a circle, and whether clicks pick a point. */
export type Overlay = {
  colors?: Map<string, string> | null
  circle?: Circle | null
  onPick?: ((point: { lon: number; lat: number }) => void) | null
}
