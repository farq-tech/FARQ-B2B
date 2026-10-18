import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { applyFarqLight, MAPBOX_TOKEN } from '../MapboxMap'
import { mapReadinessEvent, recordMapInteraction } from '../../../lib/mapAnalytics'
import { chipImage, circleSvg, palette, pinSvg, svgImage } from './glyphs'
import type { LayerMapProps } from './types'
import { densityStep, streetLine, type PinFit } from './model'

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

export default function LayerMapbox(props: LayerMapProps & { mapStartedAt: number }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const ready = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tileFailed, setTileFailed] = useState(false)
  const latest = useRef(props)
  useEffect(() => { latest.current = props })

  useEffect(() => {
    if (!box.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    if (mapboxgl.getRTLTextPluginStatus() === 'unavailable') mapboxgl.setRTLTextPlugin(RTL_PLUGIN, null, true)
    const m = new mapboxgl.Map({
      container: box.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: KSA,
      attributionControl: false,
      language: 'ar',
      // Mapbox controls use their own locale strings; keep their accessible labels
      // consistent with the Arabic controls around the map.
      locale: {
        'NavigationControl.ZoomIn': 'تكبير الخريطة',
        'NavigationControl.ZoomOut': 'تصغير الخريطة',
        'AttributionControl.ToggleAttribution': 'مصادر الخريطة',
      },
    })
    map.current = m
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-left')
    m.on('error', (event) => {
      const sourceId = (event as unknown as { sourceId?: string }).sourceId
      if (sourceId === 'directory-tiles' || event.error?.message?.includes('/_targeting/tiles/')) setTileFailed(true)
    })
    // Mapbox emits recoverable tile / glyph errors while the style is still loading.
    // Only show a fatal banner if the map never reaches `load`.
    const loadTimer = window.setTimeout(() => { if (!ready.current) setFailed(true) }, 12000)
    m.on('load', () => {
      window.clearTimeout(loadTimer)
      setFailed(false)
      applyFarqLight(m)
      const { green: GREEN, ink: INK, label: LABEL } = palette()
      m.addSource('districts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'fid' })
      // District density remains visible over the basemap; progressively stronger green fill means more matching establishments.
      m.addLayer({ id: 'district-fill', type: 'fill', source: 'districts', paint: { 'fill-color': ['case', ['>', ['coalesce', ['feature-state', 'step'], 0], 0], GREEN, ['boolean', ['feature-state', 'on'], false], GREEN, INK], 'fill-opacity': ['max', ['case', ['boolean', ['feature-state', 'on'], false], 0.08, ['all', ['boolean', ['feature-state', 'hover'], false], ['any', ['boolean', ['feature-state', 'densityVisible'], true], ['boolean', ['feature-state', 'districtsVisible'], true]]], 0.06, ['boolean', ['feature-state', 'densityVisible'], true], 0.015, 0], ['case', ['boolean', ['feature-state', 'densityVisible'], true], ['match', ['coalesce', ['feature-state', 'step'], 0], 1, 0.14, 2, 0.27, 3, 0.4, 4, 0.55, 0], 0]] } })
      m.addLayer({ id: 'district-line', type: 'line', source: 'districts', paint: { 'line-color': INK, 'line-opacity': ['case', ['boolean', ['feature-state', 'on'], false], 0.95, 0.35], 'line-width': ['case', ['boolean', ['feature-state', 'on'], false], 2.5, 1], 'line-dasharray': [3, 2] } })
      // dense streets along the real street: a blurred glow under a green core, width / strength by shops per 100 m
      m.addSource('streets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'street-glow', type: 'line', source: 'streets', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': GREEN, 'line-blur': 6, 'line-opacity': ['+', 0.18, ['*', 0.2, ['get', 'ratio']]], 'line-width': ['*', ['+', 3, ['*', 5, ['get', 'ratio']]], 3.2] } })
      m.addLayer({ id: 'street-case', type: 'line', source: 'streets', filter: ['==', ['get', 'on'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': 'white', 'line-width': ['+', 7, ['*', 5, ['get', 'ratio']]] } })
      m.addLayer({ id: 'street-line', type: 'line', source: 'streets', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': GREEN, 'line-opacity': ['+', 0.55, ['*', 0.45, ['get', 'ratio']]], 'line-width': ['+', 3, ['*', 5, ['get', 'ratio']]] } })
      m.addSource('street-mid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'street-label', type: 'symbol', source: 'street-mid', filter: ['<', ['get', 'rank'], 12], layout: { 'symbol-sort-key': ['get', 'rank'], 'text-field': ['get', 'label'], 'text-size': 11, 'text-font': FONT, 'text-allow-overlap': false }, paint: { 'text-color': INK, 'text-halo-color': 'white', 'text-halo-width': 6 } })
      m.addLayer({ id: 'district-label', type: 'symbol', source: 'districts', layout: { 'text-field': ['get', 'ar'], 'text-size': 12, 'text-font': FONT }, paint: { 'text-color': ['case', ['boolean', ['feature-state', 'on'], false], GREEN, LABEL], 'text-halo-color': 'white', 'text-halo-width': 1.5 } })
      m.addSource('site', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'site-area', type: 'fill', source: 'site', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': GREEN, 'fill-opacity': 0.06 } })
      m.addLayer({ id: 'site-edge', type: 'line', source: 'site', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': GREEN, 'line-opacity': 0.6, 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'site-dot', type: 'circle', source: 'site', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': GREEN, 'circle-stroke-color': 'white', 'circle-stroke-width': 3 } })
      m.addSource('trade', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'trade-circle', type: 'circle', source: 'trade', paint: { 'circle-color': GREEN, 'circle-opacity': 0.16, 'circle-stroke-color': GREEN, 'circle-stroke-opacity': 0.65, 'circle-stroke-width': 1.5, 'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 2, 10, 8, 15, 20, 21] } })
      m.addLayer({ id: 'trade-label', type: 'symbol', source: 'trade', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 1.8], 'text-max-width': 12, 'text-font': FONT }, paint: { 'text-color': INK, 'text-halo-color': 'white', 'text-halo-width': 1.5 } })
      m.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'pins', type: 'symbol', source: 'pins', layout: { 'icon-image': ['get', 'img'], 'icon-anchor': ['case', ['==', ['get', 'layer'], 'sub'], 'center', 'bottom'], 'icon-size': ['*', ['case', ['==', ['get', 'layer'], 'spec'], 1, ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 0.9]], ['case', ['boolean', ['get', 'highlighted'], false], 1.25, 1]], 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'z'] } })
      m.on('click', (e) => {
        const L = latest.current
        if (L.placingSite) { L.onPlaceSite(e.lngLat.lat, e.lngLat.lng); return }
        const pin = m.queryRenderedFeatures(e.point, { layers: ['pins'] })[0]
        if (pin) { L.onPin(String(pin.properties?.key)); return }
        const place = m.queryRenderedFeatures(e.point, { layers: ['directory-hit'] })[0]
        if (place) {
          const coordinates = (place.geometry as GeoJSON.Point).coordinates as [number, number]
          if (Number(place.properties?.count) > 1) m.easeTo({ center: coordinates, zoom: Math.min(20, m.getZoom() + 2) })
          else L.onPin(String(place.properties?.key || ''))
          return
        }
        const st = m.queryRenderedFeatures(e.point, { layers: ['street-line', 'street-glow', 'street-label'] })[0]
        if (st) { L.onStreet(String(st.properties?.id)); return }
        const tr = m.queryRenderedFeatures(e.point, { layers: ['trade-circle'] })[0]
        if (tr) { const c = L.clusters[Number(tr.properties?.i)]; if (c) L.onCluster(c); return }
        if (!L.showDistricts && !L.showDensity) return
        const d = m.queryRenderedFeatures(e.point, { layers: ['district-fill'] })[0]
        if (d) L.onDistrict(String(d.properties?.id))
      })
      let hover: string | number | null = null
      m.on('mousemove', 'district-fill', (e) => {
        const id = e.features?.[0]?.id
        if (hover != null && hover !== id) m.setFeatureState({ source: 'districts', id: hover }, { hover: false })
        if (id != null) { hover = id; m.setFeatureState({ source: 'districts', id }, { hover: true }) }
        m.getCanvas().style.cursor = latest.current.placingSite ? 'crosshair' : latest.current.showDistricts || latest.current.showDensity ? 'pointer' : ''
      })
      m.on('mouseleave', 'district-fill', () => { if (hover != null) m.setFeatureState({ source: 'districts', id: hover }, { hover: false }); hover = null; m.getCanvas().style.cursor = '' })
      const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 14 })
      m.on('mouseenter', 'pins', (e) => { m.getCanvas().style.cursor = 'pointer'; const f = e.features?.[0]; if (f) tip.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(latest.current.nameOf(String(f.properties?.key))).addTo(m) })
      m.on('mouseleave', 'pins', () => { m.getCanvas().style.cursor = ''; tip.remove() })
      ready.current = true
      setLoaded(true)
      if (import.meta.env.PROD) recordMapInteraction(mapReadinessEvent(performance.now() - props.mapStartedAt))
    })
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(box.current)
    const onWindowResize = () => m.resize()
    window.addEventListener('resize', onWindowResize)
    return () => { window.clearTimeout(loadTimer); window.removeEventListener('resize', onWindowResize); ro.disconnect(); ready.current = false; m.remove(); map.current = null }
  }, [])

  function syncDirectoryTiles() {
    const m = map.current
    if (!loaded || !m) return
    const query = latest.current.tileQuery
    for (const id of ['directory-count', 'directory-hit', 'directory-points']) if (m.getLayer(id)) m.removeLayer(id)
    if (m.getSource('directory-tiles')) m.removeSource('directory-tiles')
    setTileFailed(false)
    if (!query) return
    const { green } = palette()
    m.addSource('directory-tiles', { type: 'vector', tiles: [`${window.location.origin}/_targeting/tiles/${query}/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 20 })
    m.addLayer({ id: 'directory-points', type: 'circle', source: 'directory-tiles', 'source-layer': 'businesses', paint: { 'circle-color': green, 'circle-radius': ['case', ['>', ['get', 'count'], 1], 17, 6], 'circle-stroke-color': 'white', 'circle-stroke-width': 2 } })
    m.addLayer({ id: 'directory-hit', type: 'circle', source: 'directory-tiles', 'source-layer': 'businesses', paint: { 'circle-radius': 22, 'circle-opacity': 0 } })
    m.addLayer({ id: 'directory-count', type: 'symbol', source: 'directory-tiles', 'source-layer': 'businesses', filter: ['>', ['get', 'count'], 1], layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 11, 'text-font': FONT }, paint: { 'text-color': 'white' } })
  }
  useEffect(() => { syncDirectoryTiles() }, [loaded, props.tileQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Safari can keep the old Mapbox canvas size when the map's parent changes from
  // the page grid to the fixed full-screen shell. Resize after both layouts settle.
  useEffect(() => {
    const m = map.current
    if (!m) return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => m.resize())
    })
    const settle = window.setTimeout(() => m.resize(), 180)
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
      window.clearTimeout(settle)
    }
  }, [props.focusMode])

  // districts (geometry once per city; selection as feature state)
  const { districts, chosen, pins, clusters, site, fit, extent, streets, activeStreet, density, densityMax } = props
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    const features = districts.filter((d) => d.feature).map((d, i) => ({ ...d.feature!, properties: { ...d.feature!.properties, id: d.id, fid: i } }))
    ;(m.getSource('districts') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }, [loaded, districts])
  // Frame the city only when the city changes. Re-fitting on every result refresh
  // overrides the district fit and visibly zooms back out.
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    const all = districts.map((d) => d.bbox).filter(Boolean) as [number, number, number, number][]
    const b = all.length ? [Math.min(...all.map((x) => x[0])), Math.min(...all.map((x) => x[1])), Math.max(...all.map((x) => x[2])), Math.max(...all.map((x) => x[3]))] : extent
    if (b) m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: reduced() ? 0 : 500 })
  }, [loaded, props.city]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    districts.filter((d) => d.feature).forEach((d, i) => m.setFeatureState({ source: 'districts', id: i }, { on: chosen.has(d.id), step: densityStep(density.get(d.id) || 0, densityMax), densityVisible: props.showDensity, districtsVisible: props.showDistricts }))
  }, [loaded, districts, chosen, density, densityMax, props.showDensity, props.showDistricts])
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    const visible = (ids: string[], on: boolean) => ids.forEach((id) => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none') })
    visible(['district-line', 'district-label'], props.showDistricts)
    visible(['pins', 'directory-points', 'directory-count', 'directory-hit'], props.showPlaces)
    visible(['trade-circle', 'trade-label'], props.showClusters)
    visible(['street-glow', 'street-case', 'street-line', 'street-label'], props.showStreets)
  }, [loaded, props.showDistricts, props.showPlaces, props.showClusters, props.showStreets, props.tileQuery])
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    const maxPer = Math.max(1, ...streets.map((st) => st.props.per_100m))
    ;(m.getSource('streets') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: streets.map((st) => ({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: st.lines }, properties: { id: st.id, ratio: Math.min(1, st.props.per_100m / maxPer), on: activeStreet === st.id ? 1 : 0 } })) })
    ;(m.getSource('street-mid') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [...streets].sort((a, b) => b.props.n - a.props.n).map((st, rank) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: st.mid }, properties: { id: st.id, rank: st.id === activeStreet ? -1 : rank, label: `${streetLine(st)} · ${st.props.n.toLocaleString('ar-SA')}` } })) })
  }, [loaded, streets, activeStreet])
  useEffect(() => {
    const m = map.current
    if (!loaded || !m || !fit) return
    const [w, s, e, n] = fit.bounds
    m.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 16, duration: reduced() ? 0 : 600 })
  }, [loaded, fit])
  useEffect(() => {
    const m = map.current
    if (!loaded || !m) return
    ;(m.getSource('trade') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: clusters.map((c, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { i, n: c.n, label: `${c.popular_ar || (c.level === 'street' ? c.street_ar : c.district_ar) || c.label_ar}\n${c.n.toLocaleString('ar-SA')} منشأة` } })) })
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
    const fitCode = (fit: PinFit) => fit === 'likely' ? 'L' : fit === 'maybe' ? 'M' : fit === 'low' ? 'N' : 'U'
    const imgOf = (p: typeof pins[number]) => `${p.layer === 'spec' ? 'x' : p.layer === 'main' ? 'm' : 's'}:${p.chosen ? 1 : 0}:${fitCode(p.fit)}:${p.layer === 'spec' ? p.text : p.icon}`
    const need = [...new Set(pins.map(imgOf))].filter((id) => !m.hasImage(id))
    void Promise.all(need.map(async (id) => {
      const [kind, chosenCode, fitValue, ...restParts] = id.split(':')
      const on = chosenCode === '1'
      const fit: PinFit = fitValue === 'L' ? 'likely' : fitValue === 'M' ? 'maybe' : fitValue === 'N' ? 'low' : 'unknown'
      const rest = restParts.join(':')
      if (kind === 'x') { if (!m.hasImage(id)) m.addImage(id, chipImage(rest, on, fit), { pixelRatio: 2 }); return }
      const im = await svgImage(kind === 'm' ? pinSvg(rest, on, fit) : circleSvg(rest, on, fit))
      if (alive && !m.hasImage(id)) m.addImage(id, im)
    })).then(() => {
      if (!alive) return
      ;(m.getSource('pins') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: pins.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { key: p.key, img: imgOf(p), layer: p.layer, z: p.chosen ? 1 : 0, highlighted: p.key === props.highlightedPinKey } })) })
    })
    return () => { alive = false }
  }, [loaded, pins, props.highlightedPinKey])

  return (
    <div className="farq-opportunity-map absolute inset-0" role="region" aria-label="خريطة الفرص">
      <div ref={box} className="h-full w-full" />
      {!loaded && !failed ? (
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-[var(--map-land)]/60">
          <span role="status" className="rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-4 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] shadow-[var(--farq-soft-shadow)] backdrop-blur-md">
            نحمّل طبقات الخريطة…
          </span>
        </div>
      ) : null}
      {tileFailed && props.showPlaces ? <p role="alert" className="farq-map-error">تعذّر تحميل نقاط المنشآت. <button type="button" onClick={props.onTileRefresh}>تحديث النقاط</button></p> : null}
      {failed ? <p role="alert" className="farq-map-error">تعذّر تحميل الخريطة. تقدر تستعرض الجهات وتختارها من القائمة.</p> : null}
    </div>
  )
}
