import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'
import { isMapQuery, sanitizeLiveDirectoryEntity } from '@/lib/live-directory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cityNames: Record<string, string> = { riyadh: 'Riyadh', jeddah: 'Jeddah', dammam: 'Dammam' }

function targetingHeaders() {
  // Production Railway services may use an explicit service token. Older
  // deployments derive the token from TARGETING_PASSWORD, so keep that path
  // only as a backwards-compatible fallback.
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

function asText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export async function POST(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return NextResponse.json({ error: 'سجّل الدخول لعرض الجهات المطابقة.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  if (!isTargetingAllowed(session) || !(await verifySession(session))) return NextResponse.json({ error: 'حسابك غير مخول لعرض دليل الجهات.' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  let input: { q?: unknown; city?: unknown; objective?: unknown; limit?: unknown; offset?: unknown; district?: unknown }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'طلب البحث غير صالح.' }, { status: 400 }) }
  const q = asText(input.q, 200)
  const city = cityNames[asText(input.city, 32).toLowerCase()] || asText(input.city, 64)
  const objective = input.objective === 'marketing' || input.objective === 'purchase' ? input.objective : null
  const limit = Math.min(200, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 100))
  const offset = Math.min(10_000, Math.max(0, Number.isInteger(input.offset) ? Number(input.offset) : 0))
  const district = asText(input.district, 100)
  if ((!q && !district) || !city) return NextResponse.json({ error: 'اكتب النشاط أو اختر حياً، ثم اختر المدينة.' }, { status: 400 })
  if (q && !objective) return NextResponse.json({ error: 'نوع البحث غير صالح.' }, { status: 400 })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return NextResponse.json({ error: 'خدمة الدليل غير مهيأة حالياً.' }, { status: 503 })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const upstream = await fetch(`${origin}/search`, {
      method: 'POST', headers,
      body: JSON.stringify(q
        ? { q, city, limit, offset, objective, only_sendable: false, ...(district ? { filters: { district } } : {}) }
        : { city, limit, offset, objective: 'browse', filters: { district } }),
      cache: 'no-store', signal: controller.signal,
    })
    const payload = await upstream.json().catch(() => null) as { rows?: unknown; total?: unknown; with_whatsapp?: unknown; has_more?: unknown; next_offset?: unknown; map_query?: unknown } | null
    if (!upstream.ok || !payload) return NextResponse.json({ error: 'تعذر تحميل الجهات الآن.' }, { status: 502 })
    const rows = Array.isArray(payload.rows) ? payload.rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object')).map(sanitizeLiveDirectoryEntity).filter((row) => row.id) : []
    const response = NextResponse.json({ total: typeof payload.total === 'number' ? payload.total : rows.length, withWhatsapp: typeof payload.with_whatsapp === 'number' ? payload.with_whatsapp : 0, hasMore: payload.has_more === true, nextOffset: typeof payload.next_offset === 'number' ? payload.next_offset : null, mapQuery: isMapQuery(payload.map_query) ? payload.map_query : null, rows }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return NextResponse.json({ error: 'تعذر الاتصال بخدمة الدليل.' }, { status: 502 })
  } finally { clearTimeout(timeout) }
}
