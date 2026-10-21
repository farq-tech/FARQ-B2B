import { NextRequest, NextResponse } from 'next/server'
import { sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REQUESTS_PATH = '/api/business/opportunity-requests'
const MAX_TITLE_LENGTH = 200
const MAX_PAYLOAD_BYTES = 16 * 1024

type Organization = { id?: unknown; name?: unknown; role?: unknown; subscriptions?: { sectorCode?: unknown }[] }
type UpstreamEnvelope<T> = { data?: T; errors?: { code?: string; message?: string }[]; error?: unknown }

function origin() {
  return (process.env.FARQ_API_ORIGIN || 'https://api.farq.sa').replace(/\/$/, '')
}

function sameOrigin(request: NextRequest) {
  const source = request.headers.get('origin') || request.headers.get('referer')
  if (!source) return false
  try { return new URL(source).origin === request.nextUrl.origin } catch { return false }
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

async function upstream(session: { accessToken: string }, path: string, init: RequestInit = {}) {
  return fetch(`${origin()}${path}`, {
    ...init,
    headers: { accept: 'application/json', authorization: `Bearer ${session.accessToken}`, ...(init.headers || {}) },
    cache: 'no-store',
  })
}

async function organizationId(session: { accessToken: string }) {
  const response = await upstream(session, '/api/business/context')
  const body = await response.json().catch(() => null) as UpstreamEnvelope<{ organizations?: Organization[] }> | null
  if (!response.ok) return { error: 'تعذر التحقق من منشأتك.', status: response.status }
  const organizations = body?.data?.organizations ?? []
  const organization = organizations.find((item) => item.subscriptions?.some((subscription) => subscription.sectorCode === 'construction')) ?? organizations[0]
  if (!organization || typeof organization.id !== 'string') return { error: 'لا توجد منشأة أعمال مرتبطة بحسابك.', status: 403 }
  return { id: organization.id }
}

async function authenticated(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return { error: error('سجّل الدخول لحفظ طلباتك ومراجعتها.', 401) }
  if (!(await verifySession(session))) return { error: error('انتهت جلسة الدخول. سجّل الدخول من جديد.', 401) }
  const organization = await organizationId(session)
  if ('error' in organization) return { error: error(organization.error ?? 'تعذر التحقق من منشأتك.', organization.status ?? 502) }
  return { session, refreshed, organizationId: organization.id }
}

function responseFromUpstream(response: Response, body: unknown, session: Parameters<typeof setSession>[1], refreshed: boolean) {
  const status = response.status
  const featureDisabled = status === 404
  const message = featureDisabled
    ? 'حفظ الطلبات المركزي غير مفعّل بعد في خدمة فرق.'
    : status === 403
      ? 'حسابك لا يملك الصلاحية لهذا الإجراء.'
      : status === 401
        ? 'انتهت جلسة الدخول. سجّل الدخول من جديد.'
        : 'تعذر حفظ أو جلب الطلبات الآن. حاول لاحقاً.'
  const result = NextResponse.json(response.ok ? body : { error: message }, { status, headers: { 'cache-control': 'no-store' } })
  if (refreshed) setSession(result, session)
  return result
}

export async function GET(request: NextRequest) {
  const auth = await authenticated(request)
  if ('error' in auth) return auth.error
  const query = request.nextUrl.searchParams
  const allowed = new URLSearchParams()
  for (const key of ['hidden', 'archived', 'kind']) {
    const value = query.get(key)
    if (value) allowed.set(key, value)
  }
  const response = await upstream(auth.session, `${REQUESTS_PATH}${allowed.size ? `?${allowed}` : ''}`, {
    headers: { 'x-farq-organization-id': auth.organizationId },
  })
  const body = await response.json().catch(() => null)
  return responseFromUpstream(response, body, auth.session, auth.refreshed)
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return error('طلب غير موثوق.', 403)
  const auth = await authenticated(request)
  if ('error' in auth) return auth.error
  let body: { kind?: unknown; title?: unknown; payload?: unknown }
  try { body = await request.json() } catch { return error('بيانات الطلب غير صالحة.', 400) }
  const kind = typeof body.kind === 'string' ? body.kind : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!['BOOKLET', 'PURCHASE_REQUEST', 'SELLER_CATALOG', 'SELLER_PRODUCTS', 'SEARCH'].includes(kind) || !title || title.length > MAX_TITLE_LENGTH) {
    return error('نوع الطلب أو عنوانه غير صالح.', 400)
  }
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) return error('تفاصيل الطلب كبيرة جداً للحفظ.', 413)
  const response = await upstream(auth.session, REQUESTS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-farq-organization-id': auth.organizationId },
    body: JSON.stringify({ kind, title, payload }),
  })
  const result = await response.json().catch(() => null)
  return responseFromUpstream(response, result, auth.session, auth.refreshed)
}
