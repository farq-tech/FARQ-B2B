import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'
import { isMapQuery, sanitizeLiveDirectoryEntity } from '@/lib/live-directory'
import { issueTileAccess } from '@/lib/map-tile-access'
import { GUEST_PREVIEW, guestPreview } from '@/lib/guest-preview'

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

/** A main activity's id as the directory's taxonomy names it (market-summary main_activities), or ''. */
function mainId(value: unknown) {
  const text = asText(value, 40)
  return /^[a-z][a-z0-9_.-]{0,39}$/.test(text) ? text : ''
}

/** A box on the map (west, south, east, north) to search inside, or null: a site's reach, what the map shows. */
function box(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  const [w, s, e, n] = value as number[]
  return w >= -180 && w <= e && e <= 180 && s >= -85 && s <= n && n <= 85 ? [w, s, e, n] : null
}

const signIn = () => NextResponse.json({ error: 'سجّل الدخول لعرض الجهات المطابقة.' }, { status: 401, headers: { 'cache-control': 'no-store' } })

/**
 * A signed-out visitor who searched an activity sees value before the sign-in wall: how many businesses match and
 * the first GUEST_PREVIEW of them (name, district, activity). The answer is cut here on the server (guestPreview), so
 * it never carries contact fields, ids, coordinates or more rows, whatever the client asks for. Browsing a district
 * without an activity, paging and every other field stay behind sign-in (401, as before).
 */
async function guestSearch(request: NextRequest) {
  let input: { q?: unknown; city?: unknown; district?: unknown }
  try { input = await request.json() } catch { return signIn() }
  const q = asText(input.q, 200)
  const city = cityNames[asText(input.city, 32).toLowerCase()] || asText(input.city, 64)
  const district = asText(input.district, 100)
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!q || !city || !origin || !headers) return signIn()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    // a few spare rows so a closed business at the top does not leave the preview short
    const upstream = await fetch(`${origin}/search`, {
      method: 'POST', headers, cache: 'no-store', signal: controller.signal,
      body: JSON.stringify({ q, city, limit: GUEST_PREVIEW + 5, offset: 0, objective: 'purchase', only_sendable: false, ...(district ? { filters: { district } } : {}) }),
    })
    const payload = await upstream.json().catch(() => null) as { rows?: unknown; total?: unknown } | null
    if (!upstream.ok || !payload) return signIn()
    return NextResponse.json(guestPreview(payload.rows, payload.total), { headers: { 'cache-control': 'no-store' } })
  } catch {
    return signIn()
  } finally { clearTimeout(timeout) }
}

export async function POST(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return guestSearch(request)
  if (!isTargetingAllowed(session) || !(await verifySession(session))) return NextResponse.json({ error: 'حسابك غير مخول لعرض دليل الجهات.' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  let input: { q?: unknown; city?: unknown; objective?: unknown; limit?: unknown; offset?: unknown; district?: unknown; main_id?: unknown; bounds?: unknown }
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
  // a main activity is searched by its category id (the taxonomy the city's counts use), not by its Arabic name as text;
  // a box keeps the answer inside a site's reach. Both go to the directory's own filters, checked again there.
  const main = mainId(input.main_id)
  const bounds = box(input.bounds)
  const browse = !q || Boolean(main)
  if ((!q && !district && !main && !bounds) || !city) return NextResponse.json({ error: 'اكتب النشاط أو اختر حياً، ثم اختر المدينة.' }, { status: 400 })
  if (q && !main && !objective) return NextResponse.json({ error: 'نوع البحث غير صالح.' }, { status: 400 })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return NextResponse.json({ error: 'خدمة الدليل غير مهيأة حالياً.' }, { status: 503 })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const upstream = await fetch(`${origin}/search`, {
      method: 'POST', headers,
      body: JSON.stringify(!browse
        ? { q, city, limit, offset, objective, only_sendable: false, ...(district || bounds ? { filters: { ...(district ? { district } : {}), ...(bounds ? { bounds } : {}) } } : {}) }
        : { city, limit, offset, objective: 'browse', filters: { ...(district ? { district } : {}), ...(main ? { taxonomy_main_id: main } : {}), ...(bounds ? { bounds } : {}) } }),
      cache: 'no-store', signal: controller.signal,
    })
    const payload = await upstream.json().catch(() => null) as { rows?: unknown; total?: unknown; with_whatsapp?: unknown; has_more?: unknown; next_offset?: unknown; map_query?: unknown } | null
    if (!upstream.ok || !payload) return NextResponse.json({ error: 'تعذر تحميل الجهات الآن.' }, { status: 502 })
    const rows = Array.isArray(payload.rows) ? payload.rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object')).map(sanitizeLiveDirectoryEntity).filter((row) => row.id && row.status !== 'closed_permanent') : []
    const mapQuery = isMapQuery(payload.map_query) ? payload.map_query : null
    const response = NextResponse.json({ total: typeof payload.total === 'number' ? payload.total : rows.length, withWhatsapp: typeof payload.with_whatsapp === 'number' ? payload.with_whatsapp : 0, hasMore: payload.has_more === true, nextOffset: typeof payload.next_offset === 'number' ? payload.next_offset : null, mapQuery, tileAccess: mapQuery ? issueTileAccess(mapQuery) : null, rows }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return NextResponse.json({ error: 'تعذر الاتصال بخدمة الدليل.' }, { status: 502 })
  } finally { clearTimeout(timeout) }
}
