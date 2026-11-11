import type { Map as MapboxMap } from 'mapbox-gl'
import { PALETTE } from '@/lib/palette'

/**
 * The map's drawn symbols (docs/design/map-components-brief.md), painted in code from the designer's shapes in
 * public/map so the number, the price and the colour stay live: a candidate-site pin in its site's colour, a listing's
 * price capsule in its tone, the route's direction chevron and the «غير متاح» hatch. The delivered PNGs carry a
 * baked-in number or price and a clipped capsule, so they are the reference here, not the files drawn.
 */

const RATIO = 2
type Painted = { width: number; height: number; data: Uint8Array }

function paint(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): Painted | null {
  const canvas = document.createElement('canvas')
  canvas.width = width * RATIO
  canvas.height = height * RATIO
  const context = canvas.getContext('2d')
  if (!context) return null
  context.scale(RATIO, RATIO)
  draw(context)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(data.buffer) }
}

/** pin-site.svg: a 34 × 44 teardrop with a white edge, its tip at the bottom centre. */
const PIN_PATH = 'M17 1.2C7.9 1.2 1 8.2 1 17.1c0 10.5 16 25.7 16 25.7s16-15.2 16-25.7C33 8.2 26.1 1.2 17 1.2Z'
export const PIN_SIZE = { width: 34, height: 44, /** The head's centre, up from the tip. */ head: 28 }

function pin(color: string) {
  return paint(PIN_SIZE.width, PIN_SIZE.height, (context) => {
    const shape = new Path2D(PIN_PATH)
    context.shadowColor = 'rgba(23,42,30,0.25)'
    context.shadowBlur = 3
    context.shadowOffsetY = 1
    context.fillStyle = color
    context.fill(shape)
    context.shadowColor = 'transparent'
    context.lineWidth = 2
    context.strokeStyle = PALETTE.white
    context.stroke(shape)
    context.beginPath()
    context.arc(17, 16, 10.2, 0, 2 * Math.PI)
    context.lineWidth = 1
    context.strokeStyle = 'rgba(255,255,255,0.45)'
    context.stroke()
  })
}

/**
 * price-pill: a rounded capsule with a tail under its middle, stretched around the price by the map
 * (icon-text-fit), so any price fits and nothing is clipped. Logical size 40 × 30: the body is 24 high, the tail 6.
 */
export const PILL = { body: 24, tail: 6, /** From the price's foot to the tail's tip: the fit padding, the body under the content, the tail. */ below: 2 + 5 + 6 }
function pill(fill: string, edge: string, edgeWidth: number) {
  const width = 40, radius = 12, middle = 20, half = 5
  const image = paint(width, PILL.body + PILL.tail, (context) => {
    const inset = edgeWidth / 2
    const bottom = PILL.body - inset
    context.beginPath()
    context.moveTo(radius, inset)
    context.lineTo(width - radius, inset)
    context.arc(width - radius, radius, radius - inset, -Math.PI / 2, Math.PI / 2)
    context.lineTo(middle + half, bottom)
    context.lineTo(middle, PILL.body + PILL.tail - inset)
    context.lineTo(middle - half, bottom)
    context.lineTo(radius, bottom)
    context.arc(radius, radius, radius - inset, Math.PI / 2, -Math.PI / 2)
    context.closePath()
    context.shadowColor = 'rgba(23,42,30,0.22)'
    context.shadowBlur = 2
    context.shadowOffsetY = 1
    context.fillStyle = fill
    context.fill()
    context.shadowColor = 'transparent'
    context.lineWidth = edgeWidth
    context.strokeStyle = edge
    context.stroke()
  })
  if (!image) return null
  const px = (value: number) => value * RATIO
  // the two runs either side of the tail stretch; the round ends and the tail keep their shape
  return {
    image,
    options: {
      pixelRatio: RATIO,
      stretchX: [[px(radius), px(middle - half - 1)], [px(middle + half + 1), px(width - radius)]] as [number, number][],
      stretchY: [[px(10), px(14)]] as [number, number][],
      content: [px(9), px(5), px(width - 9), px(PILL.body - 5)] as [number, number, number, number],
    },
  }
}

/**
 * route-arrow: a white chevron on a small olive disc along the route. The delivered arrow is olive (it vanishes on the
 * olive line), and a bare white one is wider than the 4 px line and melts into its white casing.
 */
function chevron() {
  return paint(16, 16, (context) => {
    context.beginPath()
    context.arc(8, 8, 6.6, 0, 2 * Math.PI)
    context.fillStyle = PALETTE.olive
    context.fill()
    context.lineWidth = 1.4
    context.strokeStyle = PALETTE.white
    context.stroke()
    context.beginPath()
    context.moveTo(6.6, 5)
    context.lineTo(9.6, 8)
    context.lineTo(6.6, 11)
    context.lineWidth = 1.8
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke()
  })
}

/** pattern-unavailable: an even diagonal hatch (the delivered tile leaves every second gap twice as wide). */
function hatch() {
  return paint(8, 8, (context) => {
    context.strokeStyle = 'rgba(23,42,30,0.30)'
    context.lineWidth = 1.1
    for (const offset of [-8, 0, 8]) {
      context.beginPath()
      context.moveTo(offset, 8)
      context.lineTo(offset + 8, 0)
      context.stroke()
    }
  })
}

export const SYMBOL = { arrow: 'route-arrow', hatch: 'pattern-unavailable', pillActive: 'price-pill-active' } as const

/** Adds the fixed symbols, and paints a pin or a capsule in a new colour the first time a layer asks for it. */
export function installSymbols(instance: MapboxMap) {
  const add = (id: string, image: Painted | null, options?: Parameters<MapboxMap['addImage']>[2]) => {
    if (image && !instance.hasImage(id)) instance.addImage(id, image, { pixelRatio: RATIO, ...options })
  }
  add(SYMBOL.arrow, chevron())
  add(SYMBOL.hatch, hatch())
  const active = pill(PALETTE.white, PALETTE.ink, 2)
  if (active) add(SYMBOL.pillActive, active.image, active.options)
  instance.on('styleimagemissing', ({ id }: { id: string }) => {
    if (id.startsWith('pin-site-')) add(id, pin(id.slice('pin-site-'.length)))
    else if (id.startsWith('price-pill-')) {
      const made = pill(id.slice('price-pill-'.length), PALETTE.white, 1.5)
      if (made) add(id, made.image, made.options)
    }
  })
}
