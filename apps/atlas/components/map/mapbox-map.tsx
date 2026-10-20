'use client'

import 'mapbox-gl/dist/mapbox-gl.css'
import type { Feature, FeatureCollection, Geometry, Point as GeoPoint, Position } from 'geojson'
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl'
import { Loader2, MapPinOff, Minus, Plus, Scan, SearchX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import { areaKey, areaRing, boundsOf, cityBounds, isInArea, toLngLat, type LngLatBounds, type MapArea } from '@/lib/geo'
import { DISTRICT_MAX_ZOOM, ENTITY_MIN_ZOOM, LEVELS, summarize, type MapLevel } from '@/lib/map-summary'
import { DISTRICTS, STREETS, cityById, districtById } from '@/lib/mock-data'
import type { DistrictCount, MarketSummary } from '@/lib/live-market'
import type { Business } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DEFAULT_LAYERS, LayersControl, type LayerState } from './layers-control'
import { AreaCard, BusinessCard, ClusterCard, DistrictCard, MapContextBar, MapLegend } from './map-overlays'
import type { MockMapProps } from './mock-map'

const COLORS = {
  primary: '#0d8b72',
  primarySoft: '#e3f1ec',
  card: '#fffefb',
  foreground: '#161816',
  muted: '#5f655f',
}
const STYLE_URL = 'mapbox://styles/mapbox/light-v11'
const FONT = ['DIN Pro Medium', 'Arial Unicode MS Regular']
const FONT_BOLD = ['DIN Pro Bold', 'Arial Unicode MS Bold']
const LOAD_TIMEOUT_MS = 20000

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const BIZ_SOURCES = ['biz-flat', 'biz-clustered'] as const
const PIN_SUFFIXES = ['focus', 'pin', 'dot'] as const
const CLUSTER_LAYERS = ['cluster-halo', 'cluster', 'cluster-count', 'cluster-badge', 'cluster-badge-count']
const DISTRICT_LAYERS = ['district-heat', 'district-line', 'district-line-hl', 'district-line-active', 'district-label']

const expr = (x: unknown) => x as ExpressionSpecification
const filter = (x: unknown) => x as FilterSpecification
const isOn = (key: string) => expr(['==', ['get', key], 1])
const UNCLUSTERED = filter(['!', ['has', 'point_count']])
const FADED = (on: number, off: number) => expr(['case', isOn('out'), off, on])

type Card =
  | { kind: 'business'; id: string }
  | { kind: 'district'; id: string }
  | { kind: 'cluster'; ids: string[]; center: [number, number]; zoom: number }
  | null

export interface MapboxMapProps extends MockMapProps {
  token: string
  onFailure: () => void
  /** Server-proxied aggregate market data. Never contains contacts or send actions. */
  liveDistricts?: FeatureCollection
  liveCounts?: DistrictCount[]
  liveSummary?: MarketSummary['summary']
}

function levelFor(zoom: number, progressive: boolean, layers: LayerState): MapLevel {
  if (progressive && layers.districts && zoom < DISTRICT_MAX_ZOOM) return 'districts'
  if (layers.clusters && zoom < ENTITY_MIN_ZOOM) return 'clusters'
  return 'entities'
}

function districtId(feature: Feature): string | null {
  const properties = feature.properties ?? {}
  const value = properties.id ?? properties.district_id ?? properties.district_en ?? feature.id
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function districtName(feature: Feature): string {
  const properties = feature.properties ?? {}
  const value = properties.ar ?? properties.name_ar ?? properties.district_ar ?? properties.name ?? districtId(feature)
  return typeof value === 'string' ? value : 'حي'
}

function polygonCenter(geometry: Geometry | null): [number, number] | null {
  if (!geometry || geometry.type === 'GeometryCollection') return null
  const positions: Position[] = []
  const collect = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') positions.push(value as Position)
    else value.forEach(collect)
  }
  collect(geometry.coordinates)
  if (!positions.length) return null
  return [positions.reduce((sum, p) => sum + p[0], 0) / positions.length, positions.reduce((sum, p) => sum + p[1], 0) / positions.length]
}

function outerRing(geometry: Geometry | null): [number, number][] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return geometry.coordinates[0]?.map(([lng, lat]) => [lng, lat]) ?? []
  if (geometry.type === 'MultiPolygon') return geometry.coordinates[0]?.[0]?.map(([lng, lat]) => [lng, lat]) ?? []
  return []
}

function businessesFC(cityId: string, items: Business[], selected: Set<string>, area?: MapArea | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map((b) => ({
      type: 'Feature',
      properties: { id: b.id, selected: selected.has(b.id) ? 1 : 0, out: area && !isInArea(cityId, b, area) ? 1 : 0 },
      geometry: { type: 'Point', coordinates: toLngLat(cityId, [b.x, b.y]) },
    })),
  }
}

