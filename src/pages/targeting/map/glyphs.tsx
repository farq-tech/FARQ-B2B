import { MAP_ICONS } from './icons.data'
import type { PinFit } from './model'

/*
 * Map glyphs (owner 2026-10-16): layer 1 = charcoal teardrop pin with the main-activity icon in white,
 * layer 2 = green circle with the subcategory icon in white, layer 3 = navy rounded chip with the specialty text.
 * Icons: Tabler 3.19.0 (MIT), 24 grid, 2px stroke. The same drawings feed the Mapbox images and the drawn map.
 */
/** For React-drawn SVG: the tokens themselves. */
export const INK = 'var(--map-ink)', GREEN = 'var(--map-green)', NAVY = 'var(--map-navy)', WHITE = 'white'
/** For SVG strings, canvas and Mapbox paint: the tokens' resolved values. */
export function palette() {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(n).trim()
  return { ink: v('--map-ink'), green: v('--map-green'), navy: v('--map-navy'), sand: v('--map-sand'), danger: v('--color-text-danger'), muted: v('--color-text-tertiary'), white: 'white', label: v('--map-label') }
}

function fitColor(fit: PinFit, p: ReturnType<typeof palette>) {
  return fit === 'likely' ? p.green : fit === 'maybe' ? p.sand : fit === 'low' ? p.danger : p.muted
}

/** A small secondary mark keeps fit separate from the pin shape (taxonomy) and its selection outline. */
export function fitBadgeSvg(fit: PinFit, p = palette()) {
  const color = fitColor(fit, p)
  if (fit === 'maybe') return `<path d="M32 1.5 38.5 8 32 14.5 25.5 8Z" fill="${color}" stroke="white" stroke-width="2"/>`
  if (fit === 'low') return `<circle cx="32" cy="8" r="6.5" fill="${color}" stroke="white" stroke-width="2"/><path d="m29.5 5.5 5 5m0-5-5 5" stroke="white" stroke-width="1.7" stroke-linecap="round"/>`
  if (fit === 'unknown') return `<circle cx="32" cy="8" r="5.5" fill="white" stroke="${color}" stroke-width="2.5"/>`
  return `<circle cx="32" cy="8" r="6.5" fill="${color}" stroke="white" stroke-width="2"/>`
}

export function FitSwatch({ fit }: { fit: PinFit }) {
  const color = fit === 'likely' ? 'var(--map-green)' : fit === 'maybe' ? 'var(--map-sand)' : fit === 'low' ? 'var(--color-text-danger)' : 'var(--color-text-tertiary)'
  return fit === 'maybe'
    ? <span aria-hidden className="size-3 rotate-45 border-2 border-white shadow-[0_0_0_1px_var(--map-sand)]" style={{ background: color }} />
    : fit === 'unknown'
      ? <span aria-hidden className="size-3 rounded-full border-2 border-[var(--color-text-tertiary)] bg-white" />
      : fit === 'low'
        ? <span aria-hidden className="flex size-3 items-center justify-center rounded-full border border-white text-[8px] leading-none text-white shadow-[0_0_0_1px_var(--color-text-danger)]" style={{ background: color }}>×</span>
        : <span aria-hidden className="size-3 rounded-full border-2 border-white shadow-[0_0_0_1px_var(--map-green)]" style={{ background: color }} />
}

export const MAP_ICON_BODY = (name: string) => MAP_ICONS[name] || MAP_ICONS['map-pin']
const iconBody = MAP_ICON_BODY

/** A Tabler icon as a React element (decorative). */
export function MapIcon({ name, size = 18, className, color = 'currentColor' }: { name: string; size?: number; className?: string; color?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: iconBody(name) }} />
  )
}

const g = (name: string, color: string) => `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconBody(name)}</g>`
/** Teardrop path in a 40×48 box; the tip is at (20, 47). */
export const TEARDROP = 'M20 47c-1.2 0-2-.9-2.6-1.8L11 35.6A17 17 0 1 1 29 35.6l-6.4 9.6c-.6.9-1.4 1.8-2.6 1.8z'

