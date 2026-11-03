import { NextRequest, NextResponse } from 'next/server'
import { isTrustedAtlasRequest } from '@/lib/same-origin'
import { sessionForRequest, setSession } from '@/lib/atlas-session'
import { MAX_VIEWS, VIEW_SCHEMA, dedupeViews, readView, viewKey, viewPayload, type SavedView } from '@/lib/saved-views'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The signed-in account's saved comparisons («المقارنات المحفوظة», lib/saved-views.ts), so they open on any device.
 *
 * Kept where Atlas already keeps the account's requests: the Farq API's opportunity requests of the account's
 * organization (/api/business/opportunity-requests, the same store as app/api/requests). One record per comparison,
 * kind SEARCH, payload `{ schema: 'atlas-saved-view-v1', view }` holding only the map address, the name, the city's
 * names and the district names: no figure. Each record is hidden as soon as it is made, so it stays out of the
 * organization's request lists; it is read back only by the person who made it (createdBy). Deleting archives the
 * record (the Farq API never deletes one).
 *
 *   GET            → { views }        the account's comparisons, newest first, one per view
 *   POST { view }  → { view }         saves one; the same view again renames the record instead of adding one
 *   DELETE { href }→ { ok }           takes every record of that view out
 *
 * 401 = signed out, 404 = the store is off for this account: the device keeps its own list either way.
 */
const BASE = '/api/business/opportunity-requests'

type Organization = { id?: unknown; subscriptions?: { sectorCode?: unknown }[] }
type Record_ = { id?: unknown; createdBy?: unknown; status?: unknown; payload?: unknown; createdAt?: unknown }
type Session = NonNullable<Awaited<ReturnType<typeof sessionForRequest>>['session']>

function origin() { return (process.env.FARQ_API_ORIGIN || 'https://api.farq.sa').replace(/\/$/, '') }
function answer(body: unknown, status: number, auth?: { session: Session; refreshed: boolean }) {
  const response = NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
  if (auth?.refreshed) setSession(response, auth.session)
  return response
}

