'use client'

import { useEffect, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { DistrictFeature } from '@/lib/insights-api'

const STYLE_URL = 'mapbox://styles/mapbox/light-v11'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
// five steps from low to high; a district without the figure is left unshaded
export const SHADES = ['#e3eed5', '#c4dba8', '#99c070', '#6b923a', '#3e573b']   // Farq olive (--primary) for the highest districts

function boundsOf(features: DistrictFeature[]): [[number, number], [number, number]] | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  const visit = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === 'number') {
      const [x, y] = coords as [number, number]
      west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y)
    } else if (Array.isArray(coords)) coords.forEach(visit)
  }
  features.forEach((feature) => visit(feature.geometry?.coordinates))
  return west < Infinity ? [[west, south], [east, north]] : null
}

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
export type MapPoint = { id: string; lon: number; lat: number }
/** A drawn area (a radius or a drive-time area) and the numbered site it belongs to. */
export type Area = { id: string; color: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }
export type Site = { id: string; label: string; color: string; lon: number; lat: number }
/** A current property listing on the map, coloured by its price against its district. */
export type ListingDot = { id: string; lon: number; lat: number; color: string; /** A short price shown beside the dot when zoomed in. */ label?: string; /** The listing the viewer is pointing at in a list. */ active?: boolean }

export { circlePolygon }

