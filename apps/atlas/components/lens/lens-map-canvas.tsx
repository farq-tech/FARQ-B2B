'use client'

import { useEffect, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { DistrictFeature } from '@/lib/insights-api'

const STYLE_URL = 'mapbox://styles/mapbox/dark-v11'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
// five steps from low to high; a district without the figure is left unshaded
export const SHADES = ['#2b3f12', '#3f6212', '#65a30d', '#a3e635', '#d9f99d']   // light lime for the highest districts

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
export function LensMapCanvas({ features, steps, selected, onToggle, colors, circle, onPick }: {
  features: DistrictFeature[]
  steps: Map<string, number>
  selected: string[]
  onToggle: (id: string) => void
  colors?: Map<string, string> | null
  circle?: Circle | null
  onPick?: ((point: { lon: number; lat: number }) => void) | null
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapboxMap | null>(null)
  const toggle = useRef(onToggle)
  const pick = useRef(onPick)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  toggle.current = onToggle
  pick.current = onPick

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
        const firstLabel = instance.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
        instance.addLayer({ id: 'district-fill', type: 'fill', source: 'districts', paint: {
          'fill-color': ['coalesce', ['get', '__color'], ['match', ['coalesce', ['get', '__step'], -1], 0, SHADES[0], 1, SHADES[1], 2, SHADES[2], 3, SHADES[3], 4, SHADES[4], 'rgba(0,0,0,0)']],
          'fill-opacity': ['case', ['boolean', ['get', '__selected'], false], 0.85, 0.55],
        } }, firstLabel)
        instance.addLayer({ id: 'district-line', type: 'line', source: 'districts', paint: { 'line-color': '#d9f99d', 'line-width': 0.6, 'line-opacity': 0.45 } }, firstLabel)
        instance.addLayer({ id: 'district-selected', type: 'line', source: 'districts', filter: ['==', ['get', '__selected'], true], paint: { 'line-color': '#ffffff', 'line-width': 3 } })
        instance.addLayer({ id: 'district-name', type: 'symbol', source: 'districts', layout: {
          'text-field': ['coalesce', ['get', 'ar'], ['get', 'district_ar'], ''],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 15, 14, 18],
          'text-padding': 2,
        }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#0d1217', 'text-halo-width': 1.6 } })
        instance.addSource('circle', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'circle-fill', type: 'fill', source: 'circle', paint: { 'fill-color': '#d9f99d', 'fill-opacity': 0.18 } })
        instance.addLayer({ id: 'circle-line', type: 'line', source: 'circle', paint: { 'line-color': '#d9f99d', 'line-width': 2.5 } })
        instance.on('click', (event) => {
          if (pick.current) { pick.current({ lon: event.lngLat.lng, lat: event.lngLat.lat }); return }
          const id = instance.queryRenderedFeatures(event.point, { layers: ['district-fill'] })[0]?.properties?.id
          if (id != null) toggle.current(String(id))
        })
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
