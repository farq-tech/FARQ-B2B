'use client'

import { useState } from 'react'
import type { Feature, LineString, MultiPolygon, Polygon } from 'geojson'
import { Clock3, Route, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type RouteStop = { id: string; name: string; latitude: number | null; longitude: number | null }
export type PlannedRoute = Feature<LineString | Polygon | MultiPolygon, { lengthKm?: number; durationMinutes?: number; coverageMinutes?: number }>

const ROUTE_SEGMENT_SIZE = 10
const MAX_ROUTE_STOPS = 100

type RouteResult = {
  routes?: Array<{
    geometry?: { type?: string; coordinates?: unknown }
    distance?: number
    duration?: number
  }>
  trip?: {
    legs?: Array<{ shape?: { type?: string; coordinates?: unknown } }>
    summary?: { length?: number; time?: number }
  }
  features?: Array<{ type?: string; geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }>
}

function extractRoute(value: unknown): PlannedRoute | null {
  if (!value || typeof value !== 'object') return null
  const response = value as RouteResult
  const route = response.routes?.[0]
  if (route?.geometry?.type === 'LineString' && Array.isArray(route.geometry.coordinates)) {
    const coordinates = route.geometry.coordinates.filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && typeof point[0] === 'number' && typeof point[1] === 'number')
    if (coordinates.length < 2) return null
    return {
      type: 'Feature',
      properties: {
        lengthKm: Math.round(((route.distance ?? 0) / 1000) * 10) / 10,
        durationMinutes: Math.round((route.duration ?? 0) / 60),
      },
      geometry: { type: 'LineString', coordinates },
    }
  }
  const trip = response.trip
  if (!trip?.legs?.length) return null
  const coordinates = trip.legs.flatMap((leg) => {
    const shape = leg.shape
    return shape?.type === 'LineString' && Array.isArray(shape.coordinates)
      ? shape.coordinates.filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && typeof point[0] === 'number' && typeof point[1] === 'number')
      : []
  })
  if (coordinates.length < 2) return null
  return {
    type: 'Feature',
    properties: {
      lengthKm: Math.round((trip.summary?.length ?? 0) * 10) / 10,
      durationMinutes: Math.round((trip.summary?.time ?? 0) / 60),
    },
    geometry: { type: 'LineString', coordinates },
  }
}

