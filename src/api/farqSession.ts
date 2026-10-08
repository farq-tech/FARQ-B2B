/**
 * Real per-account sessions for فرق للبناء, against Farq's own Postgres-backed
 * identity (`POST /api/auth/login|refresh|logout`, `GET /api/auth/me`).
 *
 * There is no Supabase here. The Farq API verifies its own HS256 tokens
 * locally and first (api/lib/outbound-redirect/authUser.js), so this path
 * keeps working while any external identity provider is down — which is the
 * whole reason native auth exists (docs/LOCAL_AUTH.md).
 *
 * Decisions worth knowing before changing anything:
 *
 *  - **One account per browser.** The session lives under a single storage
 *    key. Signing in as someone else replaces it rather than running two
 *    identities side by side, and every listener is told the identity changed
 *    so per-user working state (uploaded كراسة, draft RFQ) is dropped instead
 *    of being shown to the next account.
 *  - **The refresh token is single-use.** The server rotates it and treats a
 *    replayed token as theft, revoking the whole family
 *    (api/lib/auth/localAuthStore.js → redeemRefreshToken). So refreshes are
 *    collapsed into one in-flight promise, and storage is re-read first in
 *    case another tab already rotated it.
 *  - **A failed refresh is not always a sign-out.** Only a 401 ends the
 *    session. A network blip or 5xx keeps it and backs off, because treating
 *    an unreachable server as "logged out" is how a dropped Wi-Fi connection
 *    turns into losing an in-progress tender.
 *  - **No session continuity is assumed.** `FARQ_AUTH_JWT_SECRET` is being
 *    rotated; that invalidates issued access tokens. A 401 triggers exactly
 *    one refresh, and a refused refresh signs out cleanly and asks for a
 *    password again. Nothing here depends on a token surviving a deploy.
 */

import { apiBase } from './apiBase'

const STORAGE_KEY = 'farq_construction_session_v1'
/** Renew this far ahead of expiry so a request never rides a dead token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000
/**
 * Floor for the first retry after a refresh that failed WITHOUT being refused.
 *
 * Without it, the next delay is recomputed from an already-past `expires_at`,
 * clamps to zero, and re-arms immediately — a tight loop that hammers
 * `POST /api/auth/refresh` for as long as the network is down and burns the
 * route's 120-per-15-minutes limit. The main Farq frontend hit exactly this.
 */
const RETRY_BASE_MS = 5 * 1000
const RETRY_MAX_MS = 5 * 60 * 1000

export type FarqUser = {
  id: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
}

