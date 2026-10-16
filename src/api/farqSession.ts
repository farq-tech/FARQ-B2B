// Adapted from فرق بناء (farqconstraction/src/api/farqSession.ts, ios-app@5147808): same public surface, but the
// tokens now live on the server (owner 2026-10-16: no app data on the device, and the login must survive a refresh).
/**
 * The signed-in account for Farq B2B, held by the pricing proxy (server.py + session_cookie.py), not by the browser.
 *
 *  - The proxy keeps the Farq session (access + refresh token) in ONE sealed cookie: HttpOnly, Secure, SameSite=Lax.
 *    JavaScript cannot read it; this module never sees, stores or sends a token. The proxy attaches
 *    `Authorization: Bearer …` itself when it forwards /_api/* and checks the account for /_targeting/*.
 *  - Sign-in, refresh, sign-out and password change go through the proxy's /_session/* routes, which answer with the
 *    user and the access expiry only. /_api/api/auth/{login,refresh,…} is closed so a token can never come back here.
 *  - The cookie lasts as long as the API's refresh token (30 days) and is re-issued on every rotation, so a reload or a
 *    new tab is still signed in. The proxy renews the access token shortly before it expires and serialises rotations
 *    (refresh tokens are single use; a replay revokes the family).
 *  - State-changing calls are guarded on the server by an Origin check (CSRF) on top of SameSite=Lax.
 *  - Nothing is written to any browser storage (owner rule).
 *
 * What stays from the original: one account per browser, IDENTITY_CHANGED before the causing event so per-user
 * working state is dropped, a request that saw 401 asks for exactly one refresh (collapsed across the burst), and only
 * a refused refresh ends the session — a network blip does not.
 */

export type FarqUser = {
  id: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
}

/** What the browser knows about the session: who, and until when the current access token runs. Never a token. */
export type FarqSession = {
  /** Unix seconds, as the API reports it. */
  expiresAt: number
  user: FarqUser
}

export type SessionEvent =
  | 'INITIAL'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'REFRESHED'
  | 'USER_UPDATED'
  /** The signed-in account changed (including to nobody). Emitted BEFORE the causing event. */
  | 'IDENTITY_CHANGED'

export type SessionListener = (event: SessionEvent, session: FarqSession | null) => void

/** What a refresh attempted on behalf of a 401'd request actually did. */
export type RefreshOutcome =
  | { status: 'no-session' }
  /** The proxy renewed the session; `key` is the new session marker (not a credential). */
  | { status: 'refreshed'; key: string }
  /** The API refused the refresh token. The session is over. */
  | { status: 'rejected' }
  /** Network / 5xx / rate limit. Session kept. */
  | { status: 'unreachable' }

export class FarqAuthError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'FarqAuthError'
    this.status = status
    this.code = code
  }
}

type PublicPayload = {
  user?: { id?: string; email?: string | null; email_verified?: boolean; display_name?: string | null }
  expires_at?: number
}

function toSession(p: PublicPayload | null | undefined): FarqSession | null {
  const id = String(p?.user?.id || '')
  if (!id) return null
  return {
    expiresAt: Number(p?.expires_at || 0),
    user: { id, email: p?.user?.email ?? null, emailVerified: p?.user?.email_verified === true, displayName: p?.user?.display_name ?? null },
  }
}

export type FarqSessionOptions = {
  fetchImpl?: typeof fetch
  /** Off in tests: no initial /_session/me call. */
  autoLoad?: boolean
}