export function NetworkPlanner({ stops, onRouteChange, onRouteReady, initialMode = 'route', allowCoverage = false }: { stops: RouteStop[]; onRouteChange: (route: PlannedRoute | null) => void; onRouteReady?: () => void; initialMode?: 'route' | 'coverage'; allowCoverage?: boolean }) {
  const [costing, setCosting] = useState<'auto' | 'truck' | 'pedestrian'>('truck')
  const [mode, setMode] = useState<'route' | 'coverage'>(initialMode)
  const [coverageMinutes, setCoverageMinutes] = useState(15)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const availableStops = stops.filter((stop) => stop.latitude != null && stop.longitude != null)
  const canPlan = mode === 'coverage' ? availableStops.length >= 1 : availableStops.length >= 2 && availableStops.length <= MAX_ROUTE_STOPS

  const extractCoverage = (value: unknown): PlannedRoute | null => {
    if (!value || typeof value !== 'object') return null
    const features = (value as RouteResult).features
    const feature = features?.find((item) => item.geometry?.type === 'Polygon' || item.geometry?.type === 'MultiPolygon')
    if (!feature?.geometry?.coordinates || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) return null
    return { type: 'Feature', properties: { coverageMinutes }, geometry: feature.geometry as Polygon | MultiPolygon }
  }

  const plan = async () => {
    if (!canPlan) return
    setStatus('loading')
    setMessage(null)
    try {
      let route: PlannedRoute | null
      if (mode === 'coverage') {
        const response = await fetch('/api/routing/isochrone', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ costing, locations: availableStops.slice(0, 1).map((stop) => ({ lat: stop.latitude, lon: stop.longitude })), contours_minutes: [coverageMinutes] }),
        })
        const value = await response.json() as unknown
        if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'تعذر حساب نطاق الوصول.')
        route = extractCoverage(value)
      } else {
        // Keep each Valhalla request small and overlap adjacent legs by one stop.
        // This avoids long multi-stop requests timing out while preserving order.
        const segmentCount = Math.ceil((availableStops.length - 1) / (ROUTE_SEGMENT_SIZE - 1))
        const coordinates: [number, number][] = []
        let distanceMeters = 0
        let durationSeconds = 0
        for (let start = 0, segment = 1; start < availableStops.length - 1; start += ROUTE_SEGMENT_SIZE - 1, segment += 1) {
          const segmentStops = availableStops.slice(start, start + ROUTE_SEGMENT_SIZE)
          setMessage(`يجري حساب جزء الطريق ${segment} من ${segmentCount}…`)
          const response = await fetch('/api/routing/route', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ costing, locations: segmentStops.map((stop) => ({ lat: stop.latitude, lon: stop.longitude })) }),
          })
          const value = await response.json() as unknown
          if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : `تعذر حساب جزء الطريق ${segment} من ${segmentCount}.`)
          const segmentRoute = extractRoute(value)
          const rawRoute = value && typeof value === 'object' && 'routes' in value && Array.isArray(value.routes)
            ? value.routes[0] as { distance?: number; duration?: number } | undefined
            : undefined
          if (!segmentRoute || segmentRoute.geometry.type !== 'LineString') throw new Error(`لم ينتج محرك الطرق مسارًا صالحًا للجزء ${segment} من ${segmentCount}.`)
          const points = segmentRoute.geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude] as [number, number])
          const first = points[0]
          const last = coordinates.at(-1)
          const beginsAtLastPoint = last && Math.abs(last[0] - first[0]) < 1e-6 && Math.abs(last[1] - first[1]) < 1e-6
          coordinates.push(...(beginsAtLastPoint ? points.slice(1) : points))
          distanceMeters += rawRoute?.distance ?? (segmentRoute.properties.lengthKm ?? 0) * 1000
          durationSeconds += rawRoute?.duration ?? (segmentRoute.properties.durationMinutes ?? 0) * 60
        }
        route = coordinates.length >= 2 ? {
          type: 'Feature',
          properties: {
            lengthKm: Math.round((distanceMeters / 1000) * 10) / 10,
            durationMinutes: Math.round(durationSeconds / 60),
          },
          geometry: { type: 'LineString', coordinates },
        } : null
      }
      if (!route) throw new Error(mode === 'coverage' ? 'لم ينتج محرك الطرق نطاق وصول صالحًا.' : 'لم ينتج محرك الطرق مسارًا صالحًا بين النقاط المحددة.')
      onRouteChange(route)
      setStatus('ready')
      setMessage(mode === 'coverage' ? `نطاق وصول خلال ${coverageMinutes} دقيقة من ${availableStops[0]?.name}` : `المسار جاهز · ${route.properties.lengthKm} كم · ${route.properties.durationMinutes} دقيقة · ${availableStops.length} محطة`)
      onRouteReady?.()
    } catch (error) {
      onRouteChange(null)
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'تعذر حساب الجولة.')
    }
  }

  return (
    <section className="rounded-xl border border-primary/20 bg-card p-4" aria-label="تخطيط التوزيع والتغطية">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Truck className="size-4" aria-hidden /></span>
        <div>
          <h2 className="text-sm font-semibold">{mode === 'coverage' ? 'قِس نطاق الوصول عبر الطرق' : 'خطط جولة التوزيع'}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{mode === 'coverage' ? 'اختر منشأة كنقطة مرجعية، ثم اعرض ما يمكن الوصول إليه خلال الوقت المحدد.' : 'حدد نقطة الانطلاق أولاً، ثم الوجهات بالترتيب المطلوب.'}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="network-mode">نوع التحليل</label>
        {allowCoverage ? (
          <select id="network-mode" value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setStatus('idle'); setMessage(null); onRouteChange(null) }} className="h-9 rounded-lg border bg-background px-2.5 text-sm">
            <option value="route">مسار توزيع</option>
            <option value="coverage">نطاق وصول</option>
          </select>
        ) : null}
        {mode === 'coverage' ? (
          <>
            <label className="sr-only" htmlFor="coverage-minutes">وقت الوصول</label>
            <select id="coverage-minutes" value={coverageMinutes} onChange={(event) => setCoverageMinutes(Number(event.target.value))} className="h-9 rounded-lg border bg-background px-2.5 text-sm">
              <option value={10}>10 دقائق</option><option value={15}>15 دقيقة</option><option value={30}>30 دقيقة</option>
            </select>
          </>
        ) : null}
        <label className="sr-only" htmlFor="network-costing">نوع الجولة</label>
        <select id="network-costing" value={costing} onChange={(event) => setCosting(event.target.value as typeof costing)} className="h-9 rounded-lg border bg-background px-2.5 text-sm">
          <option value="truck">شاحنة توزيع</option>
          <option value="auto">سيارة</option>
          <option value="pedestrian">مشاة</option>
        </select>
        <Button type="button" size="sm" disabled={!canPlan || status === 'loading'} onClick={plan}>
          {mode === 'coverage' ? <Clock3 data-icon="inline-start" /> : <Route data-icon="inline-start" />}
          {status === 'loading' ? 'يجري الحساب…' : mode === 'coverage' ? 'احسب نطاق الوصول' : `احسب الجولة (${availableStops.length})`}
        </Button>
      </div>
      {mode === 'route' && availableStops.length < 2 ? <p className="mt-2 text-xs text-muted-foreground">حدد نقطتي انطلاق أو زيارة على الأقل من المنشآت الظاهرة بالخريطة.</p> : null}
      {mode === 'route' && availableStops.length > MAX_ROUTE_STOPS ? <p className="mt-2 text-xs text-destructive">الحد الأعلى للجولة {MAX_ROUTE_STOPS} محطة. قسّم المحطات إلى جولات أصغر.</p> : null}
      {mode === 'coverage' && availableStops.length < 1 ? <p className="mt-2 text-xs text-muted-foreground">حدد منشأة واحدة لقياس نطاق الوصول إليها عبر شبكة الطرق.</p> : null}
      {status === 'ready' && message ? <p className="mt-2 text-xs font-medium text-primary" role="status">{message}</p> : null}
      {status === 'error' && message ? <p className="mt-2 text-xs text-destructive" role="alert">{message}</p> : null}
      {stops.length > availableStops.length ? <p className="mt-1 text-[11px] text-muted-foreground">استُبعدت {stops.length - availableStops.length} منشأة لعدم توفر إحداثيات.</p> : null}
    </section>
  )
}
