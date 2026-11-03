/**
 * Where the lens map looks when a city opens. A city's district table can carry a few districts far from the city
 * itself (in Riyadh «الجامعية» sits 4° west and «قاعدة الامير سلطان الجوية» near Al-Kharj; in Dammam the «هجر»
 * districts near Al-Ahsa): framing every outline opened the map on half the Kingdom with Riyadh a blob at its edge.
 * The frame takes the districts around the city's middle and leaves out those far from it; they stay on the map.
 */

type Shape = { geometry?: { coordinates?: unknown } | null }
export type Bounds = [[number, number], [number, number]]

/** A district farther from the city's middle than this many times the middle district's distance is left out of the frame. */
export const FAR = 8

function boxOf(feature: Shape): Bounds | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  const visit = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === 'number') {
      const [x, y] = coords as [number, number]
      west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y)
    } else if (Array.isArray(coords)) coords.forEach(visit)
  }
  visit(feature.geometry?.coordinates)
  return west < Infinity ? [[west, south], [east, north]] : null
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** The box around the city's districts, leaving out the few far from the rest; null when no district has an outline. */
export function cityFrame(features: Shape[]): Bounds | null {
  const boxes = features.map(boxOf).filter((box): box is Bounds => box != null)
  if (!boxes.length) return null
  const centres = boxes.map(([[west, south], [east, north]]) => [(west + east) / 2, (south + north) / 2] as const)
  const x = median(centres.map(([lon]) => lon))
  const y = median(centres.map(([, lat]) => lat))
  const squeeze = Math.cos((y * Math.PI) / 180)
  const distance = centres.map(([lon, lat]) => Math.hypot((lon - x) * squeeze, lat - y))
  // a floor of about 1 km, so a city of a handful of neighbouring districts never drops one for being a street away
  const reach = Math.max(FAR * median(distance), 0.01)
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  boxes.forEach(([[w, s], [e, n]], index) => {
    if (distance[index] > reach) return
    west = Math.min(west, w); south = Math.min(south, s); east = Math.max(east, e); north = Math.max(north, n)
  })
  return [[west, south], [east, north]]
}

export type Padding = { top: number; bottom: number; left: number; right: number }

/**
 * The room the map keeps clear around a city or a district, so it lands in the part of the map still in view: on a
 * phone the floating search and chips on top, the colour key and whatever the bottom sheet covers below (the key then
 * rides above the sheet); beside the
 * panel from lg, the colour key in the bottom corner. `cover` is the share of the screen the phone's sheet covers
 * (0 while it only peeks: the map already ends above the peek), `peek` the peek in pixels.
 */
/**
 * How many pixels at the foot of the map a phone's sheet covers: it covers `cover` of the whole screen, of which the map
 * already ends above the peek. 0 on a wide screen or while the sheet peeks.
 */
export function sheetCoverPx({ height, phone, cover, peek }: { height: number; phone: boolean; cover: number; peek: number }): number {
  return phone && cover > 0 ? Math.max(0, cover * (height + peek) - peek) : 0
}

export function framePadding({ height, width, phone, cover, peek }: { height: number; width: number; phone: boolean; cover: number; peek: number }): Padding {
  const sheet = sheetCoverPx({ height, phone, cover, peek })
  const wanted: Padding = phone
    // over a half sheet the colour key rides above it in one line (lens-map.tsx), about 56px with its gap
    ? { top: 124, bottom: sheet + (sheet > 0 ? 64 : 104), left: 16, right: 16 }
    : { top: 40, bottom: 104, left: 40, right: 40 }
  // a short or narrow map keeps at least a third of itself for the city
  const fit = (a: number, b: number, size: number) => {
    const room = size * (2 / 3)
    return a + b <= room ? [a, b] : [a * (room / (a + b)), b * (room / (a + b))]
  }
  const [top, bottom] = fit(wanted.top, wanted.bottom, height)
  const [left, right] = fit(wanted.left, wanted.right, width)
  return { top, bottom, left, right }
}
