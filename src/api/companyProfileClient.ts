import { farqSession } from './farqSession'
import { organizationAccess, OpportunityRequestsError, OpportunityRequestsOff, raw } from './opportunityRequestsClient'
import type { BusinessProfile } from '../b2b/storage'

/*
 * «حسابي» company details (CR, VAT, national address…) on the Farq API — never on the device
 * (owner 2026-10-16: «لا اريد اي بيانات على الجهاز»).
 *
 *   GET /api/business/company-profile   → { profile }
 *   PUT /api/business/company-profile   body = BusinessProfile → { profile }
 *
 * Same Bearer session, x-farq-organization-id and base URL as opportunityRequestsClient (its `raw` and
 * `organizationAccess` are reused). 404 = the endpoint is not there yet (or no business organization):
 * the screen shows «قريباً» and stays read-only. The last profile read is cached in memory for this tab only,
 * so the price-request form can prefill from it.
 */

const PATH = '/api/business/company-profile'

export const emptyBusinessProfile = (): BusinessProfile => ({
  name: '', phone: '', city: '', email: farqSession.getUser()?.email || '', legalName: '', crNumber: '', vatNumber: '',
  nationalAddress: '', defaultDeliveryCity: '', defaultDeadlineDays: 14,
})

let cached: BusinessProfile | null = null
let cachedFor: string | null = null

/** The profile last read from (or saved to) the server in this tab; empty defaults otherwise. */
export function cachedBusinessProfile(): BusinessProfile {
  const user = farqSession.getUser()?.id || null
  return cached && cachedFor === user ? { ...cached } : emptyBusinessProfile()
}

export class CompanyProfileError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export type CompanyProfileResult = { status: 'ok'; profile: BusinessProfile } | { status: 'off' }

const MESSAGES: Record<number, string> = {
  0: 'ما وصلنا للخادم. تأكد من الاتصال.',
  401: 'انتهت الجلسة. ادخل من جديد.',
  403: 'حسابك ما يقدر يعدّل بيانات المنشأة.',
  503: 'حفظ بيانات المنشأة غير متاح مؤقتاً. حاول بعد شوي.',
}

function unwrap(d: unknown): BusinessProfile {
  const body = (d && typeof d === 'object' && 'profile' in d ? (d as { profile: unknown }).profile : d) as Partial<BusinessProfile> | null
  return { ...emptyBusinessProfile(), ...(body || {}) }
}

async function send(method: 'GET' | 'PUT', body?: BusinessProfile): Promise<CompanyProfileResult> {
  try {
    const { organizationId } = await organizationAccess()
    const profile = unwrap(await raw<unknown>(method, PATH, organizationId, body))
    cached = profile
    cachedFor = farqSession.getUser()?.id || null
    return { status: 'ok', profile: { ...profile } }
  } catch (e) {
    if (e instanceof OpportunityRequestsOff || (e instanceof OpportunityRequestsError && e.status === 404)) return { status: 'off' }
    const status = e instanceof OpportunityRequestsError ? e.status : 0
    throw new CompanyProfileError(status, MESSAGES[status] || (method === 'GET' ? 'ما قدرنا نجيب بيانات المنشأة. حاول بعد شوي.' : 'ما قدرنا نحفظ بيانات المنشأة. حاول بعد شوي.'))
  }
}

export const fetchBusinessProfile = () => send('GET')
export const saveBusinessProfile = (profile: BusinessProfile) => send('PUT', profile)
