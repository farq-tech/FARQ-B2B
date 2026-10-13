import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { waNumber, type TargetRow } from '../../api/targetingClient'

/*
 * Mapbox map for 07 (dark style, Arabic labels). Shown before any search, framed on Saudi Arabia;
 * after a search it fits the results (middle 96%, so far-off points do not shrink the dense area).
 * Places are a clustered GeoJSON source: colour = best reachable channel (Map Marker 24:188), chosen
 * places get a light ring, the outline around the chosen places is the segment. Tap a cluster to zoom in,
 * tap a place to choose it. Colours are read from the design tokens at runtime.
 */

export const MAPBOX_TOKEN = String(import.meta.env.VITE_MAPBOX_TOKEN || '')
const KSA: [[number, number], [number, number]] = [[34.5, 16.3], [55.7, 32.2]]
const RTL_PLUGIN = 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js'

const tok = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function hull(ps: [number, number][]) {
  if (ps.length < 3) return []
  const p = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], up: [number, number][] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  const h = lo.slice(0, -1).concat(up.slice(0, -1))
  return [...h, h[0]]
}

const placesOf = (rows: TargetRow[], selected: Set<string>): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: rows.filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)).map((r) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [r.longitude!, r.latitude!] },
    properties: { key: r.poi_key, name: r.name_ar || r.name_en || '', ch: waNumber(r) ? 'wa' : r.email ? 'email' : 'none', on: selected.has(r.poi_key) ? 1 : 0 },
  })),
})
const segmentOf = (rows: TargetRow[], selected: Set<string>): GeoJSON.FeatureCollection => {
  const ring = hull(rows.filter((r) => selected.has(r.poi_key) && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)).map((r) => [r.longitude!, r.latitude!] as [number, number]))
  return { type: 'FeatureCollection', features: ring.length ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] : [] }
}

