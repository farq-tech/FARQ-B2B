// Copied from فرق بناء (farqconstraction/src/api/useFarqSession.ts, ios-app@5147808); adds `checking` for the server-held session.
/**
 * React binding for the one `farqSession` instance.
 *
 * A hook rather than context because the session is a module singleton that
 * outlives any provider: a 401 handler deep inside the API client must be able
 * to end the session, and every screen must see that without a provider having
 * to be in the tree above it.
 */

import { useEffect, useState } from 'react'
import { currentAuthMode, type AuthMode } from './constructionAuth'
import { farqSession, type FarqUser } from './farqSession'

export type SessionView = {
  user: FarqUser | null
  isAuthenticated: boolean
  /** `demo` means no real session — the app is running on the demo actor. */
  mode: AuthMode
  /** The proxy has not answered /_session/me yet: show a loading state, not the sign-in form. */
  checking: boolean
}

function snapshot(): SessionView {
  return {
    user: farqSession.getUser(),
    isAuthenticated: farqSession.isAuthenticated(),
    mode: currentAuthMode(),
    checking: farqSession.isChecking(),
  }
}

export function useFarqSession(): SessionView {
  const [view, setView] = useState<SessionView>(snapshot)

  useEffect(() => {
    // Re-read on mount: the session may have been refreshed or ended between
    // the initial render and the subscription being attached.
    setView(snapshot())
    return farqSession.subscribe(() => setView(snapshot()))
  }, [])

  return view
}
