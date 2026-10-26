import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACTIONS = new Set(['route', 'optimized_route', 'isochrone', 'sources_to_targets'])
const COSTINGS = new Set(['auto', 'pedestrian', 'bicycle', 'truck'])
type Coordinate = { lat: number; lon: number }

function point(value: unknown): Coordinate | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon) || raw.lat < 16 || raw.lat > 33 || raw.lon < 34 || raw.lon > 56) return null
  return { lat: raw.lat, lon: raw.lon }
}

function pointList(value: unknown, min: number, max: number): Coordinate[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null
  const points = value.map(point)
  return points.every((item): item is Coordinate => item !== null) ? points : null
}

function costing(value: unknown) {
  return typeof value === 'string' && COSTINGS.has(value) ? value : 'auto'
}

function sanitizeRequest(action: string, value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const selectedCosting = costing(input.costing)

  if (action === 'route' || action === 'optimized_route') {
    const locations = pointList(input.locations, action === 'optimized_route' ? 4 : 2, 25)
    if (!locations) return null
    return {
      locations: locations.map((location) => ({ ...location, type: 'break' })),
      costing: selectedCosting,
      units: 'kilometers',
      format: 'osrm',
      shape_format: 'geojson',
    }
  }

  if (action === 'isochrone') {
    const locations = pointList(input.locations, 1, 1)
    const contours = Array.isArray(input.contours_minutes)
      ? input.contours_minutes.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0 && item <= 120).slice(0, 4)
      : []
    if (!locations || !contours.length) return null
    return { locations, costing: selectedCosting, contours_minutes: contours, polygons: true }
  }

  const sources = pointList(input.sources, 1, 25)
  const targets = pointList(input.targets, 1, 25)
  if (!sources || !targets) return null
  return { sources, targets, costing: selectedCosting, units: 'kilometers' }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return NextResponse.json({ error: 'سجّل الدخول لاستخدام تخطيط المسارات.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  if (!isTargetingAllowed(session) || !(await verifySession(session))) return NextResponse.json({ error: 'حسابك غير مخول لاستخدام تخطيط المسارات.' }, { status: 403, headers: { 'cache-control': 'no-store' } })

  const { action } = await context.params
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'طلب المسار غير متاح.' }, { status: 404 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'بيانات المسار غير صالحة.' }, { status: 400 }) }
  const payload = sanitizeRequest(action, body)
  if (!payload) return NextResponse.json({ error: 'حدد نقاطًا صحيحة داخل نطاق السعودية.' }, { status: 400 })

  const origin = process.env.VALHALLA_ORIGIN?.replace(/\/$/, '')
  const gatewayToken = process.env.VALHALLA_GATEWAY_TOKEN?.trim()
  if (!origin || !gatewayToken) return NextResponse.json({ error: 'خدمة تخطيط المسارات غير مهيأة.' }, { status: 503 })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 50_000)
  try {
    const upstream = await fetch(`${origin}/${action}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: controller.signal,
    })
    const result = await upstream.json().catch(() => null)
    if (!upstream.ok || !result) return NextResponse.json({ error: 'تعذر حساب المسار على شبكة الطرق.' }, { status: 502, headers: { 'cache-control': 'no-store' } })
    const response = NextResponse.json(result, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return NextResponse.json({ error: 'تعذر الاتصال بخدمة تخطيط المسارات.' }, { status: 502, headers: { 'cache-control': 'no-store' } })
  } finally {
    clearTimeout(timeout)
  }
}