function addLayers(map: MapboxMap) {
  for (const id of ['districts', 'district-points', 'streets', 'ghosts', 'biz-flat', 'selected', 'area']) {
    map.addSource(id, { type: 'geojson', data: EMPTY })
  }
  map.addSource('biz-clustered', {
    type: 'geojson',
    data: EMPTY,
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: ENTITY_MIN_ZOOM - 1,
    clusterProperties: { selectedCount: ['+', ['get', 'selected']] },
  })

  map.addLayer({
    id: 'district-heat',
    type: 'fill',
    source: 'districts',
    paint: {
      'fill-color': expr(['interpolate', ['linear'], ['get', 't'], 0, COLORS.primarySoft, 1, COLORS.primary]),
      'fill-opacity': expr([
        'interpolate',
        ['linear'],
        ['zoom'],
        DISTRICT_MAX_ZOOM - 0.4,
        ['case', ['>', ['get', 'count'], 0], ['+', 0.14, ['*', ['get', 't'], 0.42]], 0.06],
        DISTRICT_MAX_ZOOM + 0.6,
        0.035,
      ]),
    },
  })
  map.addLayer({
    id: 'district-line',
    type: 'line',
    source: 'districts',
    paint: { 'line-color': COLORS.foreground, 'line-opacity': 0.16, 'line-width': 1 },
  })
  map.addLayer({
    id: 'district-line-hl',
    type: 'line',
    source: 'districts',
    filter: filter(['==', ['get', 'hl'], 1]),
    paint: { 'line-color': COLORS.primary, 'line-width': 2 },
  })
  map.addLayer({
    id: 'district-line-active',
    type: 'line',
    source: 'districts',
    filter: filter(['==', ['get', 'id'], '']),
    paint: { 'line-color': COLORS.foreground, 'line-width': 2.5, 'line-opacity': 0.85 },
  })

  map.addLayer({
    id: 'area-fill',
    type: 'fill',
    source: 'area',
    paint: { 'fill-color': COLORS.primary, 'fill-opacity': 0.07 },
  })
  map.addLayer({
    id: 'area-line',
    type: 'line',
    source: 'area',
    paint: { 'line-color': COLORS.primary, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  })

  map.addLayer({
    id: 'street-active',
    type: 'line',
    source: 'streets',
    minzoom: DISTRICT_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': COLORS.primary,
      'line-opacity': expr(['case', isOn('strong'), 0.9, 0.35]),
      'line-width': expr(['interpolate', ['linear'], ['zoom'], 13, ['case', isOn('strong'), 3.5, 2.5], 16, ['case', isOn('strong'), 6, 4]]),
    },
  })
  map.addLayer({
    id: 'street-label',
    type: 'symbol',
    source: 'streets',
    minzoom: 14.5,
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11 },
    paint: { 'text-color': COLORS.primary, 'text-halo-color': COLORS.card, 'text-halo-width': 1.5 },
  })

  // District density belongs to the polygon, not a wall of text. Labels appear only
  // once the user zooms in, and Mapbox collision detection keeps them readable.
  map.addLayer({
    id: 'district-summary',
    type: 'symbol',
    source: 'district-points',
    minzoom: 11.6,
    maxzoom: DISTRICT_MAX_ZOOM,
    filter: filter(['>', ['get', 'count'], 0]),
    layout: {
      'text-field': ['get', 'name'],
      'text-font': FONT_BOLD,
      'text-size': 12,
      'text-max-width': 7,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-sort-key': ['get', 'count'],
    },
    paint: { 'text-color': COLORS.foreground, 'text-halo-color': COLORS.card, 'text-halo-width': 2 },
  })
  map.addLayer({
    id: 'district-label',
    type: 'symbol',
    source: 'district-points',
    minzoom: DISTRICT_MAX_ZOOM,
    maxzoom: 15,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': FONT_BOLD,
      'text-size': 12,
      'text-max-width': 7,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-sort-key': ['get', 'count'],
    },
    paint: {
      'text-color': expr(['case', isOn('hl'), COLORS.primary, COLORS.foreground]),
      'text-opacity': 0.6,
      'text-halo-color': COLORS.card,
      'text-halo-width': 1.75,
    },
  })

  map.addLayer({
    id: 'selected-dot',
    type: 'circle',
    source: 'selected',
    maxzoom: DISTRICT_MAX_ZOOM,
    paint: { 'circle-radius': 4.5, 'circle-color': COLORS.primary, 'circle-stroke-color': COLORS.card, 'circle-stroke-width': 2 },
  })

  map.addLayer({
    id: 'ghost',
    type: 'circle',
    source: 'ghosts',
    paint: {
      'circle-radius': 7,
      'circle-color': COLORS.card,
      'circle-opacity': 0.85,
      'circle-stroke-color': COLORS.muted,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.8,
    },
  })

  for (const src of BIZ_SOURCES) {
    map.addLayer({
      id: `${src}-focus`,
      type: 'circle',
      source: src,
      filter: filter(['all', UNCLUSTERED, ['==', ['get', 'id'], '']]),
      paint: { 'circle-radius': 18, 'circle-color': COLORS.primary, 'circle-opacity': 0.2 },
    })
    map.addLayer({
      id: `${src}-pin`,
      type: 'circle',
      source: src,
      filter: UNCLUSTERED,
      paint: {
        'circle-radius': expr(['case', isOn('selected'), 9, 7]),
        'circle-color': expr(['case', isOn('selected'), COLORS.primary, COLORS.card]),
        'circle-stroke-color': expr(['case', isOn('selected'), COLORS.card, COLORS.primary]),
        'circle-stroke-width': expr(['case', isOn('selected'), 3, 2.25]),
        'circle-opacity': FADED(1, 0.4),
        'circle-stroke-opacity': FADED(1, 0.35),
      },
    })
    map.addLayer({
      id: `${src}-dot`,
      type: 'circle',
      source: src,
      filter: UNCLUSTERED,
      paint: {
        'circle-radius': expr(['case', isOn('selected'), 3, 2.25]),
        'circle-color': expr(['case', isOn('selected'), COLORS.card, COLORS.primary]),
        'circle-opacity': FADED(1, 0.35),
      },
    })
  }

  const clustered = filter(['has', 'point_count'])
  const radius = expr(['step', ['get', 'point_count'], 14, 6, 17, 15, 21, 40, 25])
  map.addLayer({
    id: 'cluster-halo',
    type: 'circle',
    source: 'biz-clustered',
    filter: clustered,
    paint: { 'circle-radius': expr(['+', radius, 5]), 'circle-color': COLORS.primary, 'circle-opacity': 0.12 },
  })
  map.addLayer({
    id: 'cluster',
    type: 'circle',
    source: 'biz-clustered',
    filter: clustered,
    paint: { 'circle-radius': radius, 'circle-color': COLORS.card, 'circle-stroke-color': COLORS.primary, 'circle-stroke-width': 2.25 },
  })
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'biz-clustered',
    filter: clustered,
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT_BOLD, 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': COLORS.primary },
  })
  const hasSelected = filter(['all', clustered, ['>', ['get', 'selectedCount'], 0]])
  map.addLayer({
    id: 'cluster-badge',
    type: 'circle',
    source: 'biz-clustered',
    filter: hasSelected,
    paint: {
      'circle-radius': 8.5,
      'circle-color': COLORS.foreground,
      'circle-stroke-color': COLORS.card,
      'circle-stroke-width': 1.5,
      'circle-translate': [-15, -15],
    },
  })
  map.addLayer({
    id: 'cluster-badge-count',
    type: 'symbol',
    source: 'biz-clustered',
    filter: hasSelected,
    layout: {
      'text-field': ['to-string', ['get', 'selectedCount']],
      'text-font': FONT_BOLD,
      'text-size': 10,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff', 'text-translate': [-15, -15] },
  })
}

