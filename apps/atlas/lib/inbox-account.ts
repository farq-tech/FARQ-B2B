import { createHmac } from 'node:crypto'
import { inboxAccounts, type InboxAccounts } from './inbox-scope.ts'

/**
 * Server-only: who a WhatsApp campaign message and its replies belong to, and who may review replies nobody could be
 * matched to. The account is the person's Farq organisation (the one the requests are saved under, from
 * `/api/business/context`), so teammates share the replies; `user-<id>` is kept beside it so a person without an
 * organisation, or messages sent before they joined one, still reach them. Nothing here is read from the browser.
 */

type Session = { accessToken: string; user: { id: string; email: string | null; emailVerified: boolean } }
type Organization = { id?: unknown; subscriptions?: { sectorCode?: unknown }[] }

const ORG_TTL_MS = 5 * 60_000
const organizations = new Map<string, { id: string | null; at: number }>()

function apiOrigin() {
  return (process.env.FARQ_API_ORIGIN || 'https://api.farq.sa').replace(/\/$/, '')
}

/** The organisation the person's requests are saved under: the construction one, else the first. Null when none. */
async function organizationId(session: Session): Promise<string | null> {
  const cached = organizations.get(session.user.id)
  if (cached && Date.now() - cached.at < ORG_TTL_MS) return cached.id
  try {
    const response = await fetch(`${apiOrigin()}/api/business/context`, {
      headers: { accept: 'application/json', authorization: `Bearer ${session.accessToken}` }, cache: 'no-store',
    })
    if (!response.ok) return null   // not cached: a passing failure must not file replies under the person alone for 5 minutes
    const body = await response.json().catch(() => null) as { data?: { organizations?: Organization[] } } | null
    const list = body?.data?.organizations ?? []
    const organization = list.find((item) => item.subscriptions?.some((s) => s.sectorCode === 'construction')) ?? list[0]
    const id = organization && typeof organization.id === 'string' ? organization.id : null
    organizations.set(session.user.id, { id, at: Date.now() })
    return id
  } catch {
    return null
  }
}

export async function accountsFor(session: Session): Promise<InboxAccounts> {
  return inboxAccounts(await organizationId(session), session.user.id)
}

/** A Farq owner who reviews unlinked replies: a verified email listed in ATLAS_INBOX_OWNER_EMAILS (empty: nobody). */
export function isInboxOwner(session: Session) {
  const owners = (process.env.ATLAS_INBOX_OWNER_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
  return session.user.emailVerified && !!session.user.email && owners.includes(session.user.email.toLowerCase())
}

export function targetingOrigin() {
  return process.env.TARGETING_ORIGIN?.replace(/\/$/, '') || null
}

export function targetingHeaders(): Record<string, string> | null {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { accept: 'application/json', 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { accept: 'application/json', 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}
