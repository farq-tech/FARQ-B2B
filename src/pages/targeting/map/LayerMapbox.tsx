import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { applyFarqLight, MAPBOX_TOKEN } from '../MapboxMap'
import { chipImage, circleSvg, palette, pinSvg, svgImage } from './glyphs'
import type { LayerMapProps } from './types'

/*
 * خريطة الفرص v2 on Mapbox (light-v11 tuned at runtime to the Farq light grey): district outlines (dashed, a chosen one
 * filled light green), one pin layer at a time (charcoal teardrops / green circles / navy specialty chips), trade clusters
 * as soft green circles with their market names, and the customer's site with its delivery radius.
 */
const RTL_PLUGIN = 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js'
const KSA: [[number, number], [number, number]] = [[34.5, 16.3], [55.7, 32.2]]
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const FONT = ['DIN Pro Medium', 'Arial Unicode MS Regular']

function circle(lat: number, lon: number, km: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const pts: number[][] = []
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2
    pts.push([lon + ((km / 111.32) * Math.cos(a)) / Math.cos((lat * Math.PI) / 180), lat + (km / 110.57) * Math.sin(a)])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} }
}

export default function LayerMapbox(props: LayerMapProps) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const ready = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = useRef(props)
  useEffect(() => { latest.current = props })

  useEffect(() => {
    if (!box.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    if (mapboxgl.getRTLTextPluginStatus() === 'unavailable') mapboxgl.setRTLTextPlugin(RTL_PLUGIN, null, true)
    const m = new mapboxgl.Map({ container: box.current, style: 'mapbox://styles/mapbox/light-v11', bounds: KSA, attributionControl: false, language: 'ar' })
    map.current = m
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-left')
    m.on('error', () => { if (!ready.current) setFailed(true) })
    m.on('load', () => {
      applyFarqLight(m)
      const { green: GREEN, ink: INK, label: LABEL } = palette()
      m.addSource('districts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'fid' })
      m.addLayer({ id: 'district-fill', type: 'fill', source: 'districts', paint: { 'fill-color': ['case', ['boolean', ['feature-state', 'on'], false], GREEN, INK], 'fill-opacity': ['case', ['boolean', ['feature-state', 'on'], false], 0.12, ['boolean', ['feature-state', 'hover'], false], 0.06, 0.015] } })
      m.addLayer({ id: 'district-line', type: 'line', source: 'districts', paint: { 'line-color': ['case', ['boolean', ['feature-state', 'on'], false], GREEN, INK], 'line-opacity': ['case', ['boolean', ['feature-state', 'on'], false], 0.9, 0.35], 'line-width': ['case', ['boolean', ['feature-state', 'on'], false], 2, 1], 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'district-label', type: 'symbol', source: 'districts', layout: { 'text-field': ['get', 'ar'], 'text-size': 12, 'text-font': FONT }, paint: { 'text-color': ['case', ['boolean', ['feature-state', 'on'], false], GREEN, LABEL], 'text-halo-color': 'white', 'text-halo-width': 1.5 } })
      m.addSource('site', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'site-area', type: 'fill', source: 'site', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': GREEN, 'fill-opacity': 0.06 } })
      m.addLayer({ id: 'site-edge', type: 'line', source: 'site', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': GREEN, 'line-opacity': 0.6, 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'site-dot', type: 'circle', source: 'site', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': GREEN, 'circle-stroke-color': 'white', 'circle-stroke-width': 3 } })
      m.addSource('trade', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'trade-circle', type: 'circle', source: 'trade', paint: { 'circle-color': GREEN, 'circle-opacity': 0.14, 'circle-stroke-color': GREEN, 'circle-stroke-opacity': 0.55, 'circle-stroke-width': 1.5, 'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 2, 16, 8, 30, 20, 44] } })
      m.addLayer({ id: 'trade-label', type: 'symbol', source: 'trade', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 1.8], 'text-max-width': 12, 'text-font': FONT }, paint: { 'text-color': INK, 'text-halo-color': 'white', 'text-halo-width': 1.5 } })
      m.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'pins', type: 'symbol', source: 'pins', layout: { 'icon-image': ['get', 'img'], 'icon-anchor': ['case', ['==', ['get', 'layer'], 'sub'], 'center', 'bottom'], 'icon-size': ['case', ['==', ['get', 'layer'], 'spec'], 1, ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 0.9]], 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'z'] } })
      m.on('click', (e) => {
        const L = latest.current
        if (L.placingSite) { L.onPlaceSite(e.lngLat.lat, e.lngLat.lng); return }
        const pin = m.queryRenderedFeatures(e.point, { layers: ['pins'] })[0]
        if (pin) { L.onPin(String(pin.properties?.key)); return }
        const tr = m.queryRenderedFeatures(e.point, { layers: ['trade-circle'] })[0]
        if (tr) { const c = L.clusters[Number(tr.properties?.i)]; if (c) L.onCluster(c); return }
        const d = m.queryRenderedFeatures(e.point, { layers: ['district-fill'] })[0]
        if (d) L.onDistrict(String(d.properties?.id))
      })
      let hover: string | number | null = null
      m.on('mousemove', 'district-fill', (e) => {
        const id = e.features?.[0]?.id
        if (hover != null && hover !== id) m.setFeatureState({ source: 'districts', id: hover }, { hover: false })
        if (id != null) { hover = id; m.setFeatureState({ source: 'districts', id }, { hover: true }) }
        m.getCanvas().style.cursor = latest.current.placingSite ? 'crosshair' : 'pointer'
      })
      m.on('mouseleave', 'district-fill', () => { if (hover != null) m.setFeatureState({ source: 'districts', id: hover }, { hover: false }); hover = null; m.getCanvas().style.cursor = '' })
      const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 14 })
      m.on('mouseenter', 'pins', (e) => { m.getCanvas().style.cursor = 'pointer'; const f = e.features?.[0]; if (f) tip.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(latest.current.nameOf(String(f.properties?.key))).addTo(m) })
      m.on('mouseleave', 'pins', () => { m.getCanvas().style.cursor = ''; tip.remove() })
      ready.current = true
      setLoaded(true)
    })
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(box.current)
    return () => { ro.disconnect(); ready.current = false; m.remove(); map.current = null }
  }, [])

  // districts (geometry once per city; selection as feature state)
  const { districts, chosen, pins, clusters, site, fit, extent } = props
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    const features = districts.filter((d) => d.feature).map((d, i) => ({ ...d.feature!, properties: { ...d.feature!.properties, id: d.id, fid: i } }))
    ;(m.getSource('districts') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
    const all = districts.map((d) => d.bbox).filter(Boolean) as [number, number, number, number][]
    const b = all.length ? [Math.min(...all.map((x) => x[0])), Math.min(...all.map((x) => x[1])), Math.max(...all.map((x) => x[2])), Math.max(...all.map((x) => x[3]))] : extent
    if (b) m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: reduced() ? 0 : 500 })
  }, [loaded, districts, extent])
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    districts.filter((d) => d.feature).forEach((d, i) => m.setFeatureState({ source: 'districts', id: i }, { on: chosen.has(d.id) }))
  }, [loaded, districts, chosen])
  useEffect(() => {
    const m = map.current
    if (!loaded || !m || !fit) return
    const [w, s, e, n] = fit.bounds
    m.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 16, duration: reduced() ? 0 : 600 })
  }, [loaded, fit])
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    ;(m.getSource('trade') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: clusters.map((c, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { i, n: c.n, label: `${c.popular_ar || (c.level === 'street' ? c.street_ar : c.district_ar) || c.label_ar}\n${c.n.toLocaleString('en-US')} محل` } })) })
  }, [loaded, clusters])
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    ;(m.getSource('site') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: site ? [circle(site.lat, site.lon, site.km), { type: 'Feature', geometry: { type: 'Point', coordinates: [site.lon, site.lat] }, properties: {} }] : [] })
  }, [loaded, site])
  // pins: make the images they need, then draw
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    let alive = true
    const imgOf = (p: typeof pins[number]) => (p.layer === 'spec' ? `x:${p.chosen ? 1 : 0}:${p.text}` : `${p.layer === 'main' ? 'm' : 's'}:${p.chosen ? 1 : 0}:${p.icon}`)
    const need = [...new Set(pins.map(imgOf))].filter((id) => !m.hasImage(id))
    void Promise.all(need.map(async (id) => {
      const [kind, on, rest] = [id.slice(0, 1), id.slice(2, 3) === '1', id.slice(4)]
      if (kind === 'x') { if (!m.hasImage(id)) m.addImage(id, chipImage(rest, on), { pixelRatio: 2 }); return }
      const im = await svgImage(kind === 'm' ? pinSvg(rest, on) : circleSvg(rest, on))
      if (alive && !m.hasImage(id)) m.addImage(id, im)
    })).then(() => {
      if (!alive) return
      ;(m.getSource('pins') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: pins.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { key: p.key, img: imgOf(p), layer: p.layer, z: p.chosen ? 1 : 0 } })) })
    })
    return () => { alive = false }
  }, [loaded, pins])

  return (
    <div className="absolute inset-0" role="region" aria-label="خريطة الفرص">
      <div ref={box} className="h-full w-full" />
      {failed ? <p role="alert" className="farq-map-error">تعذّر تحميل الخريطة. تقدر تستعرض الجهات وتختارها من القائمة.</p> : null}
    </div>
  )
}
