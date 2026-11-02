import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const point = (value: unknown) => (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? value : undefined)

/**
 * The store owners' site card (services/targeting-api/site_card.py): people and their measured segments inside a
 * range, and the chosen activity's competitors there by name. Business names are directory records, so only
 * signed-in Atlas accounts get the card, like /api/market/entities. No contact field is ever part of it.
 */
export async function POST(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return NextResponse.json({ error: 'سجّل الدخول لعرض بطاقة الموقع.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  if (!isTargetingAllowed(session) || !(await verifySession(session))) return NextResponse.json({ error: 'حسابك غير مخول لعرض بطاقة الموقع.' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  let input: { city?: unknown; geometry?: unknown; centre?: unknown; q?: unknown; main_id?: unknown }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }) }
  const city = text(input.city, 80)
  const q = text(input.q, 120)
  const mainId = text(input.main_id, 40)
  const geometry = input.geometry as { type?: unknown } | undefined
  if (!city || !geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return NextResponse.json({ error: 'اختر الموقع ونطاقه.' }, { status: 400 })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return NextResponse.json({ error: 'خدمة بيانات السوق غير مهيأة حالياً.' }, { status: 503 })
  try {
    const upstream = await fetch(`${origin}/site-card`, {
      method: 'POST', headers, cache: 'no-store', signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ city, geometry, centre: point(input.centre), ...(q ? { q } : mainId ? { main_id: mainId } : {}) }),
    })
    const payload = await upstream.json().catch(() => null)
    if (!upstream.ok || !payload) return NextResponse.json({ error: 'تعذر حساب بطاقة الموقع.' }, { status: 502 })
    const response = NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return NextResponse.json({ error: 'تعذر الاتصال بخدمة بيانات السوق.' }, { status: 502 })
  }
}