export function LensMapCanvas({ features, steps, selected, onToggle, colors, circle, onPick, points, lines, start, areas, sites, listings, onListing, focus, onBounds }: {
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
  focus?: { lon: number; lat: number } | null
  /** The visible area [west, south, east, north] each time the map settles. */
  onBounds?: ((bounds: [number, number, number, number]) => void) | null
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapboxMap | null>(null)
  const toggle = useRef(onToggle)
  const pick = useRef(onPick)
  const openListing = useRef(onListing)
  const reportBounds = useRef(onBounds)
  reportBounds.current = onBounds
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  toggle.current = onToggle
  pick.current = onPick
  openListing.current = onListing

  useEffect(() => {
    let disposed = false
    ;(async () => {
      const response = await fetch('/api/mapbox-token', { cache: 'no-store' }).catch(() => null)
      const token = response?.ok ? (await response.json()).token : null
      if (!token) { setError('تعذر تحميل الخريطة.'); return }
      const mapboxgl = (await import('mapbox-gl')).default
      if (disposed || !container.current) return
      mapboxgl.accessToken = token
      const instance = new mapboxgl.Map({ container: container.current, style: STYLE_URL, center: [46.68, 24.71], zoom: 9.5 })
      map.current = instance
      instance.on('load', () => {
        // place names on the basemap in Arabic where Mapbox has them
        for (const layer of instance.getStyle().layers ?? []) {
          if (layer.type === 'symbol' && instance.getLayoutProperty(layer.id, 'text-field') != null) {
            instance.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name_ar'], ['get', 'name']])
          }
        }
        instance.addSource('districts', { type: 'geojson', data: EMPTY, promoteId: 'id' })
        // shading and outlines sit under the basemap's place and road names; district names go on top of everything
        const layers = instance.getStyle().layers ?? []
        const firstLabel = layers.find((layer) => layer.type === 'symbol')?.id
        // the shading sits under the streets and the place names, so both stay readable through it
        const firstRoad = layers.find((layer) => layer.type === 'line' && /road|street|bridge|tunnel/.test(layer.id))?.id ?? firstLabel
        instance.addLayer({ id: 'district-fill', type: 'fill', source: 'districts', paint: {
          'fill-color': ['coalesce', ['get', '__color'], ['match', ['coalesce', ['get', '__step'], -1], 0, SHADES[0], 1, SHADES[1], 2, SHADES[2], 3, SHADES[3], 4, SHADES[4], 'rgba(0,0,0,0)']],
          // lighter as the map zooms in to street level
          'fill-opacity': ['interpolate', ['linear'], ['zoom'],
            10, ['case', ['boolean', ['get', '__selected'], false], 0.8, 0.6],
            14, ['case', ['boolean', ['get', '__selected'], false], 0.55, 0.3]],
        } }, firstRoad)
        instance.addLayer({ id: 'district-line', type: 'line', source: 'districts', paint: { 'line-color': '#3e573b', 'line-width': 0.6, 'line-opacity': 0.35 } }, firstLabel)
        instance.addLayer({ id: 'district-selected', type: 'line', source: 'districts', filter: ['==', ['get', '__selected'], true], paint: { 'line-color': '#172a1e', 'line-width': 3 } })
        instance.addLayer({ id: 'district-name', type: 'symbol', source: 'districts', layout: {
          'text-field': ['coalesce', ['get', 'ar'], ['get', 'district_ar'], ''],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 15, 14, 18],
          'text-padding': 2,
        }, paint: { 'text-color': '#172a1e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } })
        instance.addSource('circle', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'circle-fill', type: 'fill', source: 'circle', paint: { 'fill-color': '#3e573b', 'fill-opacity': 0.18 } })
        instance.addLayer({ id: 'circle-line', type: 'line', source: 'circle', paint: { 'line-color': '#3e573b', 'line-width': 2.5 } })
        instance.addSource('areas', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'area-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 } })
        instance.addLayer({ id: 'area-line', type: 'line', source: 'areas', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
        instance.addSource('route', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0d1217', 'line-width': 7 } })
        instance.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3e573b', 'line-width': 4 } })
        instance.addSource('stops', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 6], 'circle-color': '#facc15', 'circle-stroke-color': '#0d1217', 'circle-stroke-width': 1 } })
        instance.addSource('start', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'start', type: 'circle', source: 'start', paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-stroke-color': '#3e573b', 'circle-stroke-width': 4 } })
        instance.addSource('sites', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'site-dot', type: 'circle', source: 'sites', paint: { 'circle-radius': 13, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0d1217', 'circle-stroke-width': 2 } })
        instance.addLayer({ id: 'site-label', type: 'symbol', source: 'sites', layout: { 'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 15, 'text-allow-overlap': true }, paint: { 'text-color': '#0d1217' } })
        // listings: grouped into a numbered circle until zoomed in, so a dense district stays readable
        instance.addSource('listings', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 42, clusterMaxZoom: 15 })
        instance.addLayer({ id: 'listing-cluster', type: 'circle', source: 'listings', filter: ['has', 'point_count'], paint: {
          'circle-color': '#0d1217', 'circle-stroke-color': '#3e573b', 'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 23],
        } })
        instance.addLayer({ id: 'listing-count', type: 'symbol', source: 'listings', filter: ['has', 'point_count'], layout: {
          'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 13, 'text-allow-overlap': true,
        }, paint: { 'text-color': '#ffffff' } })
        instance.addLayer({ id: 'listing-dot', type: 'circle', source: 'listings', filter: ['!', ['has', 'point_count']], paint: {
          'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 9],
          'circle-stroke-color': ['case', ['boolean', ['get', 'active'], false], '#ffffff', '#0d1217'],
          'circle-stroke-width': ['case', ['boolean', ['get', 'active'], false], 3, 1.5],
        } })
        // the price beside each single listing once zoomed in, like a price pin
        instance.addLayer({ id: 'listing-price', type: 'symbol', source: 'listings', minzoom: 12.5, filter: ['all', ['!', ['has', 'point_count']], ['has', 'label']], layout: {
          'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 12, 'text-offset': [0, -1.4], 'text-allow-overlap': false,
          'symbol-sort-key': ['case', ['boolean', ['get', 'active'], false], 0, 1],
        }, paint: { 'text-color': '#0d1217', 'text-halo-color': '#ffffff', 'text-halo-width': 6 } })
        instance.on('moveend', () => {
          const b = instance.getBounds()
          if (b) reportBounds.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
        })
        instance.on('click', (event) => {
          const [listing] = instance.queryRenderedFeatures(event.point, { layers: ['listing-dot'] })
          if (listing && openListing.current) { openListing.current(String(listing.properties?.id)); return }
          const [cluster] = instance.queryRenderedFeatures(event.point, { layers: ['listing-cluster'] })
          if (cluster) { instance.easeTo({ center: (cluster.geometry as GeoJSON.Point).coordinates as [number, number], zoom: instance.getZoom() + 2 }); return }
          if (pick.current) { pick.current({ lon: event.lngLat.lng, lat: event.lngLat.lat }); return }
          const id = instance.queryRenderedFeatures(event.point, { layers: ['district-fill'] })[0]?.properties?.id
          if (id != null) toggle.current(String(id))
        })
        for (const layer of ['listing-dot', 'listing-cluster']) {
          instance.on('mouseenter', layer, () => { instance.getCanvas().style.cursor = 'pointer' })
          instance.on('mouseleave', layer, () => { instance.getCanvas().style.cursor = '' })
        }
        instance.on('mouseenter', 'district-fill', () => { instance.getCanvas().style.cursor = 'pointer' })
        instance.on('mouseleave', 'district-fill', () => { instance.getCanvas().style.cursor = '' })
        setReady(true)
      })
    })()
    return () => { disposed = true; map.current?.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    const chosen = new Set(selected)
    const painted = features.map((feature) => {
      const id = String(feature.properties.id)
      return { ...feature, properties: { ...feature.properties, id, __step: colors ? null : steps.get(id) ?? null, __color: colors?.get(id) ?? null, __selected: chosen.has(id) } }
    })
    ;(instance.getSource('districts') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: painted })
  }, [ready, features, steps, selected, colors])

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
    ;(instance.getSource('stops') as GeoJSONSource | undefined)?.setData(collection((points ?? []).map((point) => ({ type: 'Feature', properties: { id: point.id }, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } }))))
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
    if (ready && focus) map.current?.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.current.getZoom(), 15) })
  }, [ready, focus])

  useEffect(() => {
    const instance = map.current
    const bounds = boundsOf(features)
    if (ready && instance && bounds) instance.fitBounds(bounds, { padding: 24, duration: 0 })
  }, [ready, features])

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      {error && <p className="absolute inset-x-0 top-4 text-center text-sm text-destructive">{error}</p>}
    </div>
  )
}
