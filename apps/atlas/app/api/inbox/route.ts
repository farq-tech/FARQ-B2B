import { NextRequest, NextResponse } from 'next/server'
import { isTrustedAtlasRequest } from '@/lib/same-origin'
import { sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'
import { accountsFor, isInboxOwner, targetingHeaders, targetingOrigin } from '@/lib/inbox-account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The signed-in person's WhatsApp replies (their organisation's and their own), read from the targeting service that
 * receives them, and their read state. The accounts are taken from this server's session, never from the browser, so
 * nobody can ask for another account's messages. The service returns no phone numbers; this route passes on only the
 * fields the inbox shows.
 */

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

const ID = /^[A-Za-z0-9_\-:.=+/]{1,256}$/
const KINDS = new Set(['text', 'button', 'interactive', 'image', 'video', 'audio', 'voice', 'document', 'sticker', 'location', 'contacts', 'reaction', 'order', 'unsupported'])
const STATUSES = new Set(['sent', 'delivered', 'read', 'failed'])
const isoTime = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null

async function signedIn(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return { failed: error('سجّل الدخول لترى رسائلك.', 401) }
  if (!(await verifySession(session))) return { failed: error('انتهت جلسة الدخول. سجّل الدخول من جديد.', 401) }
  const accounts = await accountsFor(session)
  if (!accounts.read.length) return { failed: error('تعذر التحقق من حسابك.', 403) }
  const origin = targetingOrigin()
  const headers = targetingHeaders()
  if (!origin || !headers) return { failed: error('استقبال الردود غير مهيأ.', 503) }
  return { session, refreshed, accounts, origin, headers }
}

export async function GET(request: NextRequest) {
  const auth = await signedIn(request)
  if ('failed' in auth) return auth.failed
  const since = request.nextUrl.searchParams.get('since')
  const query = new URLSearchParams()
  for (const account of auth.accounts.read) query.append('account', account)
  if (since && /^\d{1,12}$/.test(since)) query.set('since', since)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const upstream = await fetch(`${auth.origin}/inbox?${query}`, { headers: auth.headers, cache: 'no-store', signal: controller.signal })
    const payload = await upstream.json().catch(() => null) as { ok?: unknown; messages?: unknown[]; deliveries?: unknown[]; requests?: unknown[]; elsewhere?: unknown[] } | null
    if (!upstream.ok || payload?.ok !== true) return error('تعذر جلب الردود الآن.', 502)
    const messages = (Array.isArray(payload.messages) ? payload.messages : []).flatMap((item) => {
      const m = item as Record<string, unknown>
      const receivedAt = isoTime(m.receivedAt)
      if (typeof m.id !== 'string' || !ID.test(m.id) || typeof m.requestId !== 'string' || typeof m.poiKey !== 'string' || !receivedAt) return []
      return [{
        id: m.id, requestId: m.requestId, poiKey: m.poiKey, receivedAt,
        kind: typeof m.kind === 'string' && KINDS.has(m.kind) ? m.kind : 'unsupported',
        body: typeof m.body === 'string' ? m.body.slice(0, 4096) : '',
        read: m.read === true,
      }]
    })
    const deliveries = (Array.isArray(payload.deliveries) ? payload.deliveries : []).flatMap((item) => {
      const d = item as Record<string, unknown>
      return typeof d.requestId === 'string' && typeof d.poiKey === 'string' && typeof d.status === 'string' && STATUSES.has(d.status)
        ? [{ requestId: d.requestId, poiKey: d.poiKey, status: d.status, at: isoTime(d.at) }] : []
    })
    // per request: recipients reached, replied, median seconds to a first reply (counts only)
    const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
    const requests = (Array.isArray(payload.requests) ? payload.requests : []).flatMap((item) => {
      const r = item as Record<string, unknown>
      const sent = count(r.sent); const replied = count(r.replied)
      return typeof r.requestId === 'string' && sent != null && replied != null ? [{ requestId: r.requestId, sent, replied, medianReplySeconds: count(r.medianReplySeconds) }] : []
    })
    // a recipient that has not answered this request but answered another of the person's campaigns (the reply's id)
    const elsewhere = (Array.isArray(payload.elsewhere) ? payload.elsewhere : []).flatMap((item) => {
      const e = item as Record<string, unknown>
      return typeof e.requestId === 'string' && typeof e.poiKey === 'string' && typeof e.otherRequestId === 'string' && typeof e.messageId === 'string' && ID.test(e.messageId)
        ? [{ requestId: e.requestId, poiKey: e.poiKey, otherRequestId: e.otherRequestId, messageId: e.messageId, at: isoTime(e.at) }] : []
    })
    // `owner` only shows the link to the review of unlinked replies; that page checks again on the server
    const response = NextResponse.json({ ok: true, messages, deliveries, requests, elsewhere, owner: isInboxOwner(auth.session) }, { headers: { 'cache-control': 'no-store' } })
    if (auth.refreshed) setSession(response, auth.session)
    return response
  } catch {
    return error('تعذر جلب الردود الآن.', 502)
  } finally {
    clearTimeout(timeout)
  }
}

/** Marks replies read or unread for every device of the person: `{ ids: string[], read: boolean }`. */
export async function POST(request: NextRequest) {
  if (!isTrustedAtlasRequest(request)) return error('طلب غير موثوق.', 403)
  const auth = await signedIn(request)
  if ('failed' in auth) return auth.failed
  let input: { ids?: unknown; read?: unknown }
  try { input = await request.json() } catch { return error('بيانات غير صالحة.', 400) }
  const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string' && ID.test(id)).slice(0, 200) : []
  if (!ids.length || typeof input.read !== 'boolean') return error('بيانات غير صالحة.', 400)
  try {
    const upstream = await fetch(`${auth.origin}/inbox/read`, {
      method: 'POST', headers: auth.headers, cache: 'no-store',
      body: JSON.stringify({ account: auth.accounts.read, ids, read: input.read }),
    })
    const payload = await upstream.json().catch(() => null) as { ok?: unknown; changed?: unknown } | null
    if (!upstream.ok || payload?.ok !== true) return error('تعذر حفظ حالة القراءة.', 502)
    const response = NextResponse.json({ ok: true, changed: typeof payload.changed === 'number' ? payload.changed : 0 }, { headers: { 'cache-control': 'no-store' } })
    if (auth.refreshed) setSession(response, auth.session)
    return response
  } catch {
    return error('تعذر حفظ حالة القراءة.', 502)
  }
}