/** Quiets the basemap so business data, not POIs, carries the visual weight. */
function calmBasemap(map: MapboxMap) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (/poi|transit|airport|ferry|aerialway/.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none')
    else if (layer.type === 'symbol' && /road/.test(layer.id)) map.setPaintProperty(layer.id, 'text-opacity', 0.6)
  }
}

export function MapboxBusinessMap({
  cityId,
  businesses,
  ghostBusinesses = [],
  selectedIds,
  onTogglePin,
  focusRequest,
  highlightDistricts = [],
  highlightStreets = [],
  state = 'ready',
  onResetFilters,
  compact = false,
  reserveBottom = false,
  className,
  token,
  onFailure,
  area = null,
  onAreaChange,
  onSelectMany,
  onShowList,
  liveDistricts,
  liveCounts = [],
  liveSummary,
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const progressive = !compact
  const [ready, setReady] = useState(false)
  const [sizeEpoch, setSizeEpoch] = useState(0)
  const defaultLayers = useMemo<LayerState>(() => ({ ...DEFAULT_LAYERS, clusters: !compact }), [compact])
  const [layers, setLayers] = useState<LayerState>(defaultLayers)
  const [layersOpen, setLayersOpen] = useState(false)
  const [card, setCard] = useState<Card>(null)
  const [legendOpen, setLegendOpen] = useState(!compact)
  const [zoom, setZoom] = useState(11)
  const [viewBounds, setViewBounds] = useState<LngLatBounds | null>(null)
  const [areaMode, setAreaMode] = useState(false)
  const [dismissedArea, setDismissedArea] = useState<object | null>(null)
  const [drawRect, setDrawRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [wide, setWide] = useState(true)

  const level = levelFor(zoom, progressive, layers)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const liveDistrictFeatures = useMemo(() => (liveDistricts?.features ?? []).filter((feature): feature is Feature<Geometry> => Boolean(feature?.geometry && districtId(feature))), [liveDistricts])
  const liveDistrictById = useMemo(() => new Map(liveDistrictFeatures.map((feature) => [districtId(feature) as string, feature])), [liveDistrictFeatures])
  const liveCountByName = useMemo(() => new Map(liveCounts.map((count) => [count.district_ar.trim(), count])), [liveCounts])
  const useLiveDistricts = liveDistrictFeatures.length > 0

  const handlersRef = useRef({
    onTogglePin,
    onFailure,
    onAreaChange,
    cityId,
    areaMode,
    progressive,
  })
  useEffect(() => {
    handlersRef.current = { onTogglePin, onFailure, onAreaChange, cityId, areaMode, progressive }
  })
  const initialCityRef = useRef(cityId)

  const districtsKey = highlightDistricts.join(',')
  const streetsKey = highlightStreets.join(',')
  const resultsKey = useMemo(() => `${cityId}|${businesses.map((b) => b.id).join(',')}`, [cityId, businesses])

  useEffect(() => {
    let cancelled = false
    let map: MapboxMap | null = null
    let observer: ResizeObserver | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    const container = containerRef.current
    if (!container) return

    ;(async () => {
      try {
        const { default: mapboxgl } = await import('mapbox-gl')
        if (cancelled) return
        mapboxgl.accessToken = token
        const m = new mapboxgl.Map({
          container,
          style: STYLE_URL,
          bounds: cityBounds(initialCityRef.current),
          fitBoundsOptions: { padding: 24 },
          language: 'ar',
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          minZoom: 9,
        })
        map = m
        mapRef.current = m
        m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')
        m.touchZoomRotate.disableRotation()

        timeout = setTimeout(() => {
          if (!m.isStyleLoaded()) handlersRef.current.onFailure()
        }, LOAD_TIMEOUT_MS)

        m.on('error', (e) => {
          const status = (e.error as { status?: number } | undefined)?.status
          if (status === 401 || status === 403) handlersRef.current.onFailure()
        })

        const syncView = () => {
          setZoom(m.getZoom())
          const b = m.getBounds()
          if (b) setViewBounds([b.getSouthWest().toArray() as [number, number], b.getNorthEast().toArray() as [number, number]])
        }

        m.on('load', () => {
          if (timeout) clearTimeout(timeout)
          calmBasemap(m)
          addLayers(m)
          m.on('moveend', syncView)
          syncView()

          const hit = (ids: string[], point: { x: number; y: number }) => {
            const visible = ids.filter((id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none')
            return visible.length ? m.queryRenderedFeatures([point.x, point.y], { layers: visible })[0] : undefined
          }

          m.on('click', (e) => {
            const h = handlersRef.current
            if (h.areaMode) {
              const d = hit(['district-heat'], e.point)
              const id = d?.properties?.id
              if (typeof id === 'string') {
                const label = typeof d?.properties?.name === 'string' ? d.properties.name : typeof d?.properties?.ar === 'string' ? d.properties.ar : districtById.get(id)?.name ?? ''
                h.onAreaChange?.({ kind: 'district', districtId: id, label: `حي ${label}` })
                setAreaMode(false)
              }
              return
            }
            setLayersOpen(false)
            const pin = hit(['biz-clustered-pin', 'biz-flat-pin', 'ghost'], e.point)
            const pinId = pin?.properties?.id
            if (typeof pinId === 'string') {
              h.onTogglePin(pinId)
              setCard({ kind: 'business', id: pinId })
              return
            }
            const cl = hit(['cluster'], e.point)
            const clusterId = cl?.properties?.cluster_id
            if (cl && typeof clusterId === 'number') {
              const src = m.getSource('biz-clustered') as GeoJSONSource
              const center = (cl.geometry as GeoPoint).coordinates as [number, number]
              src.getClusterLeaves(clusterId, 1000, 0, (err, leaves) => {
                if (err || !leaves) return
                const ids = leaves.map((f) => f.properties?.id).filter((x): x is string => typeof x === 'string')
                src.getClusterExpansionZoom(clusterId, (err2, z) => {
                  setCard({ kind: 'cluster', ids, center, zoom: err2 || z == null ? m.getZoom() + 1.5 : z + 0.4 })
                })
              })
              return
            }
            const d = hit(['district-heat'], e.point)
            const districtId = d?.properties?.id
            if (typeof districtId === 'string' && h.progressive && m.getZoom() < DISTRICT_MAX_ZOOM) {
              setCard({ kind: 'district', id: districtId })
              return
            }
            setCard(null)
          })

          const pointerLayers = ['biz-flat-pin', 'biz-clustered-pin', 'ghost', 'cluster']
          for (const layer of pointerLayers) {
            m.on('mouseenter', layer, () => {
              if (!handlersRef.current.areaMode) m.getCanvas().style.cursor = 'pointer'
            })
            m.on('mouseleave', layer, () => {
              if (!handlersRef.current.areaMode) m.getCanvas().style.cursor = ''
            })
          }

          let start: { x: number; y: number } | null = null
          const begin = (p: { x: number; y: number }) => {
            if (!handlersRef.current.areaMode) return
            start = { x: p.x, y: p.y }
          }
          const move = (p: { x: number; y: number }) => {
            if (!start) return
            setDrawRect({ x0: start.x, y0: start.y, x1: p.x, y1: p.y })
          }
          const end = (p: { x: number; y: number }) => {
            if (!start) return
            const s = start
            start = null
            setDrawRect(null)
            if (Math.abs(p.x - s.x) < 8 && Math.abs(p.y - s.y) < 8) return
            const a = m.unproject([s.x, s.y]).toArray() as [number, number]
            const b = m.unproject([p.x, p.y]).toArray() as [number, number]
            const bounds: LngLatBounds = [
              [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
              [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
            ]
            handlersRef.current.onAreaChange?.({ kind: 'rect', bounds, label: 'منطقة مرسومة' })
            setAreaMode(false)
          }
          m.on('mousedown', (e) => begin(e.point))
          m.on('mousemove', (e) => move(e.point))
          m.on('mouseup', (e) => end(e.point))
          m.on('touchstart', (e) => begin(e.point))
          m.on('touchmove', (e) => move(e.point))
          m.on('touchend', (e) => end(e.point))

          setReady(true)
        })

        let wasEmpty = container.clientWidth === 0 || container.clientHeight === 0
        observer = new ResizeObserver(() => {
          m.resize()
          setWide((rootRef.current?.clientWidth ?? container.clientWidth) >= 672)
          const empty = container.clientWidth === 0 || container.clientHeight === 0
          if (wasEmpty && !empty) setSizeEpoch((n) => n + 1)
          wasEmpty = empty
        })
        observer.observe(container)
      } catch {
        if (!cancelled) handlersRef.current.onFailure()
      }
    })()

    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
      observer?.disconnect()
      // A WebGL teardown error must never block the route transition away from the map.
      try {
        map?.remove()
      } catch {}
      mapRef.current = null
      setReady(false)
    }
  }, [token])

  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    if (areaMode) {
      m.dragPan.disable()
      m.getCanvas().style.cursor = 'crosshair'
      setCard(null)
    } else {
      m.dragPan.enable()
      m.getCanvas().style.cursor = ''
    }
  }, [ready, areaMode])

  const bizData = useMemo(() => businessesFC(cityId, businesses, selectedSet, area), [cityId, businesses, selectedSet, area])
  const ghostData = useMemo(() => businessesFC(cityId, ghostBusinesses, new Set()), [cityId, ghostBusinesses])
  const selectedData = useMemo(
    () => businessesFC(cityId, businesses.filter((b) => selectedSet.has(b.id)), selectedSet),
    [cityId, businesses, selectedSet],
  )

  const districtStats = useMemo(() => {
    const counts = new Map<string, number>()
    if (useLiveDistricts) {
      for (const feature of liveDistrictFeatures) {
        const id = districtId(feature)
        if (!id) continue
        counts.set(id, liveCountByName.get(districtName(feature).trim())?.n ?? 0)
      }
    } else {
      for (const b of businesses) counts.set(b.districtId, (counts.get(b.districtId) ?? 0) + 1)
    }
    const max = Math.max(1, ...counts.values())
    return { counts, max }
  }, [businesses, liveCountByName, liveDistrictFeatures, useLiveDistricts])

  const overlayData = useMemo(() => {
    const hlDistricts = new Set(districtsKey ? districtsKey.split(',') : [])
    const hlStreets = new Set(streetsKey ? streetsKey.split(',') : [])
    const streetCounts = new Map<string, number>()
    for (const b of businesses) streetCounts.set(b.streetId, (streetCounts.get(b.streetId) ?? 0) + 1)
    const syntheticDistricts = DISTRICTS.filter((d) => d.cityId === cityId)
    const streets = STREETS.filter((s) => s.cityId === cityId && ((streetCounts.get(s.id) ?? 0) >= 3 || hlStreets.has(s.id)))
    const props = (id: string) => {
      const count = districtStats.counts.get(id) ?? 0
      return { id, hl: hlDistricts.has(id) ? 1 : 0, count, t: count / districtStats.max }
    }
    const districts = useLiveDistricts
      ? liveDistrictFeatures.map((feature) => ({ ...feature, properties: { ...(feature.properties ?? {}), ...props(districtId(feature) as string) } }))
      : syntheticDistricts.map((d) => {
          const ring = d.polygon.map((point) => toLngLat(cityId, point))
          return { type: 'Feature' as const, properties: props(d.id), geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]]] } }
        })
    const points = useLiveDistricts
      ? liveDistrictFeatures.flatMap((feature) => {
          const id = districtId(feature)
          const center = polygonCenter(feature.geometry)
          if (!id || !center) return []
          const p = props(id)
          return [{ type: 'Feature' as const, properties: { ...p, name: districtName(feature), countLabel: `${formatNumber(p.count)} منشأة` }, geometry: { type: 'Point' as const, coordinates: center } }]
        })
      : syntheticDistricts.map((d) => {
          const p = props(d.id)
          return { type: 'Feature' as const, properties: { ...p, name: d.name, countLabel: `${formatNumber(p.count)} منشأة` }, geometry: { type: 'Point' as const, coordinates: toLngLat(cityId, d.center) } }
        })
    return {
      districts: { type: 'FeatureCollection', features: districts } satisfies FeatureCollection,
      points: { type: 'FeatureCollection', features: points } satisfies FeatureCollection,
      streets: {
        type: 'FeatureCollection',
        features: streets.map((s) => ({
          type: 'Feature',
          properties: { name: s.name, strong: hlStreets.has(s.id) ? 1 : 0 },
          geometry: { type: 'LineString', coordinates: [toLngLat(cityId, s.from), toLngLat(cityId, s.to)] },
        })),
      } satisfies FeatureCollection,
    }
  }, [cityId, businesses, districtsKey, streetsKey, districtStats, liveDistrictFeatures, useLiveDistricts])

  const areaData = useMemo<FeatureCollection>(() => {
    if (!area) return EMPTY
    const liveRing = area.kind === 'district' ? outerRing(liveDistrictById.get(area.districtId)?.geometry ?? null) : []
    const ring = liveRing.length ? liveRing : areaRing(cityId, area, area.kind === 'district' ? districtById.get(area.districtId)?.polygon : undefined)
    if (ring.length < 3) return EMPTY
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } }] }
  }, [cityId, area, liveDistrictById])

  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    for (const src of BIZ_SOURCES) (m.getSource(src) as GeoJSONSource).setData(bizData)
    ;(m.getSource('ghosts') as GeoJSONSource).setData(ghostData)
    ;(m.getSource('selected') as GeoJSONSource).setData(selectedData)
  }, [ready, bizData, ghostData, selectedData])

  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    ;(m.getSource('districts') as GeoJSONSource).setData(overlayData.districts)
    ;(m.getSource('district-points') as GeoJSONSource).setData(overlayData.points)
    ;(m.getSource('streets') as GeoJSONSource).setData(overlayData.streets)
  }, [ready, overlayData])

  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    ;(m.getSource('area') as GeoJSONSource).setData(areaData)
  }, [ready, areaData])

  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    const vis = (on: boolean) => (on ? 'visible' : 'none')
    const tiered = progressive && layers.districts
    for (const id of DISTRICT_LAYERS) m.setLayoutProperty(id, 'visibility', vis(layers.districts))
    m.setLayoutProperty('district-summary', 'visibility', vis(tiered))
    m.setLayoutProperty('selected-dot', 'visibility', vis(tiered))
    for (const id of ['street-active', 'street-label']) m.setLayoutProperty(id, 'visibility', vis(layers.streets))
    const pinMin = tiered ? DISTRICT_MAX_ZOOM : 0
    for (const suffix of PIN_SUFFIXES) {
      m.setLayoutProperty(`biz-flat-${suffix}`, 'visibility', vis(!layers.clusters))
      m.setLayoutProperty(`biz-clustered-${suffix}`, 'visibility', vis(layers.clusters))
      m.setLayerZoomRange(`biz-flat-${suffix}`, pinMin, 24)
      m.setLayerZoomRange(`biz-clustered-${suffix}`, pinMin, 24)
    }
    for (const id of CLUSTER_LAYERS) {
      m.setLayoutProperty(id, 'visibility', vis(layers.clusters))
      m.setLayerZoomRange(id, pinMin, 24)
    }
    m.setLayerZoomRange('street-active', tiered ? DISTRICT_MAX_ZOOM : 0, 24)
  }, [ready, layers, progressive])

  const focusedId = card?.kind === 'business' ? card.id : ''
  const activeDistrict = card?.kind === 'district' ? card.id : ''
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    for (const src of BIZ_SOURCES) m.setFilter(`${src}-focus`, filter(['all', UNCLUSTERED, ['==', ['get', 'id'], focusedId]]))
    m.setFilter('district-line-active', filter(['==', ['get', 'id'], activeDistrict]))
  }, [ready, focusedId, activeDistrict])

  const fitTo = (bounds: LngLatBounds, animate = true, maxZoom = 15, minZoom = 0) => {
    const m = mapRef.current
    const el = containerRef.current
    if (!m || !el || el.clientWidth === 0) return
    const pad = Math.round(Math.min(72, el.clientWidth / 6, el.clientHeight / 6))
    const padding = { top: pad + 48, bottom: pad, left: pad, right: pad }
    const camera = m.cameraForBounds(bounds, { padding, maxZoom })
    if (!camera) return
    const zoom = Math.max(camera.zoom ?? minZoom, minZoom)
    m.easeTo({ center: camera.center, zoom, duration: animate ? 650 : 0 })
  }

  const compactFitKey = compact ? `${cityId}` : resultsKey
  useEffect(() => {
    if (!ready) return
    const points = (compact ? [...businesses, ...ghostBusinesses] : businesses).map((b) => toLngLat(cityId, [b.x, b.y]))
    const liveBounds = boundsOf(liveDistrictFeatures.flatMap((feature) => outerRing(feature.geometry)))
    fitTo(liveBounds ?? boundsOf(points) ?? cityBounds(cityId))
    // Only refit when the result set, city, or visible size changes — not on selection toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, compactFitKey, sizeEpoch, liveDistrictFeatures])

  const currentAreaKey = areaKey(area)
  useEffect(() => {
    if (!ready || !area) return
    const liveRing = area.kind === 'district' ? outerRing(liveDistrictById.get(area.districtId)?.geometry ?? null) : []
    const ring = liveRing.length ? liveRing : areaRing(cityId, area, area.kind === 'district' ? districtById.get(area.districtId)?.polygon : undefined)
    const b = boundsOf(ring)
    if (b) fitTo(b, true, 15.5)
    setCard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, currentAreaKey, liveDistrictById])

  useEffect(() => {
    setCard(null)
    setAreaMode(false)
  }, [cityId])

  const handledFocusRef = useRef<number | null>(null)
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m || !focusRequest || handledFocusRef.current === focusRequest.nonce) return
    const b = businesses.find((x) => x.id === focusRequest.id) ?? ghostBusinesses.find((x) => x.id === focusRequest.id)
    if (!b) return
    handledFocusRef.current = focusRequest.nonce
    m.flyTo({ center: toLngLat(cityId, [b.x, b.y]), zoom: Math.max(m.getZoom(), 15.2), duration: 700 })
    setCard({ kind: 'business', id: b.id })
  }, [ready, focusRequest, businesses, ghostBusinesses, cityId])

  const inView = useMemo(() => {
    if (!viewBounds) return businesses.length
    const [[w, s], [e, n]] = viewBounds
    return businesses.filter((b) => {
      const [lng, lat] = toLngLat(cityId, [b.x, b.y])
      return lng >= w && lng <= e && lat >= s && lat <= n
    }).length
  }, [viewBounds, businesses, cityId])

  const areaItems = useMemo(() => (area ? businesses.filter((b) => isInArea(cityId, b, area)) : []), [area, businesses, cityId])

  const goToLevel = (l: MapLevel) => {
    const m = mapRef.current
    const target = LEVELS.find((x) => x.id === l)
    if (!m || !target) return
    if (l === 'districts' && !layers.districts) setLayers((s) => ({ ...s, districts: true }))
    if (l === 'clusters' && !layers.clusters) setLayers((s) => ({ ...s, clusters: true }))
    m.easeTo({ zoom: target.zoom, duration: 550 })
  }

  const renderCard = () => {
    if (state !== 'ready' || layersOpen || areaMode) return null
    if (card?.kind === 'business') {
      const b = businesses.find((x) => x.id === card.id) ?? ghostBusinesses.find((x) => x.id === card.id)
      if (!b) return null
      return <BusinessCard business={b} selected={selectedSet.has(b.id)} onClose={() => setCard(null)} onToggle={() => onTogglePin(b.id)} />
    }
    if (card?.kind === 'district') {
      const live = liveDistrictById.get(card.id)
      const d = districtById.get(card.id)
      if (!live && !d) return null
      const name = live ? districtName(live) : d!.name
      const items = d ? businesses.filter((b) => b.districtId === d.id) : []
      const count = districtStats.counts.get(card.id) ?? items.length
      const summary = live ? { count, selected: 0, reachable: liveCountByName.get(name)?.n_whatsapp ?? 0, wholesale: liveCountByName.get(name)?.n_wholesale ?? 0, topCategories: [] } : summarize(items, selectedSet)
      const ring = live ? outerRing(live.geometry) : d!.polygon.map((point) => toLngLat(cityId, point))
      return (
        <DistrictCard
          name={name}
          summary={summary}
          intensity={count / districtStats.max}
          onClose={() => setCard(null)}
          onZoom={() => {
            const b = boundsOf(ring)
            if (b) fitTo(b, true, 13.6, DISTRICT_MAX_ZOOM + 0.4)
            setCard(null)
          }}
          onUseAsArea={() => onAreaChange?.({ kind: 'district', districtId: card.id, label: `حي ${name}` })}
        />
      )
    }
    if (card?.kind === 'cluster') {
      const set = new Set(card.ids)
      const items = businesses.filter((b) => set.has(b.id))
      const names = Array.from(new Set(items.map((b) => districtById.get(b.districtId)?.name).filter(Boolean))) as string[]
      return (
        <ClusterCard
          summary={summarize(items, selectedSet)}
          districtNames={names}
          onClose={() => setCard(null)}
          onZoom={() => {
            mapRef.current?.easeTo({ center: card.center, zoom: Math.max(card.zoom, ENTITY_MIN_ZOOM + 0.3), duration: 600 })
            setCard(null)
          }}
          onSelectAll={() => onSelectMany?.(items.map((b) => b.id))}
        />
      )
    }
    if (area && dismissedArea !== area) {
      return (
        <AreaCard
          label={area.label}
          summary={summarize(areaItems, selectedSet)}
          onClose={() => setDismissedArea(area)}
          onClear={() => onAreaChange?.(null)}
          onSelectAll={() => onSelectMany?.(areaItems.map((b) => b.id))}
          onShowList={onShowList}
        />
      )
    }
    return null
  }

  const cardNode = renderCard()
  const showBootLoading = !ready
  const showRefreshing = ready && state === 'loading'
  const cityName = cityById.get(cityId)?.name ?? ''

  return (
    <div ref={rootRef} className={cn('@container relative isolate overflow-hidden rounded-xl border bg-map-land', className)}>
      <div className="absolute inset-0">
        <div ref={containerRef} className="size-full" role="application" aria-label="خريطة الفرص التفاعلية" />
      </div>

      {drawRect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 rounded-sm border-2 border-dashed border-primary bg-primary/10"
          style={{
            left: Math.min(drawRect.x0, drawRect.x1),
            top: Math.min(drawRect.y0, drawRect.y1),
            width: Math.abs(drawRect.x1 - drawRect.x0),
            height: Math.abs(drawRect.y1 - drawRect.y0),
          }}
        />
      ) : null}

      {!compact && ready && state !== 'empty' ? (
        <div className="absolute top-3 right-3 left-14 z-10 @2xl:left-auto @2xl:w-[min(34rem,calc(100%-5rem))]">
          <MapContextBar
            cityName={cityName}
            level={level}
            progressive={progressive}
            inView={liveSummary?.total ?? inView}
            total={liveSummary?.total ?? businesses.length}
            selected={selectedIds.length}
            areaMode={areaMode}
            areaLabel={area?.label}
            onLevel={goToLevel}
            onToggleAreaMode={() => setAreaMode((v) => !v)}
          />
        </div>
      ) : null}

      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        <div className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          <button type="button" onClick={() => mapRef.current?.zoomIn()} className="p-2 hover:bg-muted" aria-label="تكبير" title="تكبير">
            <Plus className="size-4" />
          </button>
          <button type="button" onClick={() => mapRef.current?.zoomOut()} className="border-t p-2 hover:bg-muted" aria-label="تصغير" title="تصغير">
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const points = businesses.map((b) => toLngLat(cityId, [b.x, b.y]))
              const liveBounds = boundsOf(liveDistrictFeatures.flatMap((feature) => outerRing(feature.geometry)))
              fitTo(liveBounds ?? boundsOf(points) ?? cityBounds(cityId))
              setCard(null)
            }}
            className="border-t p-2 hover:bg-muted"
            aria-label="ملاءمة الخريطة لكل النتائج"
            title="ملاءمة الخريطة لكل النتائج"
          >
            <Scan className="size-4" />
          </button>
        </div>
        <LayersControl layers={layers} defaults={defaultLayers} onChange={setLayers} open={layersOpen} onOpenChange={setLayersOpen} />
      </div>

      {cardNode ? (
        <div
          className={cn(
            'absolute inset-x-3 z-10 transition-[bottom] duration-200 @2xl:right-3 @2xl:bottom-auto @2xl:left-auto @2xl:top-[6.75rem] @2xl:w-80',
            reserveBottom ? 'bottom-[7.5rem] @2xl:bottom-auto' : 'bottom-3',
          )}
        >
          {cardNode}
        </div>
      ) : null}

      {ready && state === 'ready' && (wide || !cardNode) ? (
        <div className={cn('absolute right-3 z-[5] w-48 transition-[bottom] duration-200', reserveBottom ? 'bottom-[7.5rem] @2xl:bottom-[5.25rem]' : 'bottom-3')}>
          <MapLegend
            level={level}
            open={legendOpen && wide}
            onOpenChange={setLegendOpen}
            hasArea={!!area}
            hasGhosts={ghostBusinesses.length > 0}
            showStreets={layers.streets}
          />
        </div>
      ) : null}

      {showRefreshing ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-20 flex justify-center" role="status">
          <span className="flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-xs font-medium shadow-sm">
            <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
            جارٍ تحديث النتائج…
          </span>
        </div>
      ) : null}

      {showBootLoading ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-map-land" role="status">
          <div className="grid grid-cols-3 gap-1.5 opacity-60" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="h-8 w-12 animate-pulse rounded-md bg-primary/10" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
          <span className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-sm">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            جارٍ تحميل الخريطة الحية…
          </span>
        </div>
      ) : null}

      {state === 'empty' && ready ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-map-land/60 p-4 backdrop-blur-[1px]">
          <div className="flex max-w-xs flex-col items-center gap-2 rounded-xl border bg-card p-5 text-center shadow-sm">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted">
              {compact ? <MapPinOff className="size-5 text-muted-foreground" aria-hidden /> : <SearchX className="size-5 text-muted-foreground" aria-hidden />}
            </span>
            <p className="font-semibold">{compact ? 'لا توجد منشآت في هذه المسودة' : 'لا توجد نتائج مطابقة'}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {compact ? 'أضف منشآت من المرشحين على الخريطة.' : `لم نجد منشآت تطابق المعايير في ${cityName}. جرّب توسيع النطاق أو إزالة بعض الفلاتر.`}
            </p>
            {onResetFilters ? (
              <Button variant="outline" size="sm" onClick={onResetFilters}>
                مسح الفلاتر
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
