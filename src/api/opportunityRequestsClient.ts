import { apiBase } from './apiBase'
import { farqSession } from './farqSession'
import { isReadOnlyBuild } from './readOnlyMode'

/*
 * «طلباتي» on خريطة الفرص: the organization's opportunity requests on the Farq API
 * (farq-b2b-api api/routes/opportunity-requests.js, branch codex/opportunity-requests), behind the server flag
 * OPPORTUNITY_REQUESTS_ENABLED (off by default).
 *
 *   GET    /api/business/opportunity-requests?hidden=&archived=&kind=   list (exclude | include | only)
 *   POST   /api/business/opportunity-requests                           create {kind, title, payload}
 *   GET    /:id · PATCH /:id
 *   POST   /:id/cancel {reason?} · /:id/hide · /:id/unhide · /:id/archive · /:id/restore
 *   GET    /:id/audit                                                   who, role, organization, plan, action, time
 *   DELETE /:id → 405: requests are never deleted, and this client never calls it.
 *
 * Every call sends the session Bearer and x-farq-organization-id (from GET /api/business/context).
 * 404 = the flag is off (or the API is older): the page shows a quiet «قريباً». 503 = storage unavailable.
 * Permissions: VIEWER reads only; MEMBER acts on its own requests; OWNER / ADMIN on all of the organization's.
 */

const BASE = '/api/business/opportunity-requests'

export type OpportunityRequestKind = 'BOOKLET' | 'PURCHASE_REQUEST' | 'SELLER_CATALOG' | 'SELLER_PRODUCTS' | 'SEARCH'
export type OpportunityRequestStatus = 'ACTIVE' | 'CANCELLED' | 'ARCHIVED'
export type OpportunityRequestPayload = { query?: string; city?: string; filters?: Record<string, unknown>; templateName?: string; fileRefs?: string[]; products?: string[] }
export type OpportunityRequest = {
  id: string
  organizationId: string
  createdBy: string
  kind: OpportunityRequestKind | string
  title: string
  payload: OpportunityRequestPayload | null
  status: OpportunityRequestStatus | string
  hidden: boolean
  hiddenBy?: string | null
  hiddenAt?: string | null
  cancelledBy?: string | null
  cancelledAt?: string | null
  cancelReason?: string | null
  archivedBy?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt?: string | null
}
export type OpportunityAuditEvent = {
  id: string
  action: 'CREATE' | 'UPDATE' | 'CANCEL' | 'HIDE' | 'UNHIDE' | 'ARCHIVE' | 'RESTORE' | string
  actorUserId: string | null
  organizationId: string | null
  organizationName: string | null
  membershipRole: string | null
  via?: string | null
  planCode: string | null
  details?: Record<string, unknown> | null
  createdAt: string
}
/** «الكل / النشطة / المخفية / المؤرشفة» → the list query. «النشطة» also drops cancelled ones (the list does not filter status). */
export type OpportunityRequestFilter = 'all' | 'active' | 'hidden' | 'archived'
const QUERY: Record<OpportunityRequestFilter, string> = {
  all: 'hidden=include&archived=include',
  active: 'hidden=exclude&archived=exclude',
  hidden: 'hidden=only&archived=include',
  archived: 'hidden=include&archived=only',
}
export const inFilter = (r: OpportunityRequest, f: OpportunityRequestFilter) =>
  f === 'all' ? true : f === 'active' ? r.status === 'ACTIVE' && !r.hidden : f === 'hidden' ? r.hidden : r.status === 'ARCHIVED'

export type OrganizationAccess = { organizationId: string; organizationName: string; role: string; userId: string | null }
const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'MEMBER'])
const ORG_WIDE = new Set(['OWNER', 'ADMIN'])
/** Mirrors the API's canActOn: buttons the role cannot use are not shown. */
export const canActOn = (who: OrganizationAccess, r: OpportunityRequest) =>
  WRITE_ROLES.has(who.role) && (ORG_WIDE.has(who.role) || (who.userId != null && r.createdBy === who.userId))
export const canCreate = (who: OrganizationAccess) => WRITE_ROLES.has(who.role)

/** The flag is off, the API is older, or the account has no business organization: show «قريباً». */
export class OpportunityRequestsOff extends Error {
  constructor() { super('OPPORTUNITY_REQUESTS_OFF') }
}
export class OpportunityRequestsError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type Envelope<T> = { ok?: boolean; success?: boolean; data?: T; errors?: { code?: string; message?: string }[]; error?: string | { code?: string } }

