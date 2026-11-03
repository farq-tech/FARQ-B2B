import { NextRequest, NextResponse } from 'next/server'
import { isTrustedAtlasRequest } from '@/lib/same-origin'
import { accessRequestBody, validateAccessRequest, type AccessRequestInput } from '@/lib/access-request'
import { allowed, clientAddress, targetingHeaders, targetingOrigin } from '@/lib/access-request-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * «اطلب حساباً» (components/auth/request-access-form.tsx). The request is checked here, then kept by the targeting
 * service for the owner (services/targeting-api/access_requests.py: a file on its runtime volume, listed at
 * GET /access-requests behind the console password). No email or message is sent to anyone and no account is created:
 * Farq reviews every request by hand. The contact details go to that store only and are never returned.
 *
 * The answer is the same «received» whether the request was stored or the same contact already has one open (the
 * service keeps one): no one can learn from it whether a contact has asked before.
 *
 * Against spam: a hidden field people never fill (the request is then dropped while answering «received»), at most
 * 5 requests per address per hour on this server (lib/access-request-server.ts), and the service's own daily cap.
 */
const MAX_BODY_BYTES = 4 * 1024

function answer(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  if (!isTrustedAtlasRequest(request)) return answer({ error: 'طلب غير موثوق.' }, 403)
  const text = await request.text().catch(() => '')
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return answer({ error: 'الطلب أطول من المسموح.' }, 413)
  let body: Record<string, unknown>
  try { body = JSON.parse(text) as Record<string, unknown> } catch { return answer({ error: 'بيانات الطلب غير صالحة.' }, 400) }
  if (!body || typeof body !== 'object') return answer({ error: 'بيانات الطلب غير صالحة.' }, 400)
  // the hidden field: a person never sees it, a form-filling script does. It is told «received» and nothing is kept.
  if (typeof body.website === 'string' && body.website.trim()) return answer({ ok: true }, 200)
  if (!allowed(clientAddress(request), 'request')) return answer({ error: 'وصلنا طلبات كثيرة من هذا الجهاز. أعد المحاولة بعد ساعة.' }, 429)

  const errors = validateAccessRequest(body)
  if (Object.keys(errors).length) return answer({ error: 'راجع الحقول المعلّمة.', fields: errors }, 400)
  const origin = targetingOrigin()
  const headers = targetingHeaders()
  if (!origin || !headers) return answer({ error: 'استقبال الطلبات غير مهيأ الآن. أعد المحاولة لاحقاً.' }, 503)
  const next = typeof body.next === 'string' ? body.next : null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const upstream = await fetch(`${origin}/access-requests`, {
      method: 'POST', headers, cache: 'no-store', signal: controller.signal,
      body: JSON.stringify(accessRequestBody(body as unknown as AccessRequestInput, next)),
    })
    const result = await upstream.json().catch(() => null) as { ok?: unknown; fields?: Record<string, unknown> } | null
    // stored, or a repeat of an open request: the same answer, nothing else passed on
    if (upstream.ok && result?.ok === true) return answer({ ok: true }, 200)
    if (upstream.status === 400 && result?.fields && 'city' in result.fields) return answer({ error: 'راجع الحقول المعلّمة.', fields: { city: 'اختر مدينتك من القائمة.' } }, 400)
    if (upstream.status === 429) return answer({ error: 'استقبال الطلبات ممتلئ اليوم. أعد المحاولة غداً.' }, 429)
    return answer({ error: 'تعذر حفظ طلبك الآن. أعد المحاولة بعد قليل.' }, 502)
  } catch {
    return answer({ error: 'تعذر حفظ طلبك الآن. أعد المحاولة بعد قليل.' }, 502)
  } finally {
    clearTimeout(timeout)
  }
}
