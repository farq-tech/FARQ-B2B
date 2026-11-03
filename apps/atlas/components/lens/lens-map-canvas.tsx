'use client'

import { useEffect, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MapboxMap, StyleSpecification } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { DistrictFeature } from '@/lib/insights-api'
import { LoadError } from '@/components/shared/load-error'
import { cn } from '@/lib/utils'
import { PEEK_PX } from './map-sheet'
import { OLIVE_STEPS, PALETTE } from '@/lib/palette'
import { boundsOf } from './map-bounds'
import { cityFrame, framePadding, sheetCoverPx } from './map-framing'

const STYLE_URL = 'mapbox://styles/mapbox/light-v11'
const STYLE_JSON = 'https://api.mapbox.com/styles/v1/mapbox/light-v11'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
// five steps from low to high; a district without the figure is left unshaded
export const SHADES = OLIVE_STEPS   // Farq olive (--primary) for the highest districts

/** Quantile step (0-4) of each district's value, so every lens reads as five even groups whatever the scale. */
export function shadeSteps(values: Map<string, number | null>): Map<string, number> {
  const known = [...values.values()].filter((value): value is number => value != null).sort((a, b) => a - b)
  const steps = new Map<string, number>()
  if (!known.length) return steps
  values.forEach((value, id) => {
    if (value == null) return
    let below = 0
    while (below < known.length && known[below] < value) below++
    steps.set(id, Math.min(4, Math.floor((5 * below) / known.length)))
  })
  return steps
}

type StyleLayer = { id: string; type: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> }

/**
 * What the Atlas changes on one basemap layer: place names in Arabic where Mapbox has them, and the Atlas palette
 * (warm stone land, soft water, quiet green parks, white streets). Applied to the style before the map draws, so no
 * English name and no default colour ever shows (they flashed for seconds while the map loaded).
 */
function dressLayer(layer: StyleLayer): { layout: Record<string, unknown>; paint: Record<string, unknown> } {
  const layout: Record<string, unknown> = {}
  const paint: Record<string, unknown> = {}
  // only names: road numbers and house numbers keep their own field
  if (layer.type === 'symbol' && layer.layout?.['text-field'] != null && JSON.stringify(layer.layout['text-field']).includes('name')) {
    layout['text-field'] = ['coalesce', ['get', 'name_ar'], ['get', 'name']]
  }
  if (layer.type === 'background') paint['background-color'] = PALETTE.land
  else if (layer.type === 'fill' && /^water/.test(layer.id)) paint['fill-color'] = PALETTE.water
  else if (layer.type === 'fill' && /landuse|park|national-park|landcover/.test(layer.id)) paint['fill-color'] = PALETTE.wash
  else if (layer.type === 'fill' && /building/.test(layer.id)) paint['fill-color'] = PALETTE.pebble
  else if (layer.type === 'line' && /road|street|bridge|tunnel/.test(layer.id)) paint['line-color'] = PALETTE.white
  else if (layer.type === 'symbol') { paint['text-color'] = PALETTE.bark; paint['text-halo-color'] = PALETTE.ground }
  return { layout, paint }
}

/** The basemap style, dressed before it reaches the map; null when it cannot be fetched (the map then dresses it on load). */
async function dressedStyle(token: string): Promise<StyleSpecification | null> {
  const response = await fetch(`${STYLE_JSON}?access_token=${encodeURIComponent(token)}`).catch(() => null)
  const style = response?.ok ? await response.json().catch(() => null) as (StyleSpecification & { layers?: StyleLayer[] }) | null : null
  if (!style || !Array.isArray(style.layers)) return null
  const layers = style.layers.map((layer) => {
    const { layout, paint } = dressLayer(layer)
    return { ...layer, layout: { ...layer.layout, ...layout }, paint: { ...layer.paint, ...paint } }
  })
  return { ...style, layers } as StyleSpecification
}

export type Circle = { lon: number; lat: number; radius_m: number }

