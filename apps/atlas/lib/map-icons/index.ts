import { MAP_ICONS } from './icons.data.ts'
import { MAINS, SUBS } from './taxonomy.data.ts'

export type MapIconMatch = {
  /** Tabler glyph name carried by the established Farq map taxonomy. */
  icon: string
  /** Which taxonomy label was actually matched, for diagnostics and tests. */
  matched: 'specialty' | 'subcategory' | 'category' | 'fallback'
}

const FALLBACK_ICON = 'map-pin'

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/[\s\-_./()،]+/g, ' ')
    .replace(/\s+/g, ' ')
}

const subByLabel = new Map<string, string>()
const mainByLabel = new Map<string, string>()
for (const [key, [label, icon]] of Object.entries(SUBS)) {
  subByLabel.set(normalize(key), icon)
  subByLabel.set(normalize(label), icon)
}
for (const [key, [label, icon]] of Object.entries(MAINS)) {
  mainByLabel.set(normalize(key), icon)
  mainByLabel.set(normalize(label), icon)
}

function usableIcon(icon: string | undefined) {
  return icon && MAP_ICONS[icon] ? icon : FALLBACK_ICON
}

/**
 * Resolves a point icon using Farq's existing commercial taxonomy. Specialty
 * wins over a subcategory, which wins over the broad activity. Unknown records
 * intentionally retain a neutral pin instead of guessing their activity.
 */
export function resolveMapIcon(input: { category?: string | null; specialties?: readonly string[] | null }): MapIconMatch {
  for (const specialty of input.specialties ?? []) {
    const icon = subByLabel.get(normalize(specialty))
    if (icon) return { icon: usableIcon(icon), matched: 'specialty' }
  }

  const category = normalize(input.category ?? '')
  const sub = subByLabel.get(category)
  if (sub) return { icon: usableIcon(sub), matched: 'subcategory' }
  const main = mainByLabel.get(category)
  if (main) return { icon: usableIcon(main), matched: 'category' }
  return { icon: FALLBACK_ICON, matched: 'fallback' }
}

const TEARDROP = 'M20 47c-1.2 0-2-.9-2.6-1.8L11 35.6A17 17 0 1 1 29 35.6l-6.4 9.6c-.6.9-1.4 1.8-2.6 1.8z'

/** Branded, self-contained SVG marker used by Mapbox for live directory pins. */
export function mapPinSvg(icon: string, selected = false) {
  const body = MAP_ICONS[icon] ?? MAP_ICONS[FALLBACK_ICON]
  const border = selected ? '#008060' : '#ffffff'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="${TEARDROP}" fill="#303030" stroke="${border}" stroke-width="${selected ? 3 : 2}"/><g transform="translate(9 7) scale(.92)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`
}

export function mapIconImageId(icon: string, selected = false) {
  return `farq-atlas-${selected ? 'selected-' : ''}${usableIcon(icon)}`
}

export function svgToImage(svg: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}
