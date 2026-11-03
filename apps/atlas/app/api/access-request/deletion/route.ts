import { NextRequest, NextResponse } from 'next/server'
import { isTrustedAtlasRequest } from '@/lib/same-origin'
import { normalizeContact } from '@/lib/access-request'
import { allowed, clientAddress, targetingHeaders, targetingOrigin } from '@/lib/access-request-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * «احذف بياناتي» (components/auth/delete-details-form.tsx): a person asks Farq to delete what their account request
 * holds. The targeting service keeps only the contact's hash and the time (access_requests.request_deletion), and the
 * owner deletes by hand in the console, where the matching request is flagged. The answer is the same «received»
 * whether or not the contact has a request, so nothing is revealed. Nothing is sent to anyone.
 */
function answer(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  if (!isTrustedAtlasRequest(request)) return answer({ error: 'طلب غير موثوق.' }, 403)
  let body: { contact?: unknown; website?: unknown }
  try { body = await request.json() } catch { return answer({ error: 'بيانات الطلب غير صالحة.' }, 400) }
  if (!body || typeof body !== 'object') return answer({ error: 'بيانات الطلب غير صالحة.' }, 400)
  if (typeof body.website === 'string' && body.website.trim()) return answer({ ok: true }, 200)
  if (!allowed(clientAddress(request), 'deletion')) return answer({ error: 'وصلنا طلبات كثيرة من هذا الجهاز. أعد المحاولة بعد ساعة.' }, 429)
  const contact = typeof body.contact === 'string' ? body.contact.trim() : ''
  if (!normalizeContact(contact)) {
    return answer({ error: 'راجع الحقل المعلّم.', fields: { contact: contact ? 'اكتب البريد أو الجوال كما كتبته في طلبك. مثال: 05XXXXXXXX' : 'اكتب البريد أو الجوال الذي كتبته في طلبك.' } }, 400)
  }
  const origin = targetingOrigin()
  const headers = targetingHeaders()
  if (!origin || !headers) return answer({ error: 'استقبال الطلبات غير مهيأ الآن. أعد المحاولة لاحقاً.' }, 503)
  try {
    const upstream = await fetch(`${origin}/access-requests/deletion`, {
      method: 'POST', headers, cache: 'no-store', signal: AbortSignal.timeout(10_000), body: JSON.stringify({ contact }),
    })
    if (upstream.ok) return answer({ ok: true }, 200)
    if (upstream.status === 429) return answer({ error: 'استقبال الطلبات ممتلئ اليوم. أعد المحاولة غداً.' }, 429)
    return answer({ error: 'تعذر إرسال طلبك الآن. أعد المحاولة بعد قليل.' }, 502)
  } catch {
    return answer({ error: 'تعذر إرسال طلبك الآن. أعد المحاولة بعد قليل.' }, 502)
  }
}