/** A ring of points approximating a circle on the ground (good to well under 1% at city scale). */
function circlePolygon({ lon, lat, radius_m }: Circle): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: [number, number][] = []
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI
    ring.push([lon + (radius_m / (111_320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle), lat + (radius_m / 111_320) * Math.sin(angle)])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/**
 * The lens map: districts shaded by the lens metric, selected districts outlined, a click selects or releases a
 * district. A tool can paint districts in its own colours (`colors`, e.g. sales territories), draw a search
 * circle, and take clicks as points instead (`onPick`). The token comes from /api/mapbox-token like every Atlas map.
 */
export type MapPoint = { id: string; lon: number; lat: number; /** Its own colour, such as the day of a rep's week; ochre when absent. */ color?: string }
/** A drawn area (a radius or a drive-time area) and the numbered site it belongs to. */
export type Area = { id: string; color: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }
export type Site = { id: string; label: string; color: string; lon: number; lat: number }
/** A group of close businesses as a click on it gives it: its first GROUP_NAMES by id, how many, where, and a zoom that splits it. */
export type BusinessGroup = { ids: string[]; count: number; lon: number; lat: number; expand: () => void }
/** How many of a group's businesses its card names. */
export const GROUP_NAMES = 8

/** A business a list shows on the map: named beside its dot, lit while its row is pointed at, olive once it is in the request. */
export type BusinessDot = { id: string; lon: number; lat: number; name: string; active?: boolean; inRequest?: boolean }

/** A current property listing on the map, coloured by its price against its district. */
/** A trade corridor: a run of one street lined with one activity, drawn along the street itself. */
export type StreetLine = { id: string; color: string; geometry: GeoJSON.LineString | GeoJSON.MultiLineString; /** The street's name, written along it when zoomed in. */ label: string; /** The corridor the viewer picked: drawn thicker, and the map frames it. */ active?: boolean }
export type ListingDot = { id: string; lon: number; lat: number; color: string; /** A short price shown beside the dot when zoomed in. */ label?: string; /** The listing the viewer is pointing at in a list. */ active?: boolean }

export { circlePolygon }

export function LensMapCanvas({ features, steps, selected, onToggle, colors, circle, onPick, points, lines, start, areas, sites, listings, onListing, businesses, onBusiness, onBusinessHover, onBusinessGroup, streets, onStreet, focus, zoomTo, onBounds, onFailed, errorClassName, hover, onPoint, cover = 0, peek = PEEK_PX, onDistrictClick, pin, onPin }: {
  features: DistrictFeature[]
  steps: Map<string, number>
  selected: string[]
  onToggle: (id: string) => void
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
  /** The businesses a list shows, each named beside its dot once zoomed in; a click opens it, a hover lights its row. */
  businesses?: BusinessDot[] | null
  onBusiness?: ((id: string) => void) | null
  onBusinessHover?: ((id: string | null) => void) | null
  /** A group of businesses was clicked: the first of them by id, how many it holds, where it is, and its way to come apart. */
  onBusinessGroup?: ((group: BusinessGroup) => void) | null
  streets?: StreetLine[] | null
  onStreet?: ((id: string) => void) | null
  focus?: { lon: number; lat: number } | null
  /** Districts picked from a list or named by a link: the map frames them. `cover` is the share of the screen a phone's
   * sheet covers below the map's own peek, so they land in the part still visible; `nonce` repeats a pick of the same. */
  zoomTo?: { ids: string[]; nonce: number; cover: number } | null
  /** The visible area [west, south, east, north] each time the map settles. */
  onBounds?: ((bounds: [number, number, number, number]) => void) | null
  /** Told when the map fails to open and when a retry brings it back, so the page can clear what would sit over the notice. */
  onFailed?: (failed: boolean) => void
  /** Where the failure notice sits, when the page keeps other things at the map's top. */
  errorClassName?: string
  /** A district a list is pointing at (a row under the pointer or focus), outlined on the map without picking it. */
  hover?: string | null
  /** The district under a mouse pointer and where it is on the map (pixels from the map's corner), or null when it
   * leaves the districts. Mouse only: a tap picks the district instead. */
  onPoint?: ((point: { id: string; x: number; y: number; width: number; height: number } | null) => void) | null
  /** The share of the screen a phone's sheet covers now (0 while it peeks), kept clear when the map frames the city. */
  cover?: number
  /** The phone sheet's collapsed height as it measures (the map ends above it). */
  peek?: number
  /** A click on a district, and where on the ground it landed, told before the district is picked or released. */
  onDistrictClick?: ((hit: { id: string; lon: number; lat: number }) => void) | null
  /** A place a card is pinned to: the map tells where it is on screen (`onPin`) each time the map moves. */
  pin?: { lon: number; lat: number } | null
  onPin?: ((point: { x: number; y: number; width: number; height: number } | null) => void) | null
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapboxMap | null>(null)
  const toggle = useRef(onToggle)
  const pick = useRef(onPick)
  const openListing = useRef(onListing)
  const openStreet = useRef(onStreet)
  openStreet.current = onStreet
  const openBusiness = useRef(onBusiness)
  openBusiness.current = onBusiness
  const hoverBusiness = useRef(onBusinessHover)
  hoverBusiness.current = onBusinessHover
  const openGroup = useRef(onBusinessGroup)
  openGroup.current = onBusinessGroup
  const point = useRef(onPoint)
  point.current = onPoint
  const reportBounds = useRef(onBounds)
  reportBounds.current = onBounds
  const districtClick = useRef(onDistrictClick)
  districtClick.current = onDistrictClick
  const reportPin = useRef(onPin)
  reportPin.current = onPin
  const sheetCover = useRef(cover)
  sheetCover.current = cover
  // what the person can see of the map: on a phone the half sheet hides its foot, so a list that follows the map
  // keeps only what is above the sheet (west, south, east, north)
  const reportVisible = useRef(() => {})
  reportVisible.current = () => {
    const instance = map.current
    if (!instance || !reportBounds.current) return
    const box = instance.getContainer()
    const hidden = sheetCoverPx({ height: box.clientHeight, phone: !window.matchMedia('(min-width: 64rem)').matches, cover: sheetCover.current, peek: sheetPeek.current })
    const southWest = instance.unproject([0, Math.max(1, box.clientHeight - hidden)])
    const northEast = instance.unproject([box.clientWidth, 0])
    reportBounds.current([southWest.lng, southWest.lat, northEast.lng, northEast.lat])
  }
  const sheetPeek = useRef(peek)
  sheetPeek.current = peek
  // the first city framing is instant (nothing is on screen yet); a city changed later is flown to
  const framed = useRef(false)
  const [ready, setReady] = useState(false)
  // the sheet rising or falling changes what is seen without the map moving
  useEffect(() => { if (ready) reportVisible.current() }, [ready, cover])
  // the map focused from the keyboard, and the district under its centre (the keyboard's pick)
  const [keyed, setKeyed] = useState(false)
  const [centre, setCentre] = useState<string | null>(null)
  const [error, setError] = useState('')
  // why the map did not open, in words that point the visitor the right way: a dropped connection is theirs to fix;
  // a map the server cannot serve right now is not, and the panel's figures still work either way
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined)
  // a retry opens the map again in place, so the lens, the step and the picked districts stay as they were
  const [attempt, setAttempt] = useState(0)
  const failed = useRef(onFailed)
  failed.current = onFailed
  useEffect(() => { failed.current?.(error !== '') }, [error])
  toggle.current = onToggle
  pick.current = onPick
  openListing.current = onListing

  useEffect(() => {
    let disposed = false
    ;(async () => {
      // the three things the map waits for are asked together, not one after another: the map library (the largest
      // file on the page) loads while the token is asked, and the style is asked as soon as the token is in
      const library = import('mapbox-gl').then((module) => module.default).catch(() => null)
      const asked = fetch('/api/mapbox-token', { cache: 'no-store' }).catch(() => null)
      const tokenOf = asked.then((response) => (response?.ok ? response.json().then((body) => body.token as string | undefined).catch(() => null) : null))
      const styled = tokenOf.then((token) => (token ? dressedStyle(token) : null))
      const response = await asked
      const token = await tokenOf
      if (disposed) return
      if (!token) {
        setErrorDetail(response ? 'الخريطة غير متاحة الآن من جهتنا، والأرقام والقوائم في اللوحة تعمل. أعد المحاولة بعد قليل.' : 'تحقق من الاتصال ثم أعد المحاولة. الأرقام في اللوحة تبقى كما هي.')
        setError('الخريطة'); return
      }
      const mapboxgl = await library
      if (disposed || !container.current) return
      if (!mapboxgl) { setErrorDetail(undefined); setError('الخريطة'); return }
      mapboxgl.accessToken = token
      const style = await styled
      if (disposed || !container.current) return
      const instance = new mapboxgl.Map({ container: container.current, style: style ?? STYLE_URL, center: [46.68, 24.71], zoom: 9.5 })
      map.current = instance
      // a map drawn while its box was hidden or smaller (the phone's list view, a sheet) keeps that size until told:
      // follow the box, so showing it fills the screen
      const watch = new ResizeObserver(() => instance.resize())
      watch.observe(container.current)
      instance.once('remove', () => watch.disconnect())
      // the style could not be fetched dressed: dress it as soon as it is parsed, before its tiles draw
      if (!style) instance.once('style.load', () => {
        for (const layer of (instance.getStyle()?.layers ?? []) as StyleLayer[]) {
          const { layout, paint } = dressLayer(layer)
          if (layout['text-field']) instance.setLayoutProperty(layer.id, 'text-field', layout['text-field'] as ['coalesce', ...unknown[]])
          for (const [property, value] of Object.entries(paint)) { try { instance.setPaintProperty(layer.id, property as 'fill-color', value as string) } catch { /* not this layer's property */ } }
        }
      })
      instance.on('load', () => {
        instance.addSource('districts', { type: 'geojson', data: EMPTY, promoteId: 'id' })
        // shading and outlines sit under the basemap's place and road names; district names go on top of everything
        const layers = instance.getStyle().layers ?? []
        const firstLabel = layers.find((layer) => layer.type === 'symbol')?.id
        // the shading sits under the streets and the place names, so both stay readable through it
        const firstRoad = layers.find((layer) => layer.type === 'line' && /road|street|bridge|tunnel/.test(layer.id))?.id ?? firstLabel
        const fillColor = ['coalesce', ['get', '__color'], ['match', ['coalesce', ['get', '__step'], -1], 0, SHADES[0], 1, SHADES[1], 2, SHADES[2], 3, SHADES[3], 4, SHADES[4], 'rgba(0,0,0,0)']] as unknown as string
        // lighter as the map zooms in to street level
        instance.addLayer({ id: 'district-fill', type: 'fill', source: 'districts', paint: { 'fill-color': fillColor, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 0.3] } }, firstRoad)
        // the picked districts: the same colour once more over them (0.6 → 0.8 at city scale, 0.3 → 0.55 in the
        // streets), shown by a filter on their ids, so a pick never sends every outline to the map again
        instance.addLayer({ id: 'district-picked', type: 'fill', source: 'districts', filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'fill-color': fillColor, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 0.36] } }, firstRoad)
        instance.addLayer({ id: 'district-line', type: 'line', source: 'districts', paint: { 'line-color': PALETTE.olive, 'line-width': 0.6, 'line-opacity': 0.35 } }, firstLabel)
        instance.addLayer({ id: 'district-selected', type: 'line', source: 'districts', filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'line-color': PALETTE.ink, 'line-width': 3 } })
        instance.addLayer({ id: 'district-hover', type: 'line', source: 'districts', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': PALETTE.ink, 'line-width': 2, 'line-dasharray': [2, 1] } })
        instance.addLayer({ id: 'district-name', type: 'symbol', source: 'districts', layout: {
          'text-field': ['coalesce', ['get', 'ar'], ['get', 'district_ar'], ''],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 15, 14, 18],
          'text-padding': 2,
        }, paint: { 'text-color': PALETTE.ink, 'text-halo-color': PALETTE.white, 'text-halo-width': 1.6 } })
        instance.addSource('circle', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'circle-fill', type: 'fill', source: 'circle', paint: { 'fill-color': PALETTE.olive, 'fill-opacity': 0.14 } })
        instance.addLayer({ id: 'circle-line', type: 'line', source: 'circle', paint: { 'line-color': PALETTE.olive, 'line-width': 2.5 } })
        instance.addSource('areas', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'area-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 } })
        instance.addLayer({ id: 'area-line', type: 'line', source: 'areas', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
        instance.addSource('route', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': PALETTE.white, 'line-width': 7 } })
        instance.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': PALETTE.olive, 'line-width': 4 } })
        instance.addSource('streets', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'street-casing', type: 'line', source: 'streets', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
          'line-color': PALETTE.white, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['boolean', ['get', 'active'], false], 8, 5], 15, ['case', ['boolean', ['get', 'active'], false], 15, 10]],
        } })
        instance.addLayer({ id: 'street-line', type: 'line', source: 'streets', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
          'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['boolean', ['get', 'active'], false], 5, 3], 15, ['case', ['boolean', ['get', 'active'], false], 10, 6]],
        } })
        instance.addLayer({ id: 'street-name', type: 'symbol', source: 'streets', minzoom: 13, layout: {
          'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 13,
        }, paint: { 'text-color': PALETTE.ink, 'text-halo-color': PALETTE.white, 'text-halo-width': 2 } })
        instance.addSource('stops', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 6], 'circle-color': ['coalesce', ['get', 'color'], PALETTE.ochre], 'circle-stroke-color': PALETTE.white, 'circle-stroke-width': 1 } })
        instance.addSource('start', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'start', type: 'circle', source: 'start', paint: { 'circle-radius': 9, 'circle-color': PALETTE.white, 'circle-stroke-color': PALETTE.olive, 'circle-stroke-width': 4 } })
        instance.addSource('sites', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'site-dot', type: 'circle', source: 'sites', paint: { 'circle-radius': 13, 'circle-color': ['get', 'color'], 'circle-stroke-color': PALETTE.white, 'circle-stroke-width': 2 } })
        instance.addLayer({ id: 'site-label', type: 'symbol', source: 'sites', layout: { 'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 15, 'text-allow-overlap': true }, paint: { 'text-color': PALETTE.white } })
        // listings: grouped into a numbered circle until zoomed in, so a dense district stays readable
        instance.addSource('listings', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 42, clusterMaxZoom: 15 })
        instance.addLayer({ id: 'listing-cluster', type: 'circle', source: 'listings', filter: ['has', 'point_count'], paint: {
          'circle-color': PALETTE.olive, 'circle-stroke-color': PALETTE.white, 'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 23],
        } })
        instance.addLayer({ id: 'listing-count', type: 'symbol', source: 'listings', filter: ['has', 'point_count'], layout: {
          'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 13, 'text-allow-overlap': true,
        }, paint: { 'text-color': PALETTE.white } })
        instance.addLayer({ id: 'listing-dot', type: 'circle', source: 'listings', filter: ['!', ['has', 'point_count']], paint: {
          'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 9],
          'circle-stroke-color': ['case', ['boolean', ['get', 'active'], false], PALETTE.ink, PALETTE.white],
          'circle-stroke-width': ['case', ['boolean', ['get', 'active'], false], 3, 1.5],
        } })
        // the price beside each single listing once zoomed in, like a price pin
        instance.addLayer({ id: 'listing-price', type: 'symbol', source: 'listings', minzoom: 12.5, filter: ['all', ['!', ['has', 'point_count']], ['has', 'label']], layout: {
          'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 12, 'text-offset': [0, -1.4], 'text-allow-overlap': false,
          'symbol-sort-key': ['case', ['boolean', ['get', 'active'], false], 0, 1],
        }, paint: { 'text-color': PALETTE.ink, 'text-halo-color': PALETTE.white, 'text-halo-width': 6 } })
        // a list's businesses: close ones grouped into a numbered circle until zoomed in (olive when one is in the request
        // being built, ringed when the row under the pointer is inside), then a dot each, its name beside it
        instance.addSource('businesses', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 36, clusterMaxZoom: 15,
          clusterProperties: { inRequest: ['max', ['case', ['boolean', ['get', 'inRequest'], false], 1, 0]], active: ['max', ['case', ['boolean', ['get', 'active'], false], 1, 0]] } })
        instance.addLayer({ id: 'business-cluster', type: 'circle', source: 'businesses', filter: ['has', 'point_count'], paint: {
          'circle-color': ['case', ['>', ['get', 'inRequest'], 0], PALETTE.olive, PALETTE.ochre],
          'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 50, 22],
          'circle-stroke-color': ['case', ['>', ['get', 'active'], 0], PALETTE.ink, PALETTE.white],
          'circle-stroke-width': ['case', ['>', ['get', 'active'], 0], 3, 2],
        } })
        instance.addLayer({ id: 'business-count', type: 'symbol', source: 'businesses', filter: ['has', 'point_count'], layout: {
          'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 12, 'text-allow-overlap': true,
        }, paint: { 'text-color': PALETTE.white } })
        instance.addLayer({ id: 'business-dot', type: 'circle', source: 'businesses', filter: ['!', ['has', 'point_count']], paint: {
          'circle-color': ['case', ['boolean', ['get', 'inRequest'], false], PALETTE.olive, PALETTE.ochre],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['boolean', ['get', 'active'], false], 7, 4.5], 16, ['case', ['boolean', ['get', 'active'], false], 11, 8]],
          'circle-stroke-color': ['case', ['boolean', ['get', 'active'], false], PALETTE.ink, PALETTE.white],
          'circle-stroke-width': ['case', ['boolean', ['get', 'active'], false], 3, 1.5],
        } })
        instance.addLayer({ id: 'business-name', type: 'symbol', source: 'businesses', minzoom: 13, filter: ['!', ['has', 'point_count']], layout: {
          'text-field': ['get', 'name'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 12, 'text-offset': [0, -1.3], 'text-anchor': 'bottom',
          'text-max-width': 10, 'text-allow-overlap': false, 'symbol-sort-key': ['case', ['boolean', ['get', 'active'], false], 0, 1],
        }, paint: { 'text-color': PALETTE.ink, 'text-halo-color': PALETTE.white, 'text-halo-width': 2 } })
        instance.on('mousemove', 'business-dot', (event) => { const id = event.features?.[0]?.properties?.id; hoverBusiness.current?.(id == null ? null : String(id)) })
        instance.on('mouseleave', 'business-dot', () => hoverBusiness.current?.(null))
        instance.on('moveend', () => reportVisible.current())
        instance.on('click', (event) => {
          const [business] = instance.queryRenderedFeatures(event.point, { layers: ['business-dot'] })
          if (business && openBusiness.current) { openBusiness.current(String(business.properties?.id)); return }
          const [group] = instance.queryRenderedFeatures(event.point, { layers: ['business-cluster'] })
          if (group) {
            // a group of businesses opens at the zoom where it comes apart
            const source = instance.getSource('businesses') as GeoJSONSource
            const centre = (group.geometry as GeoJSON.Point).coordinates as [number, number]
            const clusterId = Number(group.properties?.cluster_id)
            const expand = () => source.getClusterExpansionZoom(clusterId, (error, zoom) => instance.easeTo({ center: centre, zoom: error || zoom == null ? instance.getZoom() + 2 : zoom + 0.5 }))
            // with a card for groups, the group names its businesses first; without one it comes apart at once
            if (!openGroup.current) { expand(); return }
            const count = Number(group.properties?.point_count) || 0
            source.getClusterLeaves(clusterId, GROUP_NAMES, 0, (error, leaves) => {
              const ids = error || !leaves ? [] : leaves.map((leaf) => String(leaf.properties?.id))
              openGroup.current?.({ ids, count, lon: centre[0], lat: centre[1], expand })
            })
            return
          }
          const [listing] = instance.queryRenderedFeatures(event.point, { layers: ['listing-dot'] })
          if (listing && openListing.current) { openListing.current(String(listing.properties?.id)); return }
          const [cluster] = instance.queryRenderedFeatures(event.point, { layers: ['listing-cluster'] })
          const [street] = instance.queryRenderedFeatures(event.point, { layers: ['street-line'] })
          if (street && openStreet.current) { openStreet.current(String(street.properties?.id)); return }
          if (cluster) { instance.easeTo({ center: (cluster.geometry as GeoJSON.Point).coordinates as [number, number], zoom: instance.getZoom() + 2 }); return }
          if (pick.current) { pick.current({ lon: event.lngLat.lng, lat: event.lngLat.lat }); return }
          const id = instance.queryRenderedFeatures(event.point, { layers: ['district-fill'] })[0]?.properties?.id
          if (id == null) return
          districtClick.current?.({ id: String(id), lon: event.lngLat.lng, lat: event.lngLat.lat })
          toggle.current(String(id))
        })
        for (const layer of ['listing-dot', 'listing-cluster', 'street-line', 'business-dot', 'business-cluster']) {
          instance.on('mouseenter', layer, () => { instance.getCanvas().style.cursor = 'pointer' })
          instance.on('mouseleave', layer, () => { instance.getCanvas().style.cursor = '' })
        }
        instance.on('mouseenter', 'district-fill', () => { instance.getCanvas().style.cursor = 'pointer' })
        instance.on('mouseleave', 'district-fill', () => { instance.getCanvas().style.cursor = ''; point.current?.(null) })
        instance.on('mousemove', 'district-fill', (event) => {
          const id = event.features?.[0]?.properties?.id
          point.current?.(id == null ? null : { id: String(id), x: event.point.x, y: event.point.y, width: instance.getContainer().clientWidth, height: instance.getContainer().clientHeight })
        })
        // the keyboard's way in: with the map focused, the arrow keys pan it (the map's own keys), the district under
        // the centre is named, and Enter or Space picks it as a click there would
        const canvas = instance.getCanvas()
        // the map names itself in Arabic, with its keys (it said «Map»)
        canvas.setAttribute('aria-label', 'الخريطة: حرّكها بالأسهم، واضغط Enter لاختيار الحي في وسطها')
        const nameAtCentre = () => {
          const box = instance.getContainer()
          const hit = instance.queryRenderedFeatures([box.clientWidth / 2, box.clientHeight / 2], { layers: ['district-fill'] })[0]
          const props = hit?.properties as { ar?: string; district_ar?: string } | undefined
          setCentre(props ? props.ar || props.district_ar || null : null)
        }
        canvas.addEventListener('focus', () => { if (canvas.matches(':focus-visible')) { setKeyed(true); nameAtCentre() } })
        canvas.addEventListener('blur', () => setKeyed(false))
        instance.on('moveend', () => { if (document.activeElement === canvas) nameAtCentre() })
        canvas.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setKeyed(true)
          const box = instance.getContainer()
          const at: [number, number] = [box.clientWidth / 2, box.clientHeight / 2]
          const ground = instance.unproject(at)
          if (pick.current) { pick.current({ lon: ground.lng, lat: ground.lat }); return }
          const id = instance.queryRenderedFeatures(at, { layers: ['district-fill'] })[0]?.properties?.id
          if (id == null) return
          districtClick.current?.({ id: String(id), lon: ground.lng, lat: ground.lat })
          toggle.current(String(id))
        })
        setReady(true)
      })
    })()
    return () => { disposed = true; map.current?.remove(); map.current = null }
  }, [attempt])
  const retry = () => { setError(''); setReady(false); setAttempt((count) => count + 1) }

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    const painted = features.map((feature) => {
      const id = String(feature.properties.id)
      return { ...feature, properties: { ...feature.properties, id, __step: colors ? null : steps.get(id) ?? null, __color: colors?.get(id) ?? null } }
    })
    ;(instance.getSource('districts') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: painted })
  }, [ready, features, steps, colors])

  // the picked districts as a filter on their ids (a pick used to send every outline, 0.5 MB in Riyadh, to the map
  // again), keyed by the ids: the array itself is new on every pick
  const selectedKey = selected.join(',')
  useEffect(() => {
    const instance = map.current
    if (!ready || !instance?.getLayer('district-selected')) return
    const filter = ['in', ['get', 'id'], ['literal', selectedKey ? selectedKey.split(',') : []]] as Parameters<MapboxMap['setFilter']>[1]
    instance.setFilter('district-selected', filter)
    instance.setFilter('district-picked', filter)
  }, [ready, selectedKey])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance?.getLayer('district-hover')) return
    instance.setFilter('district-hover', ['==', ['get', 'id'], hover ?? ''])
  }, [ready, hover])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource('circle') as GeoJSONSource | undefined)?.setData(circle ? { type: 'FeatureCollection', features: [circlePolygon(circle)] } : EMPTY)
    instance.getCanvas().style.cursor = onPick ? 'crosshair' : ''
  }, [ready, circle, onPick])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    const collection = (items: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: items })
    ;(instance.getSource('stops') as GeoJSONSource | undefined)?.setData(collection((points ?? []).map((point) => ({ type: 'Feature', properties: { id: point.id, ...(point.color ? { color: point.color } : {}) }, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } }))))
    ;(instance.getSource('route') as GeoJSONSource | undefined)?.setData(collection((lines ?? []).map((line) => ({ type: 'Feature', properties: {}, geometry: line }))))
    ;(instance.getSource('start') as GeoJSONSource | undefined)?.setData(collection(start ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [start.lon, start.lat] } }] : []))
  }, [ready, points, lines, start])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource('areas') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: (areas ?? []).map((area) => ({ type: 'Feature', properties: { id: area.id, color: area.color }, geometry: area.geometry })) })
    ;(instance.getSource('sites') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: (sites ?? []).map((site) => ({ type: 'Feature', properties: { id: site.id, label: site.label, color: site.color }, geometry: { type: 'Point', coordinates: [site.lon, site.lat] } })) })
  }, [ready, areas, sites])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource('listings') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: (listings ?? []).map((dot) => ({ type: 'Feature', properties: { id: dot.id, color: dot.color, ...(dot.label ? { label: dot.label } : {}), active: !!dot.active }, geometry: { type: 'Point', coordinates: [dot.lon, dot.lat] } })) })
  }, [ready, listings])

  useEffect(() => {
    if (!ready) return
    ;(map.current?.getSource('businesses') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: (businesses ?? []).map((dot) => ({ type: 'Feature', properties: { id: dot.id, name: dot.name, active: !!dot.active, inRequest: !!dot.inRequest }, geometry: { type: 'Point', coordinates: [dot.lon, dot.lat] } })) })
  }, [ready, businesses])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource('streets') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: (streets ?? []).map((street) => ({ type: 'Feature', properties: { id: street.id, color: street.color, label: street.label, active: !!street.active }, geometry: street.geometry })) })
    // the picked corridor is framed whole, however long it runs
    const active = streets?.find((street) => street.active)
    const bounds = active ? boundsOf([{ geometry: active.geometry }]) : null
    if (bounds) instance.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 800 })
  }, [ready, streets])

  useEffect(() => {
    if (ready && focus) map.current?.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.current.getZoom(), 15) })
  }, [ready, focus])

  // the city's districts fill the part of the map in view, leaving out the few far from the city (map-framing.ts)
  useEffect(() => {
    const instance = map.current
    const bounds = cityFrame(features)
    if (!ready || !instance || !bounds) return
    const box = instance.getContainer()
    const phone = !window.matchMedia('(min-width: 64rem)').matches
    const padding = framePadding({ height: box.clientHeight, width: box.clientWidth, phone, cover: sheetCover.current, peek: sheetPeek.current })
    instance.fitBounds(bounds, { padding, maxZoom: 13, duration: framed.current ? 800 : 0 })
    framed.current = true
  }, [ready, features])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance || !pin) { reportPin.current?.(null); return }
    const report = () => {
      const at = instance.project([pin.lon, pin.lat])
      const box = instance.getContainer()
      reportPin.current?.({ x: at.x, y: at.y, width: box.clientWidth, height: box.clientHeight })
    }
    report()
    instance.on('move', report)
    instance.on('resize', report)
    return () => { instance.off('move', report); instance.off('resize', report) }
  }, [ready, pin])

  useEffect(() => {
    const instance = map.current
    const wanted = new Set(zoomTo?.ids ?? [])
    const picked = features.filter((item) => wanted.has(String(item.properties.id)))
    const bounds = picked.length ? boundsOf(picked) : null
    if (!ready || !instance || !bounds || !zoomTo) return
    const box = instance.getContainer()
    // the sheet covers `cover` of the whole screen, of which the map already ends above the peek
    const padding = framePadding({ height: box.clientHeight, width: box.clientWidth, phone: zoomTo.cover > 0 || !window.matchMedia('(min-width: 64rem)').matches, cover: zoomTo.cover, peek: sheetPeek.current })
    instance.fitBounds(bounds, { padding, maxZoom: 15, duration: 900 })
    // runs after the city framing above, so a pick made while the map loads still lands once it is ready;
    // features stay out of the dependencies: a repaint of the same city never moves the camera again
  }, [ready, zoomTo])

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      {keyed && ready && (
        <div className="pointer-events-none absolute inset-0 z-[3] grid place-items-center" aria-hidden>
          <span className="relative grid size-7 place-items-center">
            <span className="absolute h-7 w-0.5 rounded bg-foreground/80" />
            <span className="absolute h-0.5 w-7 rounded bg-foreground/80" />
            {/* under the cross: a picked district's card opens above the point picked */}
            <span className="absolute top-9 rounded-full border bg-card/95 px-2.5 py-1 text-sm font-semibold whitespace-nowrap shadow-sm">
              {onPick ? 'Enter: ضع النقطة هنا' : centre ? `${centre} · Enter للاختيار` : 'حرّك الخريطة بالأسهم إلى حي'}
            </span>
          </span>
        </div>
      )}
      <p aria-live="polite" className="sr-only">{keyed ? (onPick ? 'اضغط Enter لوضع النقطة في وسط الخريطة.' : centre ? `في الوسط: ${centre}. اضغط Enter لاختياره، والأسهم لتحريك الخريطة.` : 'لا حي في وسط الخريطة. حرّكها بالأسهم.') : ''}</p>
      {/* a light veil while the basemap opens, in place of a half-drawn map */}
      {!ready && !error && (
        <div role="status" className="absolute inset-0 z-[4] grid place-items-center bg-muted/70">
          <span className="animate-pulse rounded-full border bg-card/95 px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">جارٍ تحميل الخريطة</span>
        </div>
      )}
      {error && <LoadError what={error} detail={errorDetail} onRetry={retry} className={cn('absolute inset-x-4 top-4 z-[15] mx-auto max-w-sm bg-card/95 backdrop-blur', errorClassName)} />}
    </div>
  )
}
