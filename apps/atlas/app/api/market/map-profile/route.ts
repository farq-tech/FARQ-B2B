import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'
import { isMapQuery, sanitizeLiveDirectoryEntity } from '@/lib/live-directory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

export async function POST(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return NextResponse.json({ error: 'سجّل الدخول لعرض بيانات المنشأة.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  if (!isTargetingAllowed(session) || !(await verifySession(session))) return NextResponse.json({ error: 'حسابك غير مخول لعرض دليل الجهات.' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  let input: { query?: unknown; poiKey?: unknown }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'طلب بيانات المنشأة غير صالح.' }, { status: 400 }) }
  const poiKey = typeof input.poiKey === 'string' ? input.poiKey.trim().slice(0, 180) : ''
  if (!isMapQuery(input.query) || !poiKey) return NextResponse.json({ error: 'طلب بيانات المنشأة غير صالح.' }, { status: 400 })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return NextResponse.json({ error: 'خدمة الدليل غير مهيأة حالياً.' }, { status: 503 })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const upstream = await fetch(`${origin}/map-profile`, { method: 'POST', headers, body: JSON.stringify({ query: input.query, poi_key: poiKey }), cache: 'no-store', signal: controller.signal })
    const payload = await upstream.json().catch(() => null) as { row?: unknown } | null
    if (!upstream.ok || !payload?.row || typeof payload.row !== 'object') return NextResponse.json({ error: 'تعذر تحميل بيانات المنشأة الآن.' }, { status: upstream.status === 404 ? 404 : 502 })
    const entity = sanitizeLiveDirectoryEntity(payload.row as Record<string, unknown>)
    if (!entity.id) return NextResponse.json({ error: 'تعذر تحميل بيانات المنشأة الآن.' }, { status: 502 })
    const response = NextResponse.json({ entity }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return NextResponse.json({ error: 'تعذر الاتصال بخدمة الدليل.' }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}
