import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTrustedAtlasRequest } from '@/lib/same-origin'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

async function authorized(request: NextRequest) {
  if (!isTrustedAtlasRequest(request)) return error('طلب الإرسال غير موثوق.', 403)
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return error('سجّل الدخول قبل إرسال الحملة.', 401)
  if (!isTargetingAllowed(session) || !(await verifySession(session))) return error('حسابك غير مخول لإرسال الحملات.', 403)
  return { session, refreshed }
}

export async function GET(request: NextRequest) {
  const auth = await authorized(request)
  if (auth instanceof NextResponse) return auth
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return error('خدمة الإرسال السحابي غير مهيأة.', 503)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const upstream = await fetch(`${origin}/templates`, { headers, cache: 'no-store', signal: controller.signal })
    const payload = await upstream.json().catch(() => null) as { ok?: unknown; error?: unknown; data?: unknown[] } | null
    const template = Array.isArray(payload?.data)
      ? payload.data.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).name === 'farq_outreach_ar' && (item as Record<string, unknown>).language === 'ar') as Record<string, unknown> | undefined
      : undefined
    const response = NextResponse.json({
      ready: upstream.ok && payload?.ok === true && template?.status === 'APPROVED',
      status: typeof template?.status === 'string' ? template.status : typeof payload?.error === 'string' ? payload.error : 'MISSING',
    }, { status: upstream.ok ? 200 : 502, headers: { 'cache-control': 'no-store' } })
    if (auth.refreshed) setSession(response, auth.session)
    return response
  } catch {
    return error('تعذر التحقق من قالب واتساب السحابي.', 502)
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorized(request)
  if (auth instanceof NextResponse) return auth

  let input: { poiKey?: unknown; message?: unknown }
  try { input = await request.json() } catch { return error('بيانات الإرسال غير صالحة.', 400) }
  const poiKey = typeof input.poiKey === 'string' ? input.poiKey.trim() : ''
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  if (!/^[A-Za-z0-9:_\-.]{1,200}$/.test(poiKey) || !message || message.length > 1024) {
    return error('الجهة أو نص الرسالة غير صالح.', 400)
  }

  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()
  if (!origin || !headers) return error('خدمة الإرسال السحابي غير مهيأة.', 503)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const upstream = await fetch(`${origin}/send-template`, {
      method: 'POST', headers,
      body: JSON.stringify({ poi_key: poiKey, message, template: 'farq_outreach_ar' }),
      cache: 'no-store', signal: controller.signal,
    })
    const payload = await upstream.json().catch(() => null) as { ok?: unknown; message_id?: unknown; error?: unknown; code?: unknown } | null
    const response = NextResponse.json({
      ok: upstream.ok && payload?.ok === true,
      messageId: typeof payload?.message_id === 'string' ? payload.message_id : null,
      error: typeof payload?.error === 'string' ? payload.error.slice(0, 240) : undefined,
      code: typeof payload?.code === 'number' || typeof payload?.code === 'string' ? payload.code : undefined,
    }, { status: upstream.ok ? 200 : upstream.status >= 500 ? 502 : upstream.status, headers: { 'cache-control': 'no-store' } })
    if (auth.refreshed) setSession(response, auth.session)
    return response
  } catch {
    return error('تعذر تأكيد نتيجة الإرسال. تحقّق من حالة الرسالة قبل إعادة المحاولة.', 502)
  } finally {
    clearTimeout(timeout)
  }
}
