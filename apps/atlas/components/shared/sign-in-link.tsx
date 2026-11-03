'use client'

import type { ReactNode } from 'react'
import { REQUEST_ACCESS_PATH, requestAccessHref } from '@/lib/access-request'

const here = () => (typeof window === 'undefined' ? null : `${window.location.pathname}${window.location.search}`)

/** The sign-in page, told to come back to the page as it is now (its whole address: the map's city, group, step,
 * districts and activity live there), not to a bare page that starts the journey over. */
export function signInHref(): string {
  const path = here()
  return path == null ? '/login' : `/login?next=${encodeURIComponent(path)}`
}

/**
 * A link to sign in that returns to exactly where the customer was. The address is read when the link is about to be
 * followed (pointer, touch or keyboard focus), so a view changed after the link was drawn is the one returned to.
 *
 * Someone without an account is offered «اطلب حساباً» right after it, with the same return address, unless
 * `requestAccess` is false (the app bar's own «دخول» button, where the login page offers it instead).
 */
export function SignInLink({ className, children, requestAccess = true }: { className?: string; children: ReactNode; requestAccess?: boolean }) {
  const fresh = (event: { currentTarget: HTMLAnchorElement }) => { event.currentTarget.href = signInHref() }
  const link = <a href="/login" onMouseDown={fresh} onTouchStart={fresh} onFocus={fresh} onClick={fresh} className={className}>{children}</a>
  if (!requestAccess) return link
  return <>{link}<RequestAccessLink className={className} prefix /></>
}

/** «اطلب حساباً», back to where the person was once the request is sent. `prefix` writes « أو » before it. */
export function RequestAccessLink({ className, prefix = false }: { className?: string; prefix?: boolean }) {
  const fresh = (event: { currentTarget: HTMLAnchorElement }) => { event.currentTarget.href = requestAccessHref(here()) }
  return (
    <>{prefix && <span> أو </span>}<a href={REQUEST_ACCESS_PATH} onMouseDown={fresh} onTouchStart={fresh} onFocus={fresh} onClick={fresh} className={className}>اطلب حساباً</a></>
  )
}