async function api(session: Session, organizationId: string | null, path: string, init: RequestInit = {}) {
  return fetch(`${origin()}${path}`, {
    ...init,
    headers: {
      accept: 'application/json', authorization: `Bearer ${session.accessToken}`,
      ...(organizationId ? { 'x-farq-organization-id': organizationId } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    cache: 'no-store',
  })
}

async function account(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return { error: answer({ error: 'سجّل الدخول لحفظ مقارناتك في حسابك.' }, 401) }
  const context = await api(session, null, '/api/business/context')
  if (context.status === 401) return { error: answer({ error: 'انتهت جلسة الدخول. سجّل الدخول من جديد.' }, 401) }
  const body = await context.json().catch(() => null) as { data?: { organizations?: Organization[] } } | null
  const organizations = body?.data?.organizations ?? []
  const organization = organizations.find((item) => item.subscriptions?.some((subscription) => subscription.sectorCode === 'construction')) ?? organizations[0]
  // no business organization: there is nowhere in the account to keep them, so the device keeps them (404, not an error)
  if (!context.ok || !organization || typeof organization.id !== 'string') return { error: answer({ error: 'حفظ المقارنات في الحساب غير متاح لهذا الحساب.' }, 404) }
  return { session, refreshed, organizationId: organization.id }
}

type Account = Exclude<Awaited<ReturnType<typeof account>>, { error: NextResponse }>
type Stored = { recordId: string; view: SavedView }

/** This person's saved-comparison records, newest first (records of other people in the organization are left out). */
async function records(auth: Account): Promise<Stored[] | { status: number }> {
  const response = await api(auth.session, auth.organizationId, `${BASE}?kind=SEARCH&hidden=include&archived=exclude`)
  if (!response.ok) return { status: response.status }
  const body = await response.json().catch(() => null) as { data?: { requests?: Record_[] }; requests?: Record_[] } | null
  const mine = auth.session.user.id
  const out: Stored[] = []
  for (const record of body?.data?.requests ?? body?.requests ?? []) {
    const payload = record.payload && typeof record.payload === 'object' ? record.payload as { schema?: unknown; view?: unknown } : null
    if (payload?.schema !== VIEW_SCHEMA || typeof record.id !== 'string') continue
    if (record.status === 'CANCELLED' || record.status === 'ARCHIVED') continue
    if (typeof record.createdBy === 'string' && record.createdBy !== mine) continue
    const view = readView(payload.view)
    if (view) out.push({ recordId: record.id, view: { ...view, synced: true } })
  }
  return out.sort((a, b) => (a.view.createdAt < b.view.createdAt ? 1 : a.view.createdAt > b.view.createdAt ? -1 : 0))
}

const unavailable = (status: number, auth: Account) => answer(
  { error: status === 404 ? 'حفظ المقارنات في الحساب غير مفعّل بعد.' : 'تعذر الوصول إلى مقارناتك المحفوظة الآن.' },
  status === 404 ? 404 : status === 401 ? 401 : 502, auth)

const archive = (auth: Account, recordId: string) =>
  api(auth.session, auth.organizationId, `${BASE}/${encodeURIComponent(recordId)}/archive`, { method: 'POST', body: '{}' })

export async function GET(request: NextRequest) {
  const auth = await account(request)
  if ('error' in auth) return auth.error
  const list = await records(auth)
  if (!Array.isArray(list)) return unavailable(list.status, auth)
  return answer({ views: dedupeViews(list.map((item) => item.view)) }, 200, auth)
}

export async function POST(request: NextRequest) {
  if (!isTrustedAtlasRequest(request)) return answer({ error: 'طلب غير موثوق.' }, 403)
  const auth = await account(request)
  if ('error' in auth) return auth.error
  let body: { view?: unknown }
  try { body = await request.json() } catch { return answer({ error: 'بيانات المقارنة غير صالحة.' }, 400, auth) }
  const view = readView(body.view)
  if (!view) return answer({ error: 'بيانات المقارنة غير صالحة.' }, 400, auth)
  const list = await records(auth)
  if (!Array.isArray(list)) return unavailable(list.status, auth)
  const key = viewKey(view.href)
  const same = list.filter((item) => viewKey(item.view.href) === key)
  const payload = JSON.stringify({ title: view.name, payload: viewPayload(view) })
  if (same.length) {
    const response = await api(auth.session, auth.organizationId, `${BASE}/${encodeURIComponent(same[0].recordId)}`, { method: 'PATCH', body: payload })
    if (!response.ok) return unavailable(response.status, auth)
    await Promise.all(same.slice(1).map((item) => archive(auth, item.recordId).catch(() => undefined)))
    return answer({ view: { ...view, synced: true } }, 200, auth)
  }
  // the cap: the oldest beyond MAX_VIEWS - 1 make room for this one
  await Promise.all(list.slice(MAX_VIEWS - 1).map((item) => archive(auth, item.recordId).catch(() => undefined)))
  const created = await api(auth.session, auth.organizationId, BASE, { method: 'POST', body: JSON.stringify({ kind: 'SEARCH', title: view.name, payload: viewPayload(view) }) })
  if (!created.ok) return unavailable(created.status, auth)
  const result = await created.json().catch(() => null) as { data?: { request?: { id?: unknown } }; request?: { id?: unknown } } | null
  const id = result?.data?.request?.id ?? result?.request?.id
  // hidden from the organization's request lists: a saved comparison is not a request anyone acts on
  if (typeof id === 'string') await api(auth.session, auth.organizationId, `${BASE}/${encodeURIComponent(id)}/hide`, { method: 'POST', body: '{}' }).catch(() => undefined)
  return answer({ view: { ...view, synced: true } }, 201, auth)
}

export async function DELETE(request: NextRequest) {
  if (!isTrustedAtlasRequest(request)) return answer({ error: 'طلب غير موثوق.' }, 403)
  const auth = await account(request)
  if ('error' in auth) return auth.error
  let body: { href?: unknown }
  try { body = await request.json() } catch { return answer({ error: 'بيانات المقارنة غير صالحة.' }, 400, auth) }
  if (typeof body.href !== 'string' || body.href.length > 600) return answer({ error: 'بيانات المقارنة غير صالحة.' }, 400, auth)
  const list = await records(auth)
  if (!Array.isArray(list)) return unavailable(list.status, auth)
  const key = viewKey(body.href)
  const results = await Promise.all(list.filter((item) => viewKey(item.view.href) === key).map((item) => archive(auth, item.recordId).then((response) => response.ok).catch(() => false)))
  return results.every(Boolean) ? answer({ ok: true }, 200, auth) : answer({ error: 'تعذر حذف المقارنة من حسابك الآن.' }, 502, auth)
}
