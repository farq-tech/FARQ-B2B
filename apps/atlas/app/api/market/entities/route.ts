import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'
import { hasPermanentlyClosedEntity, isMapQuery, sanitizeLiveDirectoryEntity } from '@/lib/live-directory'
import { issueTileAccess } from '@/lib/map-tile-access'

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
  // A selected district can legitimately contain more than 10k establishments.
  // The browser only requests these pages after an explicit district action and
  // uses bounded concurrency, so keep a high guardrail without silently
  // repeating page 10,000 for the remainder of a real district cohort.
  const offset = Math.min(100_000, Math.max(0, Number.isInteger(input.offset) ? Number(input.offset) : 0))
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
    if (!Array.isArray(payload.rows) || typeof payload.total !== 'number' || !Number.isSafeInteger(payload.total) || payload.total < 0 || payload.rows.length > payload.total) {
      return NextResponse.json({ error: 'استجابة دليل المنشآت غير مكتملة.' }, { status: 502 })
    }
    const nextOffsetValid = typeof payload.next_offset === 'number' && Number.isSafeInteger(payload.next_offset) && payload.next_offset > offset && payload.next_offset <= payload.total
    if (typeof payload.has_more !== 'boolean' || (payload.has_more && !nextOffsetValid) || (!payload.has_more && payload.next_offset !== null)) {
      return NextResponse.json({ error: 'ترقيم صفحات دليل المنشآت غير مكتمل.' }, { status: 502 })
    }
    if (!payload.rows.every((row) => Boolean(row && typeof row === 'object' && !Array.isArray(row)))) {
      return NextResponse.json({ error: 'بيانات منشآت غير صالحة.' }, { status: 502 })
    }
    const normalized = payload.rows.map((row) => sanitizeLiveDirectoryEntity(row as Record<string, unknown>))
    if (normalized.some((row) => !row.id)) return NextResponse.json({ error: 'معرّف منشأة مفقود.' }, { status: 502 })
    if (hasPermanentlyClosedEntity(normalized)) {
      return NextResponse.json({ error: 'استجابة دليل المنشآت لا تطابق سياسة حالات الإغلاق.' }, { status: 502, headers: { 'cache-control': 'no-store' } })
    }
    const rows = normalized
    const mapQuery = isMapQuery(payload.map_query) ? payload.map_query : null
    const withWhatsapp = typeof payload.with_whatsapp === 'number' && Number.isSafeInteger(payload.with_whatsapp) && payload.with_whatsapp >= 0 ? payload.with_whatsapp : null
    const hasMore = payload.has_more
    const nextOffset = nextOffsetValid ? payload.next_offset as number : null
    const response = NextResponse.json({ total: payload.total, withWhatsapp, hasMore, nextOffset, mapQuery, tileAccess: mapQuery ? issueTileAccess(mapQuery) : null, rows }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return NextResponse.json({ error: 'تعذر الاتصال بخدمة الدليل.' }, { status: 502 })
  } finally { clearTimeout(timeout) }
}
