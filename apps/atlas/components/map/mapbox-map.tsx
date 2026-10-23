'use client'

import 'mapbox-gl/dist/mapbox-gl.css'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { Feature, FeatureCollection, Geometry, Point as GeoPoint, Position } from 'geojson'
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapboxMap, VectorTileSource } from 'mapbox-gl'
import { Loader2, MapPinOff, Minus, Plus, Scan, SearchX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import { areaKey, areaRing, boundsOf, cityBounds, isInArea, toLngLat, type LngLatBounds, type MapArea } from '@/lib/geo'
import { DISTRICT_MAX_ZOOM, ENTITY_MIN_ZOOM, LEVELS, STREET_MIN_ZOOM, summarize, type MapLevel } from '@/lib/map-summary'
import { cityById, districtById } from '@/lib/mock-data'
import type { DistrictCount, MarketCluster, MarketSummary, StreetDensityProperties } from '@/lib/live-market'
import type { Business } from '@/lib/types'
import { normalizeArabic } from '@/lib/search'
import { mapIconImageId, mapPinSvg, resolveMapIcon, svgToImage } from '@/lib/map-icons'
import { directoryRenderMode } from '@/lib/directory-render-mode'
import type { DirectoryLoadState } from '@/components/opportunity/live-entity-results'
import type { DirectorySummary } from '@/components/opportunity/live-entity-results'
import { cn } from '@/lib/utils'
import { DEFAULT_LAYERS, LayersControl, type LayerState } from './layers-control'
import { AreaCard, BusinessCard, ClusterCard, DistrictCard, LiveEntityCard, MapContextBar, MapLegend, MarketClusterCard, MarketStreetCard } from './map-overlays'
import type { MockMapProps } from './mock-map'

const COLORS = {
  // Official FARQ green, shared with the Atlas wordmark and application UI.
  primary: '#008060',
  primarySoft: '#e3f1ec',
  card: '#fffefb',
  foreground: '#161816',
  muted: '#5f655f',
}
const STYLE_URL = 'mapbox://styles/mapbox/light-v11'
const FONT = ['DIN Pro Medium', 'Arial Unicode MS Regular']
const FONT_BOLD = ['DIN Pro Bold', 'Arial Unicode MS Bold']
const LOAD_TIMEOUT_MS = 20000
const MARKET_OVERVIEW_LIMIT = 16
const MARKET_DISTRICT_LABEL_LIMIT = 10
// POIs help orient a user only when they are close enough to make a local
// decision. Keeping them off at wider levels preserves the market signal.
const POI_MIN_ZOOM = ENTITY_MIN_ZOOM

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const BIZ_SOURCES = ['biz-flat', 'biz-clustered'] as const
const PIN_SUFFIXES = ['focus', 'pin', 'dot'] as const
const BUSINESS_CLUSTER_LAYERS = ['cluster-halo', 'cluster', 'cluster-count', 'cluster-badge', 'cluster-badge-count']
const MARKET_CLUSTER_LAYERS = ['market-cluster-halo', 'market-cluster', 'market-cluster-count', 'market-cluster-leaf', 'market-cluster-leaf-count']
const CLUSTER_LAYERS = [...BUSINESS_CLUSTER_LAYERS, ...MARKET_CLUSTER_LAYERS]
const MARKET_STREET_LAYERS = ['market-street-hit', 'market-street-line', 'market-street-label']
const DISTRICT_LAYERS = ['district-heat', 'district-line', 'district-line-hl', 'district-line-active', 'district-label']
const DIRECTORY_TILE_LAYERS = ['directory-tile-cluster', 'directory-tile-cluster-count', 'directory-tile-pin', 'directory-tile-name']

const expr = (x: unknown) => x as ExpressionSpecification
const filter = (x: unknown) => x as FilterSpecification
const isOn = (key: string) => expr(['==', ['get', key], 1])
const UNCLUSTERED = filter(['!', ['has', 'point_count']])
const CLUSTERED = filter(['has', 'point_count'])
const FADED = (on: number, off: number) => expr(['case', isOn('out'), off, on])

type Card =
  | { kind: 'business'; id: string }
  | { kind: 'district'; id: string }
  | { kind: 'cluster'; ids: string[]; center: [number, number]; zoom: number }
  | { kind: 'market-cluster'; label: string; count: number; wholesale: number; district?: string; center: [number, number] }
  | { kind: 'market-street'; label: string; count: number; wholesale: number; district?: string }
  | { kind: 'live-entity'; id: string }
  | { kind: 'tile-entity'; id: string; name: string; nonce: number }
  | null

export interface MapboxMapProps extends MockMapProps {
  token: string
  onFailure: () => void
  /** Brings a live district from the market summary into map focus. */
  focusDistrictRequest?: { name: string; nonce: number } | null
  focusStreetRequest?: { street: string; district?: string; nonce: number } | null
  /** Aggregated interaction signal with no customer data. */
  onDetailLevelChange?: (level: MapLevel) => void
  /** Measures exploration of aggregate market insight, without names or coordinates. */
  onMarketInsightOpened?: (insight: { kind: 'cluster' | 'street'; count: number }) => void
  /** Server-proxied aggregate market data. Never contains contacts or send actions. */
  liveDistricts?: FeatureCollection
  liveCounts?: DistrictCount[]
  liveSummary?: MarketSummary['summary']
  /** Read-only aggregate street geometry. */
  liveStreets?: FeatureCollection<Geometry, StreetDensityProperties>
  /** Read-only geographically aggregated opportunities. */
  liveClusters?: MarketCluster[]
  /** Authenticated directory matches. These are only rendered at entity zoom. */
  liveEntityPins?: readonly { id: string; name: string; category: string; specialties?: readonly string[]; district: string; street: string; whatsapp: boolean; reason: string; latitude: number | null; longitude: number | null }[]
  /** A selected district has loaded every safe directory point client-side. */
  liveEntityPinsComplete?: boolean
  /** Exact count of the authenticated directory cohort used by the tile source. */
  liveDirectorySummary?: DirectorySummary | null
  liveEntityState?: DirectoryLoadState
  /** Opaque short-lived cohort returned by the authenticated directory endpoint. */
  liveMapQuery?: string | null
  /** Short-lived proof for map workers that cannot forward cookies. */
  liveTileAccess?: string | null
  onLiveEntityResolved?: (entity: import('@/components/opportunity/live-entity-results').LiveEntity) => void
  /** Map extent after a completed move; used to refresh aggregate analytics only. */
  onViewportChange?: (bounds: [number, number, number, number]) => void
}

function levelFor(zoom: number, progressive: boolean, layers: LayerState): MapLevel {
  if (progressive && layers.districts && zoom < DISTRICT_MAX_ZOOM) return 'districts'
  if (layers.clusters && zoom < STREET_MIN_ZOOM) return 'clusters'
  if (layers.streets && zoom < ENTITY_MIN_ZOOM) return 'streets'
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
  for (const id of ['districts', 'district-points', 'streets', 'market-streets', 'ghosts', 'biz-flat', 'selected', 'area']) {
    map.addSource(id, { type: 'geojson', data: EMPTY })
  }
  map.addSource('live-entities', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 54, clusterMaxZoom: ENTITY_MIN_ZOOM })
  // The targeting service already returns geographically aggregated street
  // opportunities. Rendering those records directly keeps each visible point
  // truthful and clickable; clustering them again can hide all activity at
  // the exact zoom where users expect to inspect it.
  map.addSource('market-clusters', { type: 'geojson', data: EMPTY })
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
    minzoom: ENTITY_MIN_ZOOM + 0.45,
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11 },
    paint: { 'text-color': COLORS.primary, 'text-halo-color': COLORS.card, 'text-halo-width': 1.5 },
  })

  map.addLayer({
    // Keep the visual line calm, while making the whole street easy to tap or click.
    // A dense map should not require pixel-perfect interaction with a 2–5px line.
    id: 'market-street-hit',
    type: 'line',
    source: 'market-streets',
    minzoom: DISTRICT_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COLORS.primary, 'line-opacity': 0.001, 'line-width': 22 },
  })
  map.addLayer({
    id: 'market-street-line',
    type: 'line',
    source: 'market-streets',
    minzoom: DISTRICT_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': COLORS.primary,
      'line-opacity': expr(['interpolate', ['linear'], ['coalesce', ['get', 'lift'], 0], 0, 0.28, 1, 0.86]),
      'line-width': expr(['interpolate', ['linear'], ['coalesce', ['get', 'n'], 0], 1, 1.75, 80, 5.5]),
    },
  })
  map.addLayer({
    id: 'market-street-label',
    type: 'symbol',
    source: 'market-streets',
    minzoom: ENTITY_MIN_ZOOM + 0.45,
    filter: filter(['>=', ['coalesce', ['get', 'n'], 0], 20]),
    layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'street_ar'], ['get', 'label_ar']], 'text-font': FONT, 'text-size': 11 },
    paint: { 'text-color': COLORS.primary, 'text-halo-color': COLORS.card, 'text-halo-width': 1.5 },
  })

  // `market-clusters` already contains server-side aggregate opportunities.
  // Treat each record as one truthful signal. Applying Mapbox clustering here
  // would either hide it or produce a second aggregation layer.
  const marketSignal = filter(['>', ['coalesce', ['get', 'n'], 0], 0])
  const noMarketSignal = filter(['<', ['coalesce', ['get', 'n'], 0], 0])
  map.addLayer({
    id: 'market-cluster-halo',
    type: 'circle',
    source: 'market-clusters',
    minzoom: DISTRICT_MAX_ZOOM,
    maxzoom: ENTITY_MIN_ZOOM + 0.75,
    filter: marketSignal,
    paint: { 'circle-radius': expr(['+', ['interpolate', ['linear'], ['coalesce', ['get', 'n'], 0], 1, 14, 100, 24, 1000, 32], 6]), 'circle-color': COLORS.primary, 'circle-opacity': 0.13 },
  })
  map.addLayer({
    id: 'market-cluster',
    type: 'circle',
    source: 'market-clusters',
    minzoom: DISTRICT_MAX_ZOOM,
    maxzoom: ENTITY_MIN_ZOOM + 0.75,
    filter: marketSignal,
    paint: {
      'circle-radius': expr(['interpolate', ['linear'], ['coalesce', ['get', 'n'], 0], 1, 14, 100, 24, 1000, 32]),
      'circle-color': COLORS.card,
      'circle-stroke-color': COLORS.primary,
      'circle-stroke-width': 2.25,
    },
  })
  map.addLayer({
    id: 'market-cluster-count',
    type: 'symbol',
    source: 'market-clusters',
    minzoom: DISTRICT_MAX_ZOOM,
    maxzoom: ENTITY_MIN_ZOOM + 0.75,
    filter: marketSignal,
    // The overview contains a deliberately capped number of signal markers,
    // so the count can safely remain inside every visible circle.
    layout: { 'text-field': ['to-string', ['coalesce', ['get', 'n'], 0]], 'text-font': FONT_BOLD, 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': COLORS.primary },
  })
  map.addLayer({
    id: 'market-cluster-leaf',
    type: 'circle',
    source: 'market-clusters',
    minzoom: DISTRICT_MAX_ZOOM,
    maxzoom: ENTITY_MIN_ZOOM + 0.75,
    filter: noMarketSignal,
    paint: {
      'circle-radius': 12,
      'circle-color': COLORS.card,
      'circle-stroke-color': COLORS.primary,
      'circle-stroke-width': 2,
    },
  })
  map.addLayer({
    id: 'market-cluster-leaf-count',
    type: 'symbol',
    source: 'market-clusters',
    minzoom: DISTRICT_MAX_ZOOM,
    maxzoom: ENTITY_MIN_ZOOM + 0.75,
    filter: noMarketSignal,
    layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': FONT_BOLD, 'text-size': 11, 'text-allow-overlap': false },
    paint: { 'text-color': COLORS.primary },
  })

  // District density belongs to the polygon, not a wall of text. Labels appear only
  // once the user zooms in, and Mapbox collision detection keeps them readable.
  map.addLayer({
    id: 'district-summary',
    type: 'symbol',
    source: 'district-points',
    minzoom: 11.6,
    maxzoom: DISTRICT_MAX_ZOOM,
    filter: filter(['all', ['>', ['get', 'count'], 0], ['<=', ['get', 'labelRank'], MARKET_DISTRICT_LABEL_LIMIT]]),
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
    filter: filter(['all', ['>', ['get', 'count'], 0], ['<=', ['get', 'labelRank'], MARKET_DISTRICT_LABEL_LIMIT]]),
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

  // Directory points follow the same progressive disclosure as Google Maps:
  // a count cluster when zoomed out, then individual searchable establishments
  // only when the user is close enough to act on a specific location.
  map.addLayer({
    id: 'live-entity-cluster',
    type: 'circle',
    source: 'live-entities',
    minzoom: 10,
    filter: CLUSTERED,
    paint: { 'circle-radius': expr(['interpolate', ['linear'], ['get', 'point_count'], 2, 15, 50, 23, 500, 31]), 'circle-color': COLORS.card, 'circle-stroke-color': COLORS.primary, 'circle-stroke-width': 2.5 },
  })
  map.addLayer({
    id: 'live-entity-cluster-count',
    type: 'symbol',
    source: 'live-entities',
    minzoom: 10,
    filter: CLUSTERED,
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT_BOLD, 'text-size': 12 },
    paint: { 'text-color': COLORS.primary },
  })
  map.addLayer({
    id: 'live-entity-halo',
    type: 'circle',
    source: 'live-entities',
    minzoom: ENTITY_MIN_ZOOM,
    filter: UNCLUSTERED,
    paint: { 'circle-radius': expr(['case', isOn('selected'), 11, 9]), 'circle-color': COLORS.primary, 'circle-opacity': expr(['case', isOn('selected'), 0.25, 0.14]) },
  })
  map.addLayer({
    id: 'live-entity-pin',
    type: 'circle',
    source: 'live-entities',
    minzoom: ENTITY_MIN_ZOOM,
    filter: UNCLUSTERED,
    paint: { 'circle-radius': expr(['case', isOn('selected'), 6.5, 5]), 'circle-color': expr(['case', isOn('selected'), COLORS.primary, COLORS.card]), 'circle-stroke-color': expr(['case', isOn('selected'), COLORS.card, COLORS.primary]), 'circle-stroke-width': 2.5 },
  })
  // The point carries the icon chosen from Farq's commercial taxonomy. The
  // artwork is registered lazily only for activities present in this view.
  // Clustering remains responsible for dense areas; a person sees an actual
  // activity marker only when zooming close enough to act on the location.
  map.addLayer({
    id: 'live-entity-icon',
    type: 'symbol',
    source: 'live-entities',
    minzoom: ENTITY_MIN_ZOOM,
    filter: filter(['all', UNCLUSTERED, ['==', ['get', 'selected'], 0]]),
    layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.9, 'icon-anchor': 'bottom', 'icon-allow-overlap': false, 'icon-ignore-placement': false },
  })
  map.addLayer({
    id: 'live-entity-icon-selected',
    type: 'symbol',
    source: 'live-entities',
    minzoom: ENTITY_MIN_ZOOM,
    filter: filter(['all', UNCLUSTERED, ['==', ['get', 'selected'], 1]]),
    layout: { 'icon-image': ['get', 'icon_selected'], 'icon-size': 0.98, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
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
function addDirectoryTileLayers(map: MapboxMap) {
  const source = 'directory-tiles'
  const vectorLayer = 'businesses'
  map.addLayer({
    id: 'directory-tile-cluster', type: 'circle', source, 'source-layer': vectorLayer, minzoom: 10, maxzoom: ENTITY_MIN_ZOOM + 0.5,
    filter: filter(['>', ['coalesce', ['get', 'count'], 0], 1]),
    paint: { 'circle-radius': expr(['interpolate', ['linear'], ['coalesce', ['get', 'count'], 1], 2, 15, 50, 23, 500, 31]), 'circle-color': COLORS.card, 'circle-stroke-color': COLORS.primary, 'circle-stroke-width': 2.5 },
  })
  map.addLayer({
    id: 'directory-tile-cluster-count', type: 'symbol', source, 'source-layer': vectorLayer, minzoom: 10, maxzoom: ENTITY_MIN_ZOOM + 0.5,
    filter: filter(['>', ['coalesce', ['get', 'count'], 0], 1]),
    layout: { 'text-field': ['to-string', ['get', 'count']], 'text-font': FONT_BOLD, 'text-size': 12 }, paint: { 'text-color': COLORS.primary },
  })
  map.addLayer({
    id: 'directory-tile-pin', type: 'circle', source, 'source-layer': vectorLayer, minzoom: ENTITY_MIN_ZOOM,
    filter: filter(['==', ['coalesce', ['get', 'count'], 0], 1]),
    paint: { 'circle-radius': 5, 'circle-color': COLORS.card, 'circle-stroke-color': COLORS.primary, 'circle-stroke-width': 2.5 },
  })
  map.addLayer({
    id: 'directory-tile-name', type: 'symbol', source, 'source-layer': vectorLayer, minzoom: ENTITY_MIN_ZOOM + 0.65,
    filter: filter(['==', ['coalesce', ['get', 'count'], 0], 1]),
    layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-max-width': 12 },
    paint: { 'text-color': COLORS.foreground, 'text-halo-color': COLORS.card, 'text-halo-width': 1.5 },
  })
}

function removeDirectoryTileSource(map: MapboxMap) {
  for (const id of DIRECTORY_TILE_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource('directory-tiles')) map.removeSource('directory-tiles')
}

function calmBasemap(map: MapboxMap) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (/poi|transit|airport|ferry|aerialway/.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none')
    else if (layer.type === 'symbol' && /road/.test(layer.id)) map.setPaintProperty(layer.id, 'text-opacity', 0.6)
  }
}

/** Reveal Mapbox POIs only at the entity-detail level, never in market overview. */
function syncPoiVisibility(map: MapboxMap, zoom: number) {
  const visibility = zoom >= POI_MIN_ZOOM ? 'visible' : 'none'
  for (const layer of map.getStyle()?.layers ?? []) {
    if (!/poi/.test(layer.id)) continue
    try {
      map.setLayoutProperty(layer.id, 'visibility', visibility)
    } catch {
      // A basemap layer can disappear after a style update; it is safe to skip it.
    }
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
  liveStreets,
  liveClusters = [],
  liveEntityPins = [],
  liveEntityPinsComplete = false,
  liveDirectorySummary = null,
  liveEntityState = 'idle',
  liveMapQuery = null,
  liveTileAccess = null,
  onLiveEntityResolved,
  focusDistrictRequest,
  focusStreetRequest,
  onDetailLevelChange,
  onMarketInsightOpened,
  onViewportChange,
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
  const [pendingLevel, setPendingLevel] = useState<MapLevel | null>(null)
  const [viewBounds, setViewBounds] = useState<LngLatBounds | null>(null)
  const [areaMode, setAreaMode] = useState(false)
  const [dismissedArea, setDismissedArea] = useState<object | null>(null)
  const [drawRect, setDrawRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [wide, setWide] = useState(true)
  const [tileProfiles, setTileProfiles] = useState<Record<string, import('@/components/opportunity/live-entity-results').LiveEntity>>({})
  const [tileProfileError, setTileProfileError] = useState<string | null>(null)
  const tileActionRef = useRef<number | null>(null)
  const reduceMotion = useReducedMotion()

  const level = levelFor(zoom, progressive, layers)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const liveDirectoryMode = directoryRenderMode({ mapQuery: liveMapQuery, pinCount: liveEntityPins.length, pinsComplete: liveEntityPinsComplete })
  const liveDistrictFeatures = useMemo(() => (liveDistricts?.features ?? []).filter((feature): feature is Feature<Geometry> => Boolean(feature?.geometry && districtId(feature))), [liveDistricts])
  // Aggregate refreshes replace the GeoJSON object even when the visible
  // district boundaries are unchanged. Keep a stable geometry identity for
  // camera decisions so an updated count cannot trigger moveend → viewport
  // fetch → aggregate refresh indefinitely.
  const liveDistrictGeometryKey = useMemo(
    () => liveDistrictFeatures.map((feature) => districtId(feature) as string).sort().join(','),
    [liveDistrictFeatures],
  )
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
    onMarketInsightOpened,
    onViewportChange,
  })
  useEffect(() => {
    handlersRef.current = { onTogglePin, onFailure, onAreaChange, cityId, areaMode, progressive, onMarketInsightOpened, onViewportChange }
  })
  const initialCityRef = useRef(cityId)

  const districtsKey = highlightDistricts.join(',')
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
          // Vector tiles are served from the authenticated Atlas route. Mapbox
          // fetches them from a worker, so make same-origin session delivery
          // explicit instead of relying on the browser default.
          transformRequest: (url, resourceType) => resourceType === 'Tile' && url.startsWith('/api/market/tiles/')
            ? { url, credentials: 'include' }
            : { url },
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
          const nextZoom = m.getZoom()
          syncPoiVisibility(m, nextZoom)
          setZoom(nextZoom)
          setPendingLevel(null)
          const b = m.getBounds()
          if (b) {
            const nextBounds: LngLatBounds = [b.getSouthWest().toArray() as [number, number], b.getNorthEast().toArray() as [number, number]]
            setViewBounds(nextBounds)
            handlersRef.current.onViewportChange?.([nextBounds[0][0], nextBounds[0][1], nextBounds[1][0], nextBounds[1][1]])
          }
        }

        m.on('load', () => {
          if (timeout) clearTimeout(timeout)
          calmBasemap(m)
          addLayers(m)
          m.on('moveend', syncView)
          syncView()

          const hit = (ids: string[], point: { x: number; y: number }, hitRadius = 0) => {
            const visible = ids.filter((id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none')
            if (!visible.length) return undefined
            const exact = m.queryRenderedFeatures([point.x, point.y], { layers: visible })[0]
            if (exact || !hitRadius) return exact
            // Mapbox symbol hitboxes can be narrower than the visible count badge,
            // especially on touch screens. Use a small, cluster-only fallback area
            // so the displayed circle always behaves like a usable control.
            return m.queryRenderedFeatures([
              [point.x - hitRadius, point.y - hitRadius],
              [point.x + hitRadius, point.y + hitRadius],
            ], { layers: visible })[0]
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
            const tileCluster = hit(['directory-tile-cluster-count', 'directory-tile-cluster'], e.point, 20)
            if (tileCluster) {
              const center = (tileCluster.geometry as GeoPoint).coordinates as [number, number]
              m.easeTo({ center, zoom: Math.min(ENTITY_MIN_ZOOM + 0.8, m.getZoom() + 1.4), duration: 500 })
              return
            }
            const tilePin = hit(['directory-tile-pin'], e.point, 12)
            const tileId = tilePin?.properties?.key
            if (typeof tileId === 'string' && tileId) {
              setCard({ kind: 'tile-entity', id: tileId, name: typeof tilePin?.properties?.name === 'string' ? tilePin.properties.name : 'منشأة', nonce: Date.now() })
              return
            }
            const liveCluster = hit(['live-entity-cluster-count', 'live-entity-cluster'], e.point, 20)
            const liveClusterId = liveCluster?.properties?.cluster_id
            if (liveCluster && typeof liveClusterId === 'number') {
              const source = m.getSource('live-entities') as GeoJSONSource
              const center = (liveCluster.geometry as GeoPoint).coordinates as [number, number]
              source.getClusterExpansionZoom(liveClusterId, (error, nextZoom) => {
                if (!error && nextZoom != null) m.easeTo({ center, zoom: Math.max(nextZoom, m.getZoom() + 0.8), duration: 500 })
              })
              return
            }
            const livePin = hit(['live-entity-icon-selected', 'live-entity-icon', 'live-entity-pin'], e.point)
            const liveId = livePin?.properties?.id
            if (typeof liveId === 'string') {
              h.onTogglePin(liveId)
              setCard({ kind: 'live-entity', id: liveId })
              return
            }
            const pin = hit(['biz-clustered-pin', 'biz-flat-pin', 'ghost'], e.point)
            const pinId = pin?.properties?.id
            if (typeof pinId === 'string') {
              h.onTogglePin(pinId)
              setCard({ kind: 'business', id: pinId })
              return
            }
            // Market streets remain visible as context at the cluster level.
            // Resolve a cluster first so an overlapping street cannot steal the
            // interaction intended to reveal that cluster.
            // The visible count is rendered in its own symbol layer. Include it in
            // hit testing so clicking the number always opens the cluster summary,
            // even where a street line runs directly beneath the badge.
            const marketCluster = hit(['market-cluster-count', 'market-cluster-leaf-count', 'market-cluster', 'market-cluster-leaf'], e.point, 20)
            if (marketCluster) {
              const properties = marketCluster.properties ?? {}
              const center = (marketCluster.geometry as GeoPoint).coordinates as [number, number]
              const count = typeof properties.opportunityCount === 'number' ? properties.opportunityCount : typeof properties.n === 'number' ? properties.n : 0
              h.onMarketInsightOpened?.({ kind: 'cluster', count })
              setCard({
                kind: 'market-cluster',
                label: typeof properties.label_ar === 'string' ? properties.label_ar : 'تجمع فرص في هذه المنطقة',
                count,
                wholesale: typeof properties.wholesaleCount === 'number' ? properties.wholesaleCount : typeof properties.n_wholesale === 'number' ? properties.n_wholesale : 0,
                district: typeof properties.district_ar === 'string' ? properties.district_ar : undefined,
                center,
              })
              return
            }
            const marketStreet = hit(['market-street-hit', 'market-street-line'], e.point)
            if (marketStreet) {
              const properties = marketStreet.properties ?? {}
              const count = typeof properties.n === 'number' ? properties.n : 0
              h.onMarketInsightOpened?.({ kind: 'street', count })
              setCard({
                kind: 'market-street',
                label: typeof properties.street_ar === 'string' ? properties.street_ar : typeof properties.label_ar === 'string' ? properties.label_ar : 'شارع نشاط',
                count,
                wholesale: typeof properties.n_wholesale === 'number' ? properties.n_wholesale : 0,
                district: typeof properties.district_ar === 'string' ? properties.district_ar : undefined,
              })
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

          const pointerLayers = ['biz-flat-pin', 'biz-clustered-pin', 'live-entity-cluster', 'live-entity-cluster-count', 'live-entity-pin', 'live-entity-icon', 'live-entity-icon-selected', 'ghost', 'cluster', 'market-cluster', 'market-cluster-count', 'market-cluster-leaf', 'market-cluster-leaf-count', 'market-street-hit']
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
    // A paged directory starts with only a small first page. Keep the private
    // vector-tile cohort visible until all pages arrive, then switch once to
    // the exact direct pins. Removing tiles on page one made large districts
    // appear to load a few hundred points at a time.
    if (liveDirectoryMode !== 'tiles' || !liveMapQuery) {
      removeDirectoryTileSource(m)
      return
    }
    const access = liveTileAccess ? `?access=${encodeURIComponent(liveTileAccess)}` : ''
    const tiles = [`/api/market/tiles/${liveMapQuery}/{z}/{x}/{y}.pbf${access}`]
    const source = m.getSource('directory-tiles') as VectorTileSource | undefined
    if (source) source.setTiles(tiles)
    else {
      m.addSource('directory-tiles', { type: 'vector', tiles, minzoom: 0, maxzoom: 20 })
      addDirectoryTileLayers(m)
    }
  }, [ready, liveDirectoryMode, liveMapQuery, liveTileAccess])

  useEffect(() => {
    if (card?.kind !== 'tile-entity' || !liveMapQuery || tileActionRef.current === card.nonce) return
    tileActionRef.current = card.nonce
    const cached = tileProfiles[card.id]
    const controller = new AbortController()
    setTileProfileError(null)
    const resolve = (entity: import('@/components/opportunity/live-entity-results').LiveEntity) => {
      setTileProfiles((current) => ({ ...current, [entity.id]: entity }))
      onLiveEntityResolved?.(entity)
      onTogglePin(entity.id)
    }
    if (cached) { resolve(cached); return () => controller.abort() }
    fetch('/api/market/map-profile', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ query: liveMapQuery, poiKey: card.id }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as { entity?: import('@/components/opportunity/live-entity-results').LiveEntity; error?: string } | null
      if (!response.ok || !payload?.entity) throw new Error(payload?.error || 'تعذر تحميل بيانات المنشأة.')
      resolve(payload.entity)
    }).catch((error) => {
      if (!controller.signal.aborted) setTileProfileError(error instanceof Error ? error.message : 'تعذر تحميل بيانات المنشأة.')
    })
    return () => controller.abort()
  }, [card, liveMapQuery, onLiveEntityResolved, onTogglePin, tileProfiles])

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

  const liveEntityData = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: liveEntityPins.flatMap((entity) => entity.latitude != null && entity.longitude != null ? [{
      type: 'Feature' as const,
      properties: (() => {
        const marker = resolveMapIcon({ category: entity.category, specialties: entity.specialties })
        return {
          id: entity.id,
          name: entity.name,
          category: entity.category,
          district: entity.district,
          street: entity.street,
          whatsapp: entity.whatsapp ? 1 : 0,
          reason: entity.reason,
          selected: selectedSet.has(entity.id) ? 1 : 0,
          icon: mapIconImageId(marker.icon),
          icon_selected: mapIconImageId(marker.icon, true),
        }
      })(),
      geometry: { type: 'Point' as const, coordinates: [entity.longitude, entity.latitude] },
    }] : []),
  }), [liveEntityPins, selectedSet])

  const liveMarkerIcons = useMemo(() => {
    const icons = new Set<string>()
    for (const entity of liveEntityPins) icons.add(resolveMapIcon({ category: entity.category, specialties: entity.specialties }).icon)
    return [...icons]
  }, [liveEntityPins])

  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m || !liveMarkerIcons.length) return
    let cancelled = false
    Promise.all(liveMarkerIcons.flatMap((icon) => [
      svgToImage(mapPinSvg(icon)),
      svgToImage(mapPinSvg(icon, true)),
    ])).then((images) => {
      if (cancelled || !m.isStyleLoaded()) return
      for (let index = 0; index < liveMarkerIcons.length; index += 1) {
        const icon = liveMarkerIcons[index]
        const regularId = mapIconImageId(icon)
        const selectedId = mapIconImageId(icon, true)
        if (!m.hasImage(regularId)) m.addImage(regularId, images[index * 2])
        if (!m.hasImage(selectedId)) m.addImage(selectedId, images[index * 2 + 1])
      }
      // Existing GeoJSON features are re-evaluated as soon as Mapbox receives
      // their images, so no additional request or client data is needed here.
    }).catch(() => {
      // The underlying point layer remains interactive if an icon asset cannot
      // be decoded; a rendering enhancement must never hide live entities.
    })
    return () => { cancelled = true }
  }, [ready, liveMarkerIcons])

  const liveStreetData = useMemo<FeatureCollection<Geometry, StreetDensityProperties>>(() => liveStreets ?? (EMPTY as FeatureCollection<Geometry, StreetDensityProperties>), [liveStreets])
  const liveClusterData = useMemo<FeatureCollection>(() => {
    // The overview is a decision surface, not a full directory. Keep the most
    // substantial groups visible here; smaller activity becomes available at
    // the street level without turning the map into a wall of markers.
    const prominentClusters = liveClusters
      .filter((cluster) => typeof cluster.lon === 'number' && typeof cluster.lat === 'number')
      .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
      .slice(0, MARKET_OVERVIEW_LIMIT)

    return {
      type: 'FeatureCollection',
      features: prominentClusters.map((cluster) => ({
        type: 'Feature' as const,
        properties: {
          label_ar: cluster.label_ar ?? cluster.street_ar ?? cluster.district_ar ?? 'تجمع فرص',
          n: cluster.n ?? 0,
          n_wholesale: cluster.n_wholesale ?? 0,
          ...(cluster.district_ar ? { district_ar: cluster.district_ar } : {}),
        },
        geometry: { type: 'Point' as const, coordinates: [cluster.lon!, cluster.lat!] },
      })),
    }
  }, [liveClusters])

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
    const rankedDistrictIds = [...districtStats.counts.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([id]) => id)
    const districtRank = new Map(rankedDistrictIds.map((id, index) => [id, index + 1]))
    const props = (id: string) => {
      const count = districtStats.counts.get(id) ?? 0
      return {
        id,
        hl: hlDistricts.has(id) ? 1 : 0,
        count,
        t: count / districtStats.max,
        // A map can show hundreds of boundaries, but only the densest few
        // need a label at overview zoom. Every other district stays clickable.
        labelRank: districtRank.get(id) ?? Number.MAX_SAFE_INTEGER,
      }
    }
    // Never replace unavailable live boundaries with illustrative geometry:
    // that would visually present invented areas as a real data layer.
    const districts = liveDistrictFeatures.map((feature) => ({ ...feature, properties: { ...(feature.properties ?? {}), ...props(districtId(feature) as string) } }))
    const points = liveDistrictFeatures.flatMap((feature) => {
      const id = districtId(feature)
      const center = polygonCenter(feature.geometry)
      if (!id || !center) return []
      const p = props(id)
      return [{ type: 'Feature' as const, properties: { ...p, name: districtName(feature), countLabel: `${formatNumber(p.count)} منشأة` }, geometry: { type: 'Point' as const, coordinates: center } }]
    })
    return {
      districts: { type: 'FeatureCollection', features: districts } satisfies FeatureCollection,
      points: { type: 'FeatureCollection', features: points } satisfies FeatureCollection,
      streets: {
        type: 'FeatureCollection',
        features: [],
      } satisfies FeatureCollection,
    }
  }, [districtsKey, districtStats, liveDistrictFeatures])

  const areaData = useMemo<FeatureCollection>(() => {
    if (!area) return EMPTY
    const ring = area.kind === 'district'
      ? outerRing(liveDistrictById.get(area.districtId)?.geometry ?? null)
      : areaRing(cityId, area)
    if (ring.length < 3) return EMPTY
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } }] }
  }, [area, liveDistrictById])

  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    for (const src of BIZ_SOURCES) (m.getSource(src) as GeoJSONSource).setData(bizData)
    ;(m.getSource('ghosts') as GeoJSONSource).setData(ghostData)
    ;(m.getSource('selected') as GeoJSONSource).setData(selectedData)
    ;(m.getSource('live-entities') as GeoJSONSource).setData(liveEntityData)
    ;(m.getSource('market-streets') as GeoJSONSource).setData(liveStreetData)
    ;(m.getSource('market-clusters') as GeoJSONSource).setData(liveClusterData)
  }, [ready, bizData, ghostData, selectedData, liveEntityData, liveStreetData, liveClusterData])

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
    for (const id of ['street-active', 'street-label', ...MARKET_STREET_LAYERS]) m.setLayoutProperty(id, 'visibility', vis(layers.streets))
    const pinMin = tiered ? DISTRICT_MAX_ZOOM : 0
    for (const suffix of PIN_SUFFIXES) {
      m.setLayoutProperty(`biz-flat-${suffix}`, 'visibility', vis(!layers.clusters))
      m.setLayoutProperty(`biz-clustered-${suffix}`, 'visibility', vis(layers.clusters))
      m.setLayerZoomRange(`biz-flat-${suffix}`, pinMin, 24)
      m.setLayerZoomRange(`biz-clustered-${suffix}`, pinMin, 24)
    }
    for (const id of BUSINESS_CLUSTER_LAYERS) {
      m.setLayoutProperty(id, 'visibility', vis(layers.clusters && level === 'clusters'))
      m.setLayerZoomRange(id, pinMin, 24)
    }
    // Aggregate market activity must remain visible at entity zoom when the
    // authenticated directory has no matching pins yet. It gives the user a
    // truthful, clickable market signal rather than an empty map.
    for (const id of MARKET_CLUSTER_LAYERS) {
      m.setLayoutProperty(id, 'visibility', vis(layers.clusters && (level === 'clusters' || level === 'entities')))
      m.setLayerZoomRange(id, pinMin, 24)
    }
    for (const id of ['street-active', 'market-street-hit', 'market-street-line']) m.setLayerZoomRange(id, tiered ? DISTRICT_MAX_ZOOM : 0, 24)
    const hasDirectDirectoryPins = liveDirectoryMode === 'direct'
    for (const id of ['live-entity-cluster', 'live-entity-cluster-count', 'live-entity-halo', 'live-entity-pin', 'live-entity-icon', 'live-entity-icon-selected']) m.setLayoutProperty(id, 'visibility', vis(hasDirectDirectoryPins || !liveMapQuery))
  }, [ready, layers, progressive, level, liveMapQuery, liveDirectoryMode])

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
    // Loading a new page changes the live district collection. Do not let that
    // background refresh pull a user who has selected an area back out to the
    // whole city: the dedicated area effect below owns that camera.
    if (area) return
    const points = (compact ? [...businesses, ...ghostBusinesses] : businesses).map((b) => toLngLat(cityId, [b.x, b.y]))
    const liveBounds = boundsOf(liveDistrictFeatures.flatMap((feature) => outerRing(feature.geometry)))
    fitTo(liveBounds ?? boundsOf(points) ?? cityBounds(cityId))
    // Only refit when the result set, city, or visible size changes — never on
    // selection toggles or subsequent directory pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, compactFitKey, sizeEpoch, liveDistrictGeometryKey, area])

  const currentAreaKey = areaKey(area)
  useEffect(() => {
    if (!ready || !area) return
    const ring = area.kind === 'district'
      ? outerRing(liveDistrictById.get(area.districtId)?.geometry ?? null)
      : areaRing(cityId, area)
    const b = boundsOf(ring)
    // A district is an explicit request to inspect its establishments. Keep
    // the camera at the entity threshold rather than fitting the whole
    // polygon at overview scale, where POIs would be hidden again.
    if (b) fitTo(b, true, ENTITY_MIN_ZOOM + 0.35, ENTITY_MIN_ZOOM)
    setCard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, currentAreaKey, liveDistrictById])

  useEffect(() => {
    setCard(null)
    setAreaMode(false)
  }, [cityId])

  const handledDistrictFocusRef = useRef<number | null>(null)
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m || !focusDistrictRequest || handledDistrictFocusRef.current === focusDistrictRequest.nonce) return
    const wanted = focusDistrictRequest.name.trim()
    const feature = liveDistrictFeatures.find((item) => districtName(item).trim() === wanted)
    const id = feature ? districtId(feature) : null
    if (!feature || !id) return
    handledDistrictFocusRef.current = focusDistrictRequest.nonce
    const bounds = boundsOf(outerRing(feature.geometry))
    // Opening a district from the URL, a card, or the ranked list has the
    // same meaning: enter the district and reveal its POIs. Aggregation still
    // handles density within the viewport, as on conventional map products.
    if (bounds) fitTo(bounds, true, ENTITY_MIN_ZOOM + 0.35, ENTITY_MIN_ZOOM)
    setCard({ kind: 'district', id })
  }, [ready, focusDistrictRequest, liveDistrictFeatures])

  const handledStreetFocusRef = useRef<number | null>(null)
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m || !focusStreetRequest || handledStreetFocusRef.current === focusStreetRequest.nonce) return
    const street = focusStreetRequest.street.trim()
    const district = focusStreetRequest.district?.trim()
    const feature = liveStreetData.features.find((item) =>
      item.properties?.street_ar?.trim() === street && (!district || item.properties?.district_ar?.trim() === district),
    )
    const center = feature ? polygonCenter(feature.geometry) : null
    if (!feature || !center) return
    handledStreetFocusRef.current = focusStreetRequest.nonce
    const targetZoom = STREET_MIN_ZOOM + 0.45
    setZoom(targetZoom)
    m.easeTo({ center, zoom: targetZoom, duration: 650 })
    setCard({
      kind: 'market-street',
      label: feature.properties?.street_ar ?? street,
      count: feature.properties?.n ?? 0,
      wholesale: feature.properties?.n_wholesale ?? 0,
      district: feature.properties?.district_ar,
    })
  }, [ready, focusStreetRequest, liveStreetData])

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
  const areaLiveEntities = useMemo(() => {
    if (!area) return []
    if (area.kind === 'district') {
      const liveFeature = liveDistrictById.get(area.districtId)
      const district = liveFeature ? districtName(liveFeature) : area.label.replace(/^حي\s+/, '')
      const key = normalizeArabic(district)
      return liveEntityPins.filter((entity) => normalizeArabic(entity.district) === key)
    }
    const [[west, south], [east, north]] = area.bounds
    return liveEntityPins.filter((entity) => entity.latitude != null && entity.longitude != null && entity.longitude >= west && entity.longitude <= east && entity.latitude >= south && entity.latitude <= north)
  }, [area, liveDistrictById, liveEntityPins])
  const areaSummary = useMemo(() => {
    if (areaItems.length) return summarize(areaItems, selectedSet)
    const categories = new Map<string, number>()
    for (const entity of areaLiveEntities) categories.set(entity.category, (categories.get(entity.category) ?? 0) + 1)
    return {
      count: areaLiveEntities.length,
      selected: areaLiveEntities.filter((entity) => selectedSet.has(entity.id)).length,
      whatsappSignals: areaLiveEntities.filter((entity) => entity.whatsapp).length,
      wholesale: 0,
      topCategories: [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
    }
  }, [areaItems, areaLiveEntities, selectedSet])
  const areaSelectableIds = areaItems.length ? areaItems.map((item) => item.id) : areaLiveEntities.map((item) => item.id)

  const goToLevel = (l: MapLevel) => {
    const m = mapRef.current
    const target = LEVELS.find((x) => x.id === l)
    if (!m || !target) return
    // A card describes a feature from the previous level. Clear it before the
    // view changes so it cannot cover or misrepresent the new interaction.
    setCard(null)
    setPendingLevel(l)
    onDetailLevelChange?.(l)
    if (l === 'districts' && !layers.districts) setLayers((s) => ({ ...s, districts: true }))
    if (l === 'clusters' && !layers.clusters) setLayers((s) => ({ ...s, clusters: true }))
    if (l === 'streets' && !layers.streets) setLayers((s) => ({ ...s, streets: true }))
    setZoom(target.zoom)

    const currentBounds = m.getBounds()
    const visibleFirst = <T extends { center: [number, number]; weight: number }>(items: T[]) => {
      const inView = items.filter((item) => currentBounds.contains(item.center))
      return [...(inView.length ? inView : items)].sort((a, b) => b.weight - a.weight)[0]
    }

    // A chosen district is the user's geographic context. Entering the entity
    // level must focus that district, rather than only magnifying the city centre.
    // Tiles then stream every matching POI for the visible viewport just like a
    // conventional map; the complete district remains available by panning.
    if (l === 'entities' && area?.kind === 'district') {
      const feature = liveDistrictById.get(area.districtId)
      const center = feature ? polygonCenter(feature.geometry) : null
      if (center) {
        m.easeTo({ center, zoom: target.zoom, duration: 550 })
        return
      }
    }

    if (l === 'clusters') {
      const candidate = visibleFirst(liveClusters.flatMap((cluster) => (
        typeof cluster.lon === 'number' && typeof cluster.lat === 'number'
          ? [{ center: [cluster.lon, cluster.lat] as [number, number], weight: cluster.n ?? 0 }]
          : []
      )))
      if (candidate) {
        m.easeTo({ center: candidate.center, zoom: target.zoom, duration: 550 })
        return
      }
    }

    if (l === 'streets') {
      const candidate = visibleFirst(liveStreetData.features.flatMap((feature) => {
        const center = polygonCenter(feature.geometry)
        return center ? [{ center, weight: feature.properties?.n ?? 0 }] : []
      }))
      if (candidate) {
        m.easeTo({ center: candidate.center, zoom: target.zoom, duration: 550 })
        return
      }
    }

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
      const summary = live ? { count, selected: 0, whatsappSignals: liveCountByName.get(name)?.n_whatsapp ?? 0, wholesale: liveCountByName.get(name)?.n_wholesale ?? 0, topCategories: [] } : summarize(items, selectedSet)
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
    if (card?.kind === 'tile-entity') {
      const entity = tileProfiles[card.id]
      if (entity) return <LiveEntityCard entity={entity} selected={selectedSet.has(entity.id)} onClose={() => setCard(null)} onToggle={() => onTogglePin(entity.id)} />
      return <div className="absolute right-3 bottom-3 z-20 w-[min(22rem,calc(100%-1.5rem))] rounded-xl border bg-card p-4 shadow-lg"><p className="text-sm font-semibold">{card.name}</p><p className="mt-1 text-xs text-muted-foreground">{tileProfileError || 'جارٍ تحميل البيانات الأساسية للمنشأة…'}</p></div>
    }
    if (card?.kind === 'live-entity') {
      const entity = liveEntityPins.find((item) => item.id === card.id)
      if (!entity) return null
      return (
        <LiveEntityCard
          entity={entity}
          selected={selectedSet.has(entity.id)}
          onClose={() => setCard(null)}
          onToggle={() => onTogglePin(entity.id)}
        />
      )
    }
    if (card?.kind === 'market-street') {
      return <MarketStreetCard label={card.label} count={card.count} wholesale={card.wholesale} district={card.district} onClose={() => setCard(null)} />
    }
    if (card?.kind === 'market-cluster') {
      return (
        <MarketClusterCard
          label={card.label}
          count={card.count}
          wholesale={card.wholesale}
          district={card.district}
          onClose={() => setCard(null)}
          onZoom={() => {
            // Change the visible level before the camera animation completes. Without
            // this, the action could look inert for the duration of the animation even
            // though Mapbox was already moving to the street view.
            const streetZoom = STREET_MIN_ZOOM + 0.35
            setCard(null)
            onDetailLevelChange?.('streets')
            if (!layers.streets) setLayers((current) => ({ ...current, streets: true }))
            setZoom(streetZoom)
            mapRef.current?.easeTo({ center: card.center, zoom: streetZoom, duration: 600 })
          }}
        />
      )
    }
    if (area && dismissedArea !== area) {
      const district = area.kind === 'district' ? area.label.replace(/^حي\s+/, '').trim() : ''
      const next = district ? `/opportunity-map?goal=explore&district=${encodeURIComponent(district)}` : '/opportunity-map'
      return (
        <AreaCard
          label={area.label}
          summary={areaSummary}
          totalCount={area.kind === 'district' ? liveDirectorySummary?.total ?? liveSummary?.total : undefined}
          totalWhatsappSignals={area.kind === 'district' ? liveDirectorySummary?.withWhatsapp ?? liveSummary?.n_whatsapp : undefined}
          entityState={liveEntityState}
          loginHref={`/login?next=${encodeURIComponent(next)}`}
          onClose={() => setDismissedArea(area)}
          onClear={() => onAreaChange?.(null)}
          onSelectAll={() => onSelectMany?.(areaSelectableIds)}
          onShowList={onShowList}
        />
      )
    }
    return null
  }

  const cardNode = renderCard()
  const cardKey = card ? JSON.stringify(card) : 'empty'
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
        <motion.div
          className="absolute top-3 right-3 left-14 z-10 @2xl:left-auto @2xl:w-[min(34rem,calc(100%-5rem))]"
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
        >
          <MapContextBar
            cityName={cityName}
            level={level}
            progressive={progressive}
            inView={liveMapQuery && liveDirectorySummary ? liveDirectorySummary.total : liveSummary?.total ?? inView}
            total={liveMapQuery && liveDirectorySummary ? liveDirectorySummary.total : liveSummary?.total ?? businesses.length}
            selected={selectedIds.length}
            hasEntityPins={liveEntityPins.length > 0}
            marketSignalCount={liveClusters.length}
            areaMode={areaMode}
            areaLabel={area?.label}
            pendingLevel={pendingLevel}
            onLevel={goToLevel}
            onToggleAreaMode={() => setAreaMode((v) => !v)}
          />
        </motion.div>
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

      <AnimatePresence initial={false} mode="wait">
        {cardNode ? (
          <motion.div
            key={cardKey}
            className={cn(
              'absolute inset-x-3 z-10 transition-[bottom] duration-200 @2xl:right-3 @2xl:bottom-auto @2xl:left-auto @2xl:top-[6.75rem] @2xl:w-80',
              reserveBottom ? 'bottom-[7.5rem] @2xl:bottom-auto' : 'bottom-3',
            )}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
          >
            {cardNode}
          </motion.div>
        ) : null}
      </AnimatePresence>

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
