'use client'

import type { ReactNode } from 'react'

/** The sign-in page, told to come back to the page as it is now (its whole address: the map's city, group, step,
 * districts and activity live there), not to a bare page that starts the journey over. */
export function signInHref(): string {
  if (typeof window === 'undefined') return '/login'
  return `/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`
}

/**
 * A link to sign in that returns to exactly where the customer was. The address is read when the link is about to be
 * followed (pointer, touch or keyboard focus), so a view changed after the link was drawn is the one returned to.
 */
export function SignInLink({ className, children }: { className?: string; children: ReactNode }) {
  const fresh = (event: { currentTarget: HTMLAnchorElement }) => { event.currentTarget.href = signInHref() }
  return (
    <a href="/login" onMouseDown={fresh} onTouchStart={fresh} onFocus={fresh} onClick={fresh} className={className}>{children}</a>
  )
}
