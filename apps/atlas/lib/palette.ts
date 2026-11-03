/**
 * The one Atlas palette for everything drawn in code (the map, its polygons, pins and tool colours). The page
 * tokens in app/globals.css carry the same values, so a button, a district and a listing dot read as one design:
 * Farq's olive brand over a warm stone ground.
 */
export const PALETTE = {
  ink: '#172a1e',
  olive: '#3e573b',
  moss: '#5c7318',
  leaf: '#6b923a',
  sage: '#99c070',
  apple: '#a3b80f',
  mist: '#c4dba8',
  wash: '#e3eed5',
  ground: '#f7f5f1',
  land: '#efebe4',
  water: '#d8e2df',
  sand: '#e2cfa8',
  stone: '#9c8f7b',
  pebble: '#cfc6b8',
  bark: '#5b5248',
  ochre: '#c48a0a',
  clay: '#b5643c',
  slate: '#6f8796',
  plum: '#8a6f9e',
  fern: '#496b56',
  pine: '#77864c',
  umber: '#a35d36',
  honey: '#af7a2e',
  river: '#496b85',
  indigo: '#586b8c',
  rosewood: '#8a596a',
  berry: '#7b5c83',
  eucalyptus: '#667b72',
  walnut: '#75634f',
  cypress: '#7b7a3d',
  red: '#b3261e',
  white: '#ffffff',
} as const

/** Five steps of the brand olive, lowest to highest: district shading. */
export const OLIVE_STEPS = [PALETTE.wash, PALETTE.mist, PALETTE.sage, PALETTE.leaf, PALETTE.olive]
/** Five steps of ochre, fewest to most: competition heat. */
export const OCHRE_STEPS = ['#f7ecd6', '#efd6a3', '#e2b766', '#c48a0a', '#8f6304']
/** Distinct but quiet colours for areas drawn side by side (sales territories, compared sites). */
export const CATEGORICAL = [
  PALETTE.olive, PALETTE.ochre, PALETTE.slate, PALETTE.clay, PALETTE.plum, PALETTE.sage,
  '#b39a6b', '#4f7f78', '#a8606b', PALETTE.stone, PALETTE.moss, '#3f5571',
  PALETTE.fern, PALETTE.pine, PALETTE.umber, PALETTE.honey, PALETTE.river, PALETTE.indigo,
  PALETTE.rosewood, PALETTE.berry, PALETTE.eucalyptus, PALETTE.walnut, PALETTE.cypress,
]

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/**
 * The text colour to write on a filled colour (a site's header, a numbered disc): white or the brand ink, whichever
 * contrasts more. Anything that is not #rrggbb gets white, the old default.
 */
export function readableOn(background: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(background)) return PALETTE.white
  const l = luminance(background)
  const onWhite = 1.05 / (l + 0.05)
  const onInk = (l + 0.05) / (luminance(PALETTE.ink) + 0.05)
  return onWhite >= onInk ? PALETTE.white : PALETTE.ink
}
