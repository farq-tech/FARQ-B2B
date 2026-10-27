'use client'

import { useEffect, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { DistrictFeature } from '@/lib/insights-api'

const STYLE_URL = 'mapbox://styles/mapbox/dark-v11'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

type Circle = { lon: number; lat: number; radius_m: number }

/** A ring of points approximating a circle on the ground (good to well under 1% at city scale). */
function circlePolygon({ lon, lat, radius_m }: Circle): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: [number, number][] = []
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI
    const dLat = (radius_m / 111_320) * Math.sin(angle)
    const dLon = (radius_m / (111_320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle)
    ring.push([lon + dLon, lat + dLat])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

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

/**
 * Dark Mapbox map of a city's districts. `colors` paints districts by id; `circle` draws a search radius;
 * `onPick` receives a clicked point. The token comes from /api/mapbox-token like the main map.
 */
export function InsightMap({ districts, colors, circle, onPick, className }: {
  districts: DistrictFeature[]
  colors?: Record<string, string>
  circle?: Circle | null
  onPick?: (point: { lon: number; lat: number }) => void
  className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapboxMap | null>(null)
  const pick = useRef(onPick)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  pick.current = onPick

  useEffect(() => {
    let disposed = false
    ;(async () => {
      const response = await fetch('/api/mapbox-token', { cache: 'no-store' }).catch(() => null)
      const token = response?.ok ? (await response.json()).token : null
      if (!token) { setError('خريطة Mapbox غير مهيأة.'); return }
      const mapboxgl = (await import('mapbox-gl')).default
      if (disposed || !container.current) return
      mapboxgl.accessToken = token
      const instance = new mapboxgl.Map({ container: container.current, style: STYLE_URL, center: [46.68, 24.71], zoom: 9.5, attributionControl: true })
      map.current = instance
      instance.on('load', () => {
        instance.addSource('districts', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'district-fill', type: 'fill', source: 'districts', paint: { 'fill-color': ['coalesce', ['get', '__color'], '#38bdf8'], 'fill-opacity': ['case', ['has', '__color'], 0.45, 0.04] } })
        instance.addLayer({ id: 'district-line', type: 'line', source: 'districts', paint: { 'line-color': '#38bdf8', 'line-width': 0.8, 'line-opacity': 0.7 } })
        instance.addSource('circle', { type: 'geojson', data: EMPTY })
        instance.addLayer({ id: 'circle-fill', type: 'fill', source: 'circle', paint: { 'fill-color': '#2dd4a7', 'fill-opacity': 0.18 } })
        instance.addLayer({ id: 'circle-line', type: 'line', source: 'circle', paint: { 'line-color': '#2dd4a7', 'line-width': 2 } })
        instance.on('click', (event) => pick.current?.({ lon: event.lngLat.lng, lat: event.lngLat.lat }))
        setReady(true)
      })
    })()
    return () => { disposed = true; map.current?.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    const painted = districts.map((feature) => {
      const color = colors?.[String(feature.properties.id)]
      return { ...feature, properties: { ...feature.properties, ...(color ? { __color: color } : {}) } }
    })
    ;(instance.getSource('districts') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: painted })
    const bounds = boundsOf(districts)
    if (bounds && !circle) instance.fitBounds(bounds, { padding: 32, duration: 0 })
  }, [ready, districts, colors, circle])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource('circle') as GeoJSONSource | undefined)?.setData(circle ? { type: 'FeatureCollection', features: [circlePolygon(circle)] } : EMPTY)
  }, [ready, circle])

  return (
    <div className={className}>
      <div ref={container} className="h-full w-full overflow-hidden rounded-2xl border" />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
