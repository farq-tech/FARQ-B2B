import { NextRequest, NextResponse } from 'next/server'
import { isTrustedAtlasRequest } from '@/lib/same-origin'
import { sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'
import { isInboxOwner, targetingHeaders, targetingOrigin } from '@/lib/inbox-account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Farq owner review of WhatsApp replies that could not be matched to a campaign (ATLAS_INBOX_OWNER_EMAILS only). A
 * reply can be placed only on a campaign message the service sent to the same number, or set aside. The number is
 * shown masked; each candidate is named by its business, its request and when it was sent.
 */

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

const ID = /^[A-Za-z0-9_\-:.=+/]{1,256}$/
const isoTime = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : null

async function owner(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return { failed: error('سجّل الدخول أولاً.', 401) }
  if (!(await verifySession(session))) return { failed: error('انتهت جلسة الدخول. سجّل الدخول من جديد.', 401) }
  if (!isInboxOwner(session)) return { failed: error('هذه الصفحة لمالك فرق فقط.', 403) }
  const origin = targetingOrigin()
  const headers = targetingHeaders()
  if (!origin || !headers) return { failed: error('استقبال الردود غير مهيأ.', 503) }
  return { session, refreshed, origin, headers }
}

export async function GET(request: NextRequest) {
  const auth = await owner(request)
  if ('failed' in auth) return auth.failed
  try {
    const upstream = await fetch(`${auth.origin}/inbox/unlinked`, { headers: auth.headers, cache: 'no-store' })
    const payload = await upstream.json().catch(() => null) as { ok?: unknown; messages?: unknown[] } | null
    if (!upstream.ok || payload?.ok !== true) return error('تعذر جلب الردود غير المرتبطة.', 502)
    const messages = (Array.isArray(payload.messages) ? payload.messages : []).flatMap((item) => {
      const m = item as Record<string, unknown>
      const receivedAt = isoTime(m.receivedAt)
      if (typeof m.id !== 'string' || !ID.test(m.id) || !receivedAt) return []
      const candidates = (Array.isArray(m.candidates) ? m.candidates : []).flatMap((entry) => {
        const c = entry as Record<string, unknown>
        const sentAt = isoTime(c.sentAt)
        return typeof c.outboundId === 'string' && ID.test(c.outboundId) && sentAt
          ? [{ outboundId: c.outboundId, account: text(c.accountId, 80), requestId: text(c.requestId, 160), name: text(c.name, 200), sentAt }] : []
      })
      return [{ id: m.id, from: text(m.from, 20), kind: text(m.kind, 20) ?? 'unsupported', body: text(m.body, 4096) ?? '', receivedAt, candidates }]
    })
    const response = NextResponse.json({ ok: true, messages }, { headers: { 'cache-control': 'no-store' } })
    if (auth.refreshed) setSession(response, auth.session)
    return response
  } catch {
    return error('تعذر جلب الردود غير المرتبطة.', 502)
  }
}

/** `{ action: 'attach', messageId, outboundId }` or `{ action: 'dismiss', messageId }`. */
export async function POST(request: NextRequest) {
  if (!isTrustedAtlasRequest(request)) return error('طلب غير موثوق.', 403)
  const auth = await owner(request)
  if ('failed' in auth) return auth.failed
  let input: { action?: unknown; messageId?: unknown; outboundId?: unknown }
  try { input = await request.json() } catch { return error('بيانات غير صالحة.', 400) }
  const messageId = typeof input.messageId === 'string' && ID.test(input.messageId) ? input.messageId : null
  const outboundId = typeof input.outboundId === 'string' && ID.test(input.outboundId) ? input.outboundId : null
  if (!messageId || (input.action !== 'dismiss' && !(input.action === 'attach' && outboundId))) return error('بيانات غير صالحة.', 400)
  const reviewer = auth.session.user.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  try {
    const upstream = await fetch(`${auth.origin}/inbox/${input.action === 'attach' ? 'attach' : 'dismiss'}`, {
      method: 'POST', headers: auth.headers, cache: 'no-store',
      body: JSON.stringify({ message_id: messageId, outbound_id: outboundId, reviewer }),
    })
    const payload = await upstream.json().catch(() => null) as { ok?: unknown } | null
    if (upstream.status === 409) return error('تغيّرت الرسالة أو لم تعد بانتظار المراجعة.', 409)
    if (!upstream.ok || payload?.ok !== true) return error('تعذر حفظ المراجعة.', 502)
    const response = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
    if (auth.refreshed) setSession(response, auth.session)
    return response
  } catch {
    return error('تعذر حفظ المراجعة.', 502)
  }
}
