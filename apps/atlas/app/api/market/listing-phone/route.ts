import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

/** One listing's advertiser number, for a signed-in person who asks for it. A list of listings never carries it. */
export async function POST(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session || !(await verifySession(session))) return NextResponse.json({ error: 'سجّل الدخول لعرض رقم المعلن.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  let input: { id?: unknown }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 }) }
  const id = typeof input.id === 'string' && /^\d{1,12}$/.test(input.id) ? input.id : ''
  if (!id) return NextResponse.json({ error: 'طلب غير صالح.' }, { status: 400 })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return NextResponse.json({ error: 'الخدمة غير مهيأة حالياً.' }, { status: 503 })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const upstream = await fetch(`${origin}/real-estate-phone`, { method: 'POST', headers, body: JSON.stringify({ id }), cache: 'no-store', signal: controller.signal })
    const payload = await upstream.json().catch(() => null) as { phone?: unknown } | null
    if (!upstream.ok) return NextResponse.json({ error: 'تعذر جلب الرقم الآن.' }, { status: 502 })
    const phone = typeof payload?.phone === 'string' && /^05\d{8}$/.test(payload.phone) ? payload.phone : null
    const response = NextResponse.json({ phone }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return NextResponse.json({ error: 'تعذر الاتصال بالخدمة.' }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}