export type FarqSession = {
  accessToken: string
  refreshToken: string
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
  /**
   * The signed-in account changed (including to nobody). Emitted BEFORE the
   * causing event so per-user working state is dropped before anything renders
   * the new identity. This is what stops one account's كراسة from staying on
   * screen after another signs in.
   */
  | 'IDENTITY_CHANGED'

export type SessionListener = (event: SessionEvent, session: FarqSession | null) => void

/** What a refresh attempted on behalf of a 401'd request actually did. */
export type RefreshOutcome =
  | { status: 'no-session' }
  /** A live access token to retry with. */
  | { status: 'refreshed'; accessToken: string }
  /** The server refused the refresh token. The session is over. */
  | { status: 'rejected' }
  /** Network / 5xx / rate limit. Session kept, retried on a timer. */
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

/** Just enough of `Storage` to persist one session; injectable for tests. */
export type SessionStorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function memoryStorage(): SessionStorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

/** Real `localStorage` when the browser allows it; memory otherwise. */
function defaultStorage(): SessionStorageLike {
  try {
    if (typeof localStorage === 'undefined') return memoryStorage()
    // Private mode can expose the object and throw on write.
    const probe = '__farq_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return memoryStorage()
  }
}

type ApiSessionPayload = {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  expires_in?: number
  user?: {
    id?: string
    email?: string | null
    email_verified?: boolean
    display_name?: string | null
  }
}

function toSession(payload: ApiSessionPayload, nowMs: number): FarqSession | null {
  const accessToken = String(payload?.access_token || '')
  const refreshToken = String(payload?.refresh_token || '')
  const id = String(payload?.user?.id || '')
  if (!accessToken || !refreshToken || !id) return null
  const expiresAt =
    typeof payload.expires_at === 'number'
      ? payload.expires_at
      : Math.floor(nowMs / 1000) + (payload.expires_in ?? 3600)
  return {
    accessToken,
    refreshToken,
    expiresAt,
    user: {
      id,
      email: payload.user?.email ?? null,
      emailVerified: payload.user?.email_verified === true,
      displayName: payload.user?.display_name ?? null,
    },
  }
}

export type FarqSessionOptions = {
  storage?: SessionStorageLike
  fetchImpl?: typeof fetch
  now?: () => number
  /** Off in tests: a timer would keep the process alive. */
  autoRefresh?: boolean
}

export function createFarqSession(options: FarqSessionOptions = {}) {
  const storage = options.storage ?? defaultStorage()
  const now = options.now ?? (() => Date.now())
  const autoRefresh = options.autoRefresh ?? true
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args))

  const listeners = new Set<SessionListener>()
  let session: FarqSession | null = readStored()
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<{ session: FarqSession | null; outcome: RefreshOutcome }> | null = null
  let failures = 0
  /** Last identity announced, so an identity change is reported exactly once. */
  let lastUserId: string | null = session?.user.id ?? null

  function readStored(): FarqSession | null {
    try {
      const raw = storage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as FarqSession
      if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.user?.id) return null
      return parsed
    } catch {
      // Cleared site data, private mode, or a shape from an older version.
      return null
    }
  }

  function writeStored(value: FarqSession | null) {
    try {
      if (value) storage.setItem(STORAGE_KEY, JSON.stringify(value))
      else storage.removeItem(STORAGE_KEY)
    } catch {
      // Storage unavailable: the session still works for this page's life.
    }
  }

  function emit(event: SessionEvent, value: FarqSession | null) {
    for (const listener of listeners) {
      try {
        listener(event, value)
      } catch {
        // One bad subscriber must not stop the others.
      }
    }
  }

  function setSession(value: FarqSession | null, event: SessionEvent) {
    const previousUserId = lastUserId
    session = value
    lastUserId = value?.user.id ?? null
    // Any deliberate session change is a clean slate; the backoff exists only
    // to space out retries of a refresh that keeps failing.
    failures = 0
    writeStored(value)
    scheduleRefresh()
    if (previousUserId !== lastUserId) emit('IDENTITY_CHANGED', value)
    emit(event, value)
  }

  function scheduleRefresh() {
    if (timer) clearTimeout(timer)
    timer = null
    if (!autoRefresh || !session) return
    const untilRefresh = session.expiresAt * 1000 - now() - REFRESH_MARGIN_MS
    // After a failure the session is usually already expired, so `untilRefresh`
    // is negative and an unfloored schedule fires on the next tick — forever.
    const floor =
      failures > 0 ? Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS) : 0
    // setTimeout clamps above ~24.8 days; cap so a long-lived tab re-arms.
    const delay = Math.min(Math.max(untilRefresh, floor), 12 * 60 * 60 * 1000)
    timer = setTimeout(() => void runRefresh(), delay)
    // Never hold the process open in Node (tests) or block a tab from closing.
    ;(timer as { unref?: () => void })?.unref?.()
  }

  /**
   * Adopt a session another tab has already rotated into storage.
   *
   * `inFlight` collapses concurrent refreshes inside ONE tab. It cannot see the
   * tab next door, which shares this storage and the same single-use refresh
   * token. Whichever tab refreshes second would present a token the server has
   * already redeemed, and the server reads that as reuse and revokes the whole
   * family — signing the user out everywhere. Re-reading storage first means
   * the second tab presents the successor rather than the corpse.
   */
  function adoptStored() {
    if (!session) return
    const stored = readStored()
    if (!stored || stored.user.id !== session.user.id) return
    if (stored.refreshToken === session.refreshToken) return
    // Only ever move forward: a stale write must not undo our own rotation.
    if (stored.expiresAt < session.expiresAt) return
    setSession(stored, 'REFRESHED')
  }

  async function post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; data: T | null; message: string }> {
    try {
      const response = await fetchImpl(`${apiBase()}/api/auth${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => null)) as
        | { data?: T; errors?: Array<{ message?: string; code?: string }>; message?: string }
        | null
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          data: null,
          message:
            payload?.errors?.[0]?.message || payload?.message || `HTTP ${response.status}`,
        }
      }
      return {
        ok: true,
        status: response.status,
        data: (payload?.data ?? payload) as T,
        message: '',
      }
    } catch {
      // Transport failure is a different thing from a wrong password and must
      // read that way to the user.
      return { ok: false, status: 0, data: null, message: 'تعذّر الوصول إلى خدمة الحسابات.' }
    }
  }

  /** The one place a refresh token is ever spent. Everything else joins it. */
  function runRefresh(): Promise<{ session: FarqSession | null; outcome: RefreshOutcome }> {
    if (inFlight) return inFlight
    adoptStored()
    const startToken = session?.refreshToken
    if (!startToken) {
      return Promise.resolve({ session: null, outcome: { status: 'no-session' } as const })
    }
    /*
     * Tabs share one single-use refresh token and schedule their renewal for the
     * same moment. Re-reading storage is not enough when two tabs read it in the
     * same instant: both spend the token, the server sees reuse and revokes the
     * whole family, and every tab signs out. A browser-wide lock makes the tabs
     * take turns; inside it, a tab first adopts what the previous one stored.
     */
    const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
      const locks = typeof navigator !== 'undefined' ? (navigator as unknown as { locks?: { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> } }).locks : undefined
      return locks?.request ? (locks.request('farq_construction_session_refresh', fn) as Promise<T>) : fn()
    }
    const flight = withLock(async () => {
      adoptStored()
      const refreshToken = session?.refreshToken
      if (!refreshToken) return { session: null, outcome: { status: 'no-session' } as const }
      // Another tab renewed while this one waited for the lock: use its session.
      if (refreshToken !== startToken && session && session.expiresAt * 1000 - now() > REFRESH_MARGIN_MS) {
        return { session, outcome: { status: 'refreshed', accessToken: session.accessToken } as const }
      }
      const result = await post<ApiSessionPayload>('/refresh', { refresh_token: refreshToken })
      if (!result.ok || !result.data) {
        // Only a refused token ends the session: expired, already redeemed, or
        // a family revoked by reuse detection. That 401 is real — unless another
        // tab stored a newer session in the meantime.
        if (result.status === 401) {
          adoptStored()
          if (session && session.refreshToken !== refreshToken && session.expiresAt * 1000 > now()) {
            return { session, outcome: { status: 'refreshed', accessToken: session.accessToken } as const }
          }
          failures = 0
          setSession(null, 'SIGNED_OUT')
          return { session: null, outcome: { status: 'rejected' } as const }
        }
        failures += 1
        scheduleRefresh()
        return { session: null, outcome: { status: 'unreachable' } as const }
      }
      const next = toSession(result.data, now())
      if (!next) {
        failures += 1
        scheduleRefresh()
        return { session: null, outcome: { status: 'unreachable' } as const }
      }
      setSession(next, 'REFRESHED')
      return {
        session: next,
        outcome: { status: 'refreshed', accessToken: next.accessToken } as const,
      }
    })
    inFlight = flight
    void flight
      .catch(() => null)
      .finally(() => {
        if (inFlight === flight) inFlight = null
      })
    return flight
  }

  scheduleRefresh()

  return {
    /** The access token to put on the next request, or null when signed out. */
    getAccessToken(): string | null {
      return session?.accessToken ?? null
    },

    getUser(): FarqUser | null {
      return session?.user ?? null
    },

    isAuthenticated(): boolean {
      return session !== null
    },

    /** Exchange email + password for this account's own session. */
    async signIn(email: string, password: string): Promise<FarqSession> {
      const result = await post<ApiSessionPayload>('/login', { email, password })
      if (!result.ok || !result.data) {
        // 503 means the deployment has no signing secret configured, which is
        // an operator problem, not a wrong password. Say so differently.
        const code =
          result.status === 503
            ? 'LOCAL_AUTH_NOT_CONFIGURED'
            : result.status === 429
              ? 'ACCOUNT_LOCKED'
              : 'INVALID_CREDENTIALS'
        throw new FarqAuthError(result.message, result.status, code)
      }
      const next = toSession(result.data, now())
      if (!next) throw new FarqAuthError('ردّ غير مفهوم من خدمة الحسابات.', 502, 'BAD_SESSION')
      setSession(next, 'SIGNED_IN')
      return next
    },

    /** Create an account (an invited colleague with no account yet) and sign in. */
    async signUp(email: string, password: string): Promise<FarqSession> {
      const result = await post<ApiSessionPayload>('/signup', { email, password })
      if (!result.ok || !result.data) {
        throw new FarqAuthError(
          result.status === 409 ? 'هذا البريد لديه حساب بالفعل.' : result.message || 'تعذّر إنشاء الحساب.',
          result.status,
          result.status === 409 ? 'EMAIL_UNAVAILABLE' : 'SIGNUP_FAILED',
        )
      }
      const next = toSession(result.data, now())
      if (!next) throw new FarqAuthError('ردّ غير مفهوم من خدمة الحسابات.', 502, 'BAD_SESSION')
      setSession(next, 'SIGNED_IN')
      return next
    },

    /** Take a session the API issued elsewhere (an invitation's password claim). */
    adoptSession(payload: unknown): boolean {
      const next = payload ? toSession(payload as ApiSessionPayload, now()) : null
      if (!next) return false
      setSession(next, 'SIGNED_IN')
      return true
    },

    /**
     * Replace this account's password. The current one is required. The server
     * ends every other session and returns a fresh one for this device, which
     * is kept as a refresh so the buyer's working state stays where it is.
     */
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      const token = session?.accessToken
      if (!token) throw new FarqAuthError('سجّل الدخول أولًا.', 401, 'AUTH_REQUIRED')
      let response: Response
      try {
        response = await fetchImpl(`${apiBase()}/api/auth/password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        })
      } catch {
        throw new FarqAuthError('تعذّر الوصول إلى خدمة الحسابات.', 0, 'NETWORK')
      }
      const payload = (await response.json().catch(() => null)) as
        | { data?: ApiSessionPayload; errors?: Array<{ code?: string }> }
        | null
      if (!response.ok) {
        const code = payload?.errors?.[0]?.code || 'PASSWORD_CHANGE_FAILED'
        const message =
          code === 'CURRENT_PASSWORD_INCORRECT'
            ? 'كلمة المرور الحالية غير صحيحة.'
            : code === 'PASSWORD_TOO_SHORT'
              ? 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.'
              : code === 'ACCOUNT_LOCKED'
                ? 'محاولات خاطئة كثيرة. حاول بعد قليل.'
                : 'تعذّر تغيير كلمة المرور.'
        throw new FarqAuthError(message, response.status, code)
      }
      const next = payload?.data ? toSession(payload.data, now()) : null
      if (next) setSession(next, 'REFRESHED')
    },

    /**
     * End this session. Local state is cleared first: a user who taps sign out
     * is signed out even if the request fails. The server revoke is best effort.
     */
    async signOut(): Promise<void> {
      const refreshToken = session?.refreshToken
      setSession(null, 'SIGNED_OUT')
      if (refreshToken) await post('/logout', { refresh_token: refreshToken })
    },

    /** Sign out of every device for this account. */
    async signOutEverywhere(): Promise<void> {
      const token = session?.accessToken
      if (token) {
        try {
          await fetchImpl(`${apiBase()}/api/auth/logout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ scope: 'global' }),
          })
        } catch {
          // Best effort, same as signOut.
        }
      }
      setSession(null, 'SIGNED_OUT')
    },

    /**
     * Refresh on behalf of a request that just saw 401.
     *
     * `staleAccessToken` is the token that request rode in on. When the session
     * already holds a different one — another 401 in the same burst refreshed
     * it, or another tab did — the caller just needs the current token, and
     * spending the single-use refresh token again would be the storm.
     */
    async refreshForRequest(staleAccessToken: string | null): Promise<RefreshOutcome> {
      adoptStored()
      if (!session) return { status: 'no-session' }
      if (staleAccessToken && session.accessToken !== staleAccessToken) {
        return { status: 'refreshed', accessToken: session.accessToken }
      }
      const { outcome } = await runRefresh()
      return outcome
    },

    /** Re-read the account from the server (display name, verification). */
    async loadUser(): Promise<FarqUser | null> {
      if (!session) return null
      const token = session.accessToken
      try {
        const response = await fetchImpl(`${apiBase()}/api/auth/me`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        })
        if (response.status === 401) {
          const outcome = await this.refreshForRequest(token)
          if (outcome.status !== 'refreshed') return session?.user ?? null
          return this.loadUser()
        }
        const payload = (await response.json().catch(() => null)) as
          | { data?: { user?: ApiSessionPayload['user'] } }
          | null
        const user = payload?.data?.user
        if (!user?.id || !session) return session?.user ?? null
        setSession(
          {
            ...session,
            user: {
              id: String(user.id),
              email: user.email ?? null,
              emailVerified: user.email_verified === true,
              displayName: user.display_name ?? null,
            },
          },
          'USER_UPDATED',
        )
        return session?.user ?? null
      } catch {
        return session?.user ?? null
      }
    },

    subscribe(listener: SessionListener): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    /** Test seam: drop the timer so a suite can exit. */
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
      listeners.clear()
    },
  }
}

export type FarqSessionClient = ReturnType<typeof createFarqSession>

/** The instance the app runs on. */
export const farqSession: FarqSessionClient = createFarqSession()