export function createFarqSession(options: FarqSessionOptions = {}) {
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args))
  const listeners = new Set<SessionListener>()
  let session: FarqSession | null = null
  let lastUserId: string | null = null
  /** Bumped on every renewal: lets a burst of 401s share one refresh. */
  let generation = 0
  let checking = options.autoLoad !== false
  let inFlight: Promise<RefreshOutcome> | null = null

  function emit(event: SessionEvent, value: FarqSession | null) {
    for (const listener of listeners) {
      try { listener(event, value) } catch { /* one bad subscriber must not stop the others */ }
    }
  }
  function setSession(value: FarqSession | null, event: SessionEvent) {
    const previous = lastUserId
    session = value
    lastUserId = value?.user.id ?? null
    if (event === 'REFRESHED' || event === 'SIGNED_IN') generation += 1
    if (previous !== lastUserId) emit('IDENTITY_CHANGED', value)
    emit(event, value)
  }

  async function call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: PublicPayload | null; message: string; code: string }> {
    try {
      const response = await fetchImpl(`/_session${path}`, {
        method,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = (await response.json().catch(() => null)) as { data?: PublicPayload; errors?: Array<{ message?: string; code?: string }>; error?: string } | null
      return {
        ok: response.ok,
        status: response.status,
        data: response.ok ? payload?.data ?? null : null,
        message: payload?.errors?.[0]?.message || '',
        code: payload?.errors?.[0]?.code || payload?.error || '',
      }
    } catch {
      return { ok: false, status: 0, data: null, message: 'تعذّر الوصول إلى خدمة الحسابات.', code: 'NETWORK' }
    }
  }

  /** Ask the proxy who is signed in (on load, on focus, after a sign-in elsewhere). */
  async function check(event: SessionEvent = 'INITIAL'): Promise<FarqSession | null> {
    const r = await call('GET', '/me')
    checking = false
    if (r.ok) {
      const next = toSession(r.data)
      if (next && (next.user.id !== session?.user.id || event === 'INITIAL')) setSession(next, event === 'INITIAL' ? 'INITIAL' : 'SIGNED_IN')
      else if (next) session = next
      return session
    }
    if (r.status === 401 && session) setSession(null, 'SIGNED_OUT')
    else if (event === 'INITIAL') emit('INITIAL', session)
    return session
  }

  function seedFromQa(): boolean {
    // Development builds only (stripped from production by the DEV check): Playwright signs in without a proxy.
    if (!import.meta.env.DEV || typeof window === 'undefined') return false
    const seed = (window as unknown as { __FARQ_QA_SESSION__?: { user?: { id?: string; email?: string | null; emailVerified?: boolean; displayName?: string | null }; expiresAt?: number } }).__FARQ_QA_SESSION__
    if (!seed?.user?.id) return false
    session = { expiresAt: Number(seed.expiresAt || 0), user: { id: String(seed.user.id), email: seed.user.email ?? null, emailVerified: seed.user.emailVerified === true, displayName: seed.user.displayName ?? null } }
    lastUserId = session.user.id
    generation = 1
    checking = false
    return true
  }

  if (options.autoLoad !== false && typeof window !== 'undefined') {
    if (!seedFromQa()) {
      void check('INITIAL')
      // another tab may have signed in or out: re-read when this one comes back to the front
      window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !checking) void check('USER_UPDATED') })
    }
  }

  function signInError(r: Awaited<ReturnType<typeof call>>): FarqAuthError {
    // 503 means the deployment has no signing secret configured, which is an operator problem, not a wrong password.
    const code = r.status === 503 ? 'LOCAL_AUTH_NOT_CONFIGURED' : r.status === 429 ? 'ACCOUNT_LOCKED' : r.status === 0 ? 'NETWORK' : 'INVALID_CREDENTIALS'
    return new FarqAuthError(r.message || (r.status === 0 ? 'تعذّر الوصول إلى خدمة الحسابات.' : `HTTP ${r.status}`), r.status, code)
  }

  return {
    /** An opaque marker of the current session (changes on every renewal), or null when signed out. Not a credential. */
    sessionKey(): string | null {
      return session ? `s${generation}` : null
    },

    getUser(): FarqUser | null {
      return session?.user ?? null
    },

    isAuthenticated(): boolean {
      return session !== null
    },

    /** True until the first answer from /_session/me (do not show the sign-in form yet). */
    isChecking(): boolean {
      return checking
    },

    /** Exchange email + password for a session held by the proxy (sealed HttpOnly cookie). */
    async signIn(email: string, password: string): Promise<FarqSession> {
      const r = await call('POST', '/login', { email, password })
      const next = r.ok ? toSession(r.data) : null
      if (!r.ok) throw signInError(r)
      if (!next) throw new FarqAuthError('ردّ غير مفهوم من خدمة الحسابات.', 502, 'BAD_SESSION')
      setSession(next, 'SIGNED_IN')
      return next
    },

    /** Create an account (an invited colleague with no account yet) and sign in. */
    async signUp(email: string, password: string): Promise<FarqSession> {
      const r = await call('POST', '/signup', { email, password })
      if (!r.ok) throw new FarqAuthError(r.status === 409 ? 'هذا البريد لديه حساب بالفعل.' : r.message || 'تعذّر إنشاء الحساب.', r.status, r.status === 409 ? 'EMAIL_UNAVAILABLE' : 'SIGNUP_FAILED')
      const next = toSession(r.data)
      if (!next) throw new FarqAuthError('ردّ غير مفهوم من خدمة الحسابات.', 502, 'BAD_SESSION')
      setSession(next, 'SIGNED_IN')
      return next
    },

    /** Replace this account's password. The proxy keeps the fresh session the API returns. */
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      if (!session) throw new FarqAuthError('سجّل الدخول أولًا.', 401, 'AUTH_REQUIRED')
      const r = await call('POST', '/password', { current_password: currentPassword, new_password: newPassword })
      if (!r.ok) {
        const message = r.code === 'CURRENT_PASSWORD_INCORRECT' ? 'كلمة المرور الحالية غير صحيحة.' : r.code === 'PASSWORD_TOO_SHORT' ? 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.' : r.code === 'ACCOUNT_LOCKED' ? 'محاولات خاطئة كثيرة. حاول بعد قليل.' : 'تعذّر تغيير كلمة المرور.'
        throw new FarqAuthError(message, r.status, r.code || 'PASSWORD_CHANGE_FAILED')
      }
      const next = toSession(r.data)
      if (next) setSession(next, 'REFRESHED')
    },

    /** End this session. Local state is cleared first; the proxy clears the cookie and revokes on the API. */
    async signOut(): Promise<void> {
      setSession(null, 'SIGNED_OUT')
      await call('POST', '/logout', {})
    },

    /** Sign out of every device for this account. */
    async signOutEverywhere(): Promise<void> {
      setSession(null, 'SIGNED_OUT')
      await call('POST', '/logout', { scope: 'global' })
    },

    /**
     * Refresh on behalf of a request that just saw 401. `staleKey` is the session marker that request rode on: when
     * the session has moved on since (another 401 in the same burst refreshed it), the caller just retries.
     */
    async refreshForRequest(staleKey: string | null): Promise<RefreshOutcome> {
      if (!session) return { status: 'no-session' }
      if (staleKey && staleKey !== `s${generation}`) return { status: 'refreshed', key: `s${generation}` }
      if (inFlight) return inFlight
      const flight = (async (): Promise<RefreshOutcome> => {
        const r = await call('POST', '/refresh', {})
        if (r.ok) {
          const next = toSession(r.data)
          if (next) setSession(next, 'REFRESHED')
          return { status: 'refreshed', key: `s${generation}` }
        }
        if (r.status === 401) { setSession(null, 'SIGNED_OUT'); return { status: 'rejected' } }
        return { status: 'unreachable' }
      })()
      inFlight = flight
      void flight.finally(() => { if (inFlight === flight) inFlight = null })
      return flight
    },

    /** Re-read the account from the proxy (display name, verification). */
    async loadUser(): Promise<FarqUser | null> {
      await check('USER_UPDATED')
      return session?.user ?? null
    },

    subscribe(listener: SessionListener): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    /** Test seam. */
    dispose() {
      listeners.clear()
    },
  }
}

export type FarqSessionClient = ReturnType<typeof createFarqSession>

/** The instance the app runs on. */
export const farqSession: FarqSessionClient = createFarqSession()
