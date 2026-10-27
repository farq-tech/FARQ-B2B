import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BATCH = 30   // districts per upstream call (market_analytics.MAX_DISTRICTS)

function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/**
 * Located businesses of a set of districts (optionally one activity) for planning a visit route. These are
 * individual business records, so only signed-in Atlas accounts get them, like /api/market/entities.
 */
export async function POST(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return NextResponse.json({ error: 'سجّل الدخول لعرض منشآت المنطقة.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  if (!isTargetingAllowed(session) || !(await verifySession(session))) return NextResponse.json({ error: 'حسابك غير مخول لعرض دليل الجهات.' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  let input: { city?: unknown; districts?: unknown; q?: unknown; main_id?: unknown }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }) }
  const city = text(input.city, 80)
  const districts = Array.isArray(input.districts) ? [...new Set(input.districts.map((item) => text(item, 80)).filter(Boolean))].slice(0, 600) : []
  const q = text(input.q, 120)
  const mainId = text(input.main_id, 40)
  if (!city || !districts.length) return NextResponse.json({ error: 'اختر المدينة والأحياء.' }, { status: 400 })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return NextResponse.json({ error: 'خدمة الدليل غير مهيأة حالياً.' }, { status: 503 })
  try {
    const batches = []
    for (let i = 0; i < districts.length; i += BATCH) batches.push(districts.slice(i, i + BATCH))
    const parts = await Promise.all(batches.map(async (batch) => {
      const upstream = await fetch(`${origin}/district-points`, {
        method: 'POST', headers, cache: 'no-store', signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ city, districts: batch, ...(q ? { q } : mainId ? { main_id: mainId } : {}) }),
      })
      const payload = await upstream.json().catch(() => null) as { points?: unknown[]; truncated?: boolean } | null
      if (!upstream.ok || !payload) throw new Error('upstream')
      return payload
    }))
    const points = parts.flatMap((part) => (Array.isArray(part.points) ? part.points : []))
    const response = NextResponse.json({ points, truncated: parts.some((part) => part.truncated) }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return NextResponse.json({ error: 'تعذر تحميل منشآت المنطقة.' }, { status: 502 })
  }
}