/** Standalone SVG strings (for Mapbox images). */
export const pinSvg = (name: string, chosen = false, fit: PinFit = 'unknown') => { const c = palette(); return (
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="${TEARDROP}" fill="${c.ink}" stroke="${chosen ? c.green : c.white}" stroke-width="${chosen ? 3 : 2}"/><g transform="translate(9 7) scale(.92)">${g(name, c.white)}</g>${fitBadgeSvg(fit, c)}</svg>`) }
export const circleSvg = (name: string, chosen = false, fit: PinFit = 'unknown') => { const c = palette(); return (
  `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="${c.green}" stroke="${chosen ? c.ink : c.white}" stroke-width="${chosen ? 3 : 2.5}"/><g transform="translate(8.2 8.2) scale(.9)">${g(name, c.white)}</g>${fitBadgeSvg(fit, c)}</svg>`) }

/** Chip width for a specialty text at 12px (approximation used by the drawn map). */
export const chipWidth = (text: string) => Math.min(190, 18 + clip(text).length * 6.4)
export const clip = (text: string) => (text.length > 26 ? `${text.slice(0, 25)}…` : text)

/** A navy chip with white text, drawn on a canvas (Mapbox image; pixelRatio 2). */
export function chipImage(text: string, chosen = false, fit: PinFit = 'unknown'): { width: number; height: number; data: Uint8ClampedArray } {
  const s = 2
  const c = document.createElement('canvas')
  const x = c.getContext('2d')!
  const p = palette()
  const font = `600 ${12 * s}px 'ITF Huwiya Arabic', Tajawal, system-ui, sans-serif`
  x.font = font
  const t = clip(text)
  const w = Math.ceil(x.measureText(t).width) + 22 * s, h = 32 * s
  c.width = w; c.height = h
  x.font = font
  x.fillStyle = p.navy
  x.beginPath(); x.roundRect(0, 0, w, 26 * s, 8 * s); x.fill()
  if (chosen) { x.strokeStyle = p.green; x.lineWidth = 3 * s; x.beginPath(); x.roundRect(1.5 * s, 1.5 * s, w - 3 * s, 23 * s, 7 * s); x.stroke() }
  x.beginPath(); x.moveTo(w / 2 - 5 * s, 26 * s); x.lineTo(w / 2, 32 * s); x.lineTo(w / 2 + 5 * s, 26 * s); x.fill()
  x.beginPath(); x.arc(w - 7 * s, 7 * s, 6 * s, 0, Math.PI * 2)
  x.fillStyle = fitColor(fit, p); x.fill()
  x.lineWidth = 2 * s; x.strokeStyle = p.white; x.stroke()
  x.fillStyle = p.white; x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText(t, w / 2, 13 * s + 1)
  return { width: w, height: h, data: x.getImageData(0, 0, w, h).data }
}

/** Loads an SVG string as an image element. */
export const svgImage = (svg: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const i = new Image(); i.onload = () => resolve(i); i.onerror = reject
  i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
})

/** The three layer swatches for the segmented control. */
export function LayerSwatch({ layer }: { layer: 'main' | 'sub' | 'spec' }) {
  if (layer === 'main') return <svg aria-hidden width="16" height="19" viewBox="0 0 40 48"><path d={TEARDROP} style={{ fill: INK }} /></svg>
  if (layer === 'sub') return <svg aria-hidden width="16" height="16" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" style={{ fill: GREEN }} /></svg>
  return <svg aria-hidden width="20" height="14" viewBox="0 0 30 22"><rect x="1" y="3" width="28" height="13" rx="4" style={{ fill: NAVY }} /><path d="M12 16l3 4 3-4z" style={{ fill: NAVY }} /></svg>
}