/** Shared with companyProfileClient: same base URL, Bearer session and envelope handling. */
export async function raw<T>(method: 'GET' | 'POST' | 'PUT', path: string, orgId: string | null, body?: unknown): Promise<T> {
  if (method !== 'GET' && isReadOnlyBuild()) throw new OpportunityRequestsError(403, 'هذه النسخة للقراءة فقط.')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = farqSession.getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (orgId) headers['x-farq-organization-id'] = orgId
  let r: Response
  try {
    r = await fetch(`${apiBase()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new OpportunityRequestsError(0, 'ما وصلنا للخادم. تأكد من الاتصال.')
  }
  const payload = (await r.json().catch(() => null)) as Envelope<T> | null
  const code = payload?.errors?.[0]?.code || (typeof payload?.error === 'string' ? payload.error : payload?.error?.code) || ''
  // 404 on the list or with the flag's own code = the feature is off; 404 for one request is just "not found"
  if (r.status === 404 && (code === 'OPPORTUNITY_REQUESTS_DISABLED' || !code)) throw new OpportunityRequestsOff()
  if (!r.ok) {
    const msg = r.status === 503 ? 'حفظ الطلبات غير متاح مؤقتاً. حاول بعد شوي.'
      : r.status === 401 ? 'انتهت الجلسة. ادخل من جديد.'
      : r.status === 403 ? 'حسابك ما يقدر يغيّر هذا الطلب.'
      : r.status === 409 ? 'حالة الطلب تغيّرت. حدّث القائمة.'
      : r.status === 404 ? 'الطلب غير موجود.'
      : 'ما قدرنا نحفظ التغيير. حاول بعد شوي.'
    throw new OpportunityRequestsError(r.status, msg)
  }
  return (payload && 'data' in payload ? payload.data : payload) as T
}

type Organization = { id: string; name: string; role: string; subscriptions?: { sectorCode?: string }[] }
let access: Promise<OrganizationAccess> | null = null
/** The organization the requests belong to (the construction one when there are several), and this user's role in it. */
export function organizationAccess(): Promise<OrganizationAccess> {
  if (!access) {
    access = raw<{ organizations?: Organization[] }>('GET', '/api/business/context', null).then((d) => {
      const orgs = d?.organizations || []
      const org = orgs.find((o) => (o.subscriptions || []).some((s) => s.sectorCode === 'construction')) || orgs[0]
      if (!org) throw new OpportunityRequestsOff()
      return { organizationId: org.id, organizationName: org.name, role: String(org.role || '').toUpperCase(), userId: farqSession.getUser()?.id || null }
    })
    access.catch(() => { access = null })
  }
  return access
}

const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown) => raw<T>(method, `${BASE}${path}`, (await organizationAccess()).organizationId, body)
const one = (id: string, action: string, body: unknown = {}) => call<{ request: OpportunityRequest }>('POST', `/${encodeURIComponent(id)}/${action}`, body).then((d) => d.request)

export const listOpportunityRequests = (filter: OpportunityRequestFilter = 'all', kind?: OpportunityRequestKind) =>
  call<{ requests: OpportunityRequest[] }>('GET', `?${QUERY[filter]}${kind ? `&kind=${kind}` : ''}`).then((d) => (d?.requests || []).filter((r) => inFilter(r, filter)))
/** Saves a request (title ≤ 200; payload holds references only, never file contents; ≤ 16 KB). */
export const createOpportunityRequest = (body: { kind: OpportunityRequestKind; title: string; payload?: OpportunityRequestPayload }) =>
  call<{ request: OpportunityRequest }>('POST', '', { ...body, title: body.title.trim().slice(0, 200) }).then((d) => d.request)
export const getOpportunityRequest = (id: string) => call<{ request: OpportunityRequest }>('GET', `/${encodeURIComponent(id)}`).then((d) => d.request)
export const cancelOpportunityRequest = (id: string, reason?: string) => one(id, 'cancel', reason ? { reason } : {})
export const hideOpportunityRequest = (id: string) => one(id, 'hide')
export const unhideOpportunityRequest = (id: string) => one(id, 'unhide')
export const archiveOpportunityRequest = (id: string) => one(id, 'archive')
export const restoreOpportunityRequest = (id: string) => one(id, 'restore')
export const opportunityRequestAudit = (id: string) =>
  call<{ events: OpportunityAuditEvent[] }>('GET', `/${encodeURIComponent(id)}/audit`).then((d) => d?.events || [])
