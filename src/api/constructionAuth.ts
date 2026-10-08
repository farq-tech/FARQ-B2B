/**
 * How this UI identifies itself to `/api/construction/*` — one definition for
 * the whole app.
 *
 * Three paths, in this order, and the order is the point:
 *
 *  1. **A real session** (`Authorization: Bearer <access token>`). One account,
 *     one session, every action attributable to a person.
 *  2. **A build-time token**, dev only. Refused in production builds, because
 *     a single token baked into the bundle is a shared session for every
 *     visitor — the opposite of what was asked for.
 *  3. **Demo mode** (`x-construction-demo-user`). The Farq API accepts this
 *     ONLY when `NODE_ENV !== 'production'` AND `CONSTRUCTION_DEMO_MODE=1`
 *     (api/lib/construction/runtime.js), so it is not a production hole. It
 *     stays until real auth is proven in production; removing it is a later,
 *     separate step.
 *
 * Suppliers are deliberately absent. A supplier proves identity with the
 * one-use token in their invitation link and carries NO buyer session — see
 * `supplierPortalHeaders`.
 */

import { buildTimeAccessToken } from './apiBase'
import { farqSession } from './farqSession'

/** The demo label the Farq API maps to `CONSTRUCTION_DEMO_BUYER_USER_ID`. */
export const DEMO_ACTOR_LABEL = 'local-buyer'

export type AuthMode = 'session' | 'build-token' | 'demo'

/** Which of the three paths the next request would take. */
export function currentAuthMode(): AuthMode {
  if (farqSession.getAccessToken()) return 'session'
  if (buildTimeAccessToken()) return 'build-token'
  return 'demo'
}

/**
 * Headers for a buyer-side construction call.
 *
 * Synchronous on purpose: every existing call site expects that, and a token
 * that has just expired is handled by `request()` retrying once after a
 * refresh rather than by making every caller await here.
 */
export function constructionHeaders(extra: HeadersInit = {}): HeadersInit {
  const base: Record<string, string> = { Accept: 'application/json' }
  const sessionToken = farqSession.getAccessToken()
  if (sessionToken) {
    base.Authorization = `Bearer ${sessionToken}`
  } else {
    const fallback = buildTimeAccessToken()
    if (fallback) base.Authorization = `Bearer ${fallback}`
    // Demo mode is the last resort, and never alongside a bearer token: two
    // identities on one request is how an actor gets attributed to the wrong
    // one when the API's precedence changes.
    // A production bundle never offers the shared demo identity. The live API's
    // CORS refuses the header anyway, which turned every signed-out read into
    // an opaque network failure instead of a plain "sign in".
    else if (!import.meta.env.PROD) base['x-construction-demo-user'] = DEMO_ACTOR_LABEL
  }
  return { ...base, ...(extra as Record<string, string>) }
}

/**
 * Headers for the supplier portal.
 *
 * No `Authorization`, no demo header — the URL token IS the credential, and
 * `GET/POST /api/construction/supplier/portal/:token` runs with no authorizer
 * at all (api/routes/construction.js). Attaching a buyer session here would
 * invite someone to later "tidy up" by putting an auth guard on those routes,
 * which is exactly what would kill every live supplier link.
 */
export function supplierPortalHeaders(extra: HeadersInit = {}): HeadersInit {
  return { Accept: 'application/json', ...(extra as Record<string, string>) }
}

/**
 * Should this failed response be retried after refreshing the session?
 *
 * Only when a real session was used. In demo or build-token mode a 401 means
 * the API is not configured for that path, and retrying cannot change it.
 */
export function shouldRetryAfterRefresh(status: number, usedToken: string | null): boolean {
  return status === 401 && Boolean(usedToken) && farqSession.isAuthenticated()
}
