import { NextRequest, NextResponse } from 'next/server'
import { isTrustedAtlasRequest } from '@/lib/same-origin'
import { sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_TITLE_LENGTH = 200
const MAX_PAYLOAD_BYTES = 16 * 1024

type Organization = { id?: unknown; subscriptions?: { sectorCode?: unknown }[] }
type Envelope<T> = { data?: T }

function origin() { return (process.env.FARQ_API_ORIGIN || 'https://api.farq.sa').replace(/\/$/, '') }
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } }) }
async function api(session: { accessToken: string }, path: string, init?: RequestInit) {
  return fetch(`${origin()}${path}`, { ...init, headers: { accept: 'application/json', authorization: `Bearer ${session.accessToken}`, ...(init?.headers || {}) }, cache: 'no-store' })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAtlasRequest(request)) return error('طلب غير موثوق.', 403)
  const { session, refreshed } = await sessionForRequest(request)
  if (!session || !(await verifySession(session))) return error('انتهت جلسة الدخول. سجّل الدخول من جديد.', 401)
  const contextResponse = await api(session, '/api/business/context')
  const contextBody = await contextResponse.json().catch(() => null) as Envelope<{ organizations?: Organization[] }> | null
  const organizations = contextBody?.data?.organizations ?? []
  const organization = organizations.find((item) => item.subscriptions?.some((subscription) => subscription.sectorCode === 'construction')) ?? organizations[0]
  if (!contextResponse.ok || !organization || typeof organization.id !== 'string') return error('لا توجد منشأة أعمال مرتبطة بحسابك.', contextResponse.ok ? 403 : contextResponse.status)
  const { id } = await context.params
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) return error('معرف الطلب غير صالح.', 400)
  let body: { title?: unknown; payload?: unknown }
  try { body = await request.json() } catch { return error('بيانات الطلب غير صالحة.', 400) }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
  if (!title || title.length > MAX_TITLE_LENGTH) return error('عنوان الطلب غير صالح.', 400)
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) return error('تفاصيل الطلب كبيرة جداً للحفظ.', 413)
  const response = await api(session, `/api/business/opportunity-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', 'x-farq-organization-id': organization.id }, body: JSON.stringify({ title, payload }),
  })
  const result = await response.json().catch(() => null)
  const message = response.status === 404 ? 'الطلب غير متاح في خدمة فرق.' : response.status === 403 ? 'حسابك لا يملك الصلاحية لهذا الإجراء.' : 'تعذر حفظ التغيير الآن. حاول لاحقاً.'
  const output = NextResponse.json(response.ok ? result : { error: message }, { status: response.status, headers: { 'cache-control': 'no-store' } })
  if (refreshed) setSession(output, session)
  return output
}
