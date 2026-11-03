'use client'

import { useEffect, useState } from 'react'

/**
 * Whether this visitor has an Atlas session: null while the server is asked, then true or false. A failed request
 * (offline, the service down) reads as signed in, so a person who is signed in is never told to sign in again.
 */
export function useSignedIn() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    fetch('/api/session/me', { cache: 'no-store' })
      .then((response) => { if (active) setSignedIn(response.status !== 401) })
      .catch(() => { if (active) setSignedIn(true) })
    return () => { active = false }
  }, [])
  return signedIn
}

/** The sign-in link that brings the person back to this page afterwards. */
export function signInHref(path: string) {
  return `/login?next=${encodeURIComponent(path)}`
}