export default function MapboxMap({ rows, selected, focusedKey, onToggle, onViewportChange, topInset = 72, bottomInset = 48 }: { rows: TargetRow[]; selected: Set<string>; focusedKey?: string; onToggle: (r: TargetRow) => void; onViewportChange?: (bounds: [number, number, number, number]) => void; topInset?: number; bottomInset?: number; legend?: boolean }) {
  const [loadError, setLoadError] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const ready = useRef(false)
  const latest = useRef({ rows, selected, onToggle, onViewportChange, focusedKey })
  useEffect(() => { latest.current = { rows, selected, onToggle, onViewportChange, focusedKey } })

  useEffect(() => {
    if (!box.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    if (mapboxgl.getRTLTextPluginStatus() === 'unavailable') mapboxgl.setRTLTextPlugin(RTL_PLUGIN, null, true)
    const m = new mapboxgl.Map({ container: box.current, style: 'mapbox://styles/mapbox/light-v11', bounds: KSA, fitBoundsOptions: { padding: { top: topInset, bottom: 24, left: 24, right: 24 } }, attributionControl: false, language: 'ar' })
    m.on('moveend', e => { if (!e.originalEvent) return; const b = m.getBounds(); if (b) latest.current.onViewportChange?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]) })
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-left')
    map.current = m
    if (import.meta.env.DEV) (window as unknown as { __mb?: mapboxgl.Map }).__mb = m
    m.on('error', () => { if (!ready.current) setLoadError(true) })
    m.on('load', () => {
      setLoadError(false)
      const wa = tok('--brand-accent'), em = tok('--brand-action-light'), none = tok('--brand-text-3'), ink = tok('--color-text-on-inverse'), deep = tok('--color-bg-inverse')
      const { rows: r0, selected: s0 } = latest.current
      m.addSource('segment', { type: 'geojson', data: segmentOf(r0, s0) })
      m.addLayer({ id: 'segment-fill', type: 'fill', source: 'segment', paint: { 'fill-color': wa, 'fill-opacity': 0.12 } })
      m.addLayer({ id: 'segment-line', type: 'line', source: 'segment', paint: { 'line-color': wa, 'line-width': 2 } })
      m.addSource('places', { type: 'geojson', data: placesOf(r0, s0), cluster: true, clusterRadius: 44, clusterMaxZoom: 14 })
      m.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['has', 'point_count'], paint: { 'circle-color': deep, 'circle-stroke-color': ink, 'circle-stroke-width': 3, 'circle-radius': ['step', ['get', 'point_count'], 20, 100, 24, 1000, 28] } })
      m.addLayer({ id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 14, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] }, paint: { 'text-color': ink } })
      m.addLayer({ id: 'place-hit', type: 'circle', source: 'places', filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 22, 'circle-opacity': 0 } })
      m.addLayer({ id: 'place', type: 'circle', source: 'places', filter: ['!', ['has', 'point_count']], paint: {
        'circle-color': ['match', ['get', 'ch'], 'wa', wa, 'email', em, none],
        'circle-radius': ['case', ['==', ['get', 'on'], 1], 9, 7],
        'circle-stroke-color': ink, 'circle-stroke-width': ['case', ['==', ['get', 'on'], 1], 3, 2],
      } })
      m.on('click', 'clusters', (e) => {
        const f = e.features?.[0]
        if (!f) return
        ;(m.getSource('places') as mapboxgl.GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id, (err, z) => {
          if (!err && z != null) m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z })
        })
      })
      m.on('click', 'place-hit', (e) => {
        const key = e.features?.[0]?.properties?.key
        const r = latest.current.rows.find((x) => x.poi_key === key)
        if (r) latest.current.onToggle(r)
      })
      const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
      m.on('mouseenter', 'place-hit', (e) => { m.getCanvas().style.cursor = 'pointer'; const f = e.features?.[0]; if (f) tip.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(String(f.properties?.name || '')).addTo(m) })
      m.on('mouseleave', 'place-hit', () => { m.getCanvas().style.cursor = ''; tip.remove() })
      m.on('mouseenter', 'clusters', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'clusters', () => { m.getCanvas().style.cursor = '' })
      ready.current = true
      sync(true)
    })
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(box.current)
    return () => { ro.disconnect(); ready.current = false; m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function sync(fit: boolean) {
    const m = map.current
    if (!m || !ready.current) return
    const { rows: r, selected: s } = latest.current
    const highlight = new Set(s); if (latest.current.focusedKey) highlight.add(latest.current.focusedKey)
    ;(m.getSource('places') as mapboxgl.GeoJSONSource | undefined)?.setData(placesOf(r, highlight))
    ;(m.getSource('segment') as mapboxgl.GeoJSONSource | undefined)?.setData(segmentOf(r, s))
    if (!fit) return
    const pts = r.filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude))
    if (!pts.length) return
    const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))]
    const cut = pts.length > 20 ? 0.02 : 0
    const lons = pts.map((x) => x.longitude!).sort((a, b) => a - b), lats = pts.map((x) => x.latitude!).sort((a, b) => a - b)
    m.fitBounds([[q(lons, cut), q(lats, cut)], [q(lons, 1 - cut), q(lats, 1 - cut)]], { padding: { top: topInset, bottom: bottomInset, left: 48, right: 48 }, maxZoom: 14, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400 })
  }

  useEffect(() => { sync(true) }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    sync(false)
    const target = rows.find(row => row.poi_key === focusedKey)
    const instance = map.current
    if (target && instance && Number.isFinite(target.latitude) && Number.isFinite(target.longitude) && !instance.getBounds()?.contains([target.longitude!, target.latitude!])) instance.easeTo({ center: [target.longitude!, target.latitude!], duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300 })
  }, [selected, focusedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // mapbox-gl.css sets .mapboxgl-map { position: relative }, so the map sits inside a positioned wrapper
  return <div className="absolute inset-0" role="region" aria-label="خريطة الجهات"><div ref={box} className="h-full w-full" />{loadError && <p role="alert" className="farq-map-error">تعذّر تحميل الخريطة. تقدر تستعرض الجهات وتختارها من القائمة.</p>}</div>
}
