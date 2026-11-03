import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { inboxAccount, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The signed-in account's WhatsApp replies, read from the targeting service that receives them. The account is taken
 * from this server's own session, never from the browser, so one account cannot ask for another's messages. The
 * service returns no phone numbers; this route passes on only the fields the inbox shows.
 */

function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { accept: 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { accept: 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

const ID = /^[A-Za-z0-9_\-:.]{1,256}$/
const KINDS = new Set(['text', 'button', 'interactive', 'image', 'video', 'audio', 'voice', 'document', 'sticker', 'location', 'contacts', 'reaction', 'order', 'unsupported'])
const STATUSES = new Set(['sent', 'delivered', 'read', 'failed'])
const isoTime = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null

export async function GET(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return error('سجّل الدخول لترى رسائلك.', 401)
  if (!(await verifySession(session))) return error('انتهت جلسة الدخول. سجّل الدخول من جديد.', 401)
  const account = inboxAccount(session)
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!account) return error('تعذر التحقق من حسابك.', 403)
  if (!origin || !headers) return error('استقبال الردود غير مهيأ.', 503)
  const since = request.nextUrl.searchParams.get('since')
  const query = new URLSearchParams({ account })
  if (since && /^\d{1,12}$/.test(since)) query.set('since', since)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const upstream = await fetch(`${origin}/inbox?${query}`, { headers, cache: 'no-store', signal: controller.signal })
    const payload = await upstream.json().catch(() => null) as { ok?: unknown; messages?: unknown[]; deliveries?: unknown[] } | null
    if (!upstream.ok || payload?.ok !== true) return error('تعذر جلب الردود الآن.', 502)
    const messages = (Array.isArray(payload.messages) ? payload.messages : []).flatMap((item) => {
      const m = item as Record<string, unknown>
      const receivedAt = isoTime(m.receivedAt)
      if (typeof m.id !== 'string' || !ID.test(m.id) || typeof m.requestId !== 'string' || typeof m.poiKey !== 'string' || !receivedAt) return []
      return [{
        id: m.id, requestId: m.requestId, poiKey: m.poiKey, receivedAt,
        kind: typeof m.kind === 'string' && KINDS.has(m.kind) ? m.kind : 'unsupported',
        body: typeof m.body === 'string' ? m.body.slice(0, 4096) : '',
      }]
    })
    const deliveries = (Array.isArray(payload.deliveries) ? payload.deliveries : []).flatMap((item) => {
      const d = item as Record<string, unknown>
      return typeof d.requestId === 'string' && typeof d.poiKey === 'string' && typeof d.status === 'string' && STATUSES.has(d.status)
        ? [{ requestId: d.requestId, poiKey: d.poiKey, status: d.status, at: isoTime(d.at) }] : []
    })
    const response = NextResponse.json({ ok: true, messages, deliveries }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(response, session)
    return response
  } catch {
    return error('تعذر جلب الردود الآن.', 502)
  } finally {
    clearTimeout(timeout)
  }
}
