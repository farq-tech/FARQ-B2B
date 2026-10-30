'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, House, Inbox, LogIn, LogOut, Map as MapIcon, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { WhatsNew } from '@/components/shared/whats-new'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  count?: number
}

type SessionUser = { email: string | null; displayName: string | null }

function userInitial(user: SessionUser) {
  return (user.displayName || user.email || 'ح').trim().charAt(0).toUpperCase()
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn('flex shrink-0 items-center gap-2.5', className)} aria-label="فرق أطلس، الرئيسية">
      <span className="flex items-center gap-1.5" aria-hidden>
        <img src="/brand/farq-b2b-light.svg" alt="" className="h-6 w-auto" />
        <span className="text-[15px] font-bold text-foreground">أطلس</span>
      </span>
      <span className="hidden flex-col leading-tight sm:flex">
        <span className="sr-only">فرق أطلس</span>
        <span className="text-xs font-medium tracking-wide text-muted-foreground">منصة الفرص التجارية</span>
      </span>
    </Link>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { requests, inbox } = useAppStore()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)

  // The shell stays mounted across client navigation, so the session is read again on the way out of
  // the landing and login pages: signing in there and landing on /map shows the account straight away.
  const ownHeader = pathname === '/' || pathname === '/login'
  useEffect(() => {
    if (ownHeader) return
    let active = true
    fetch('/api/session/me', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: { user?: SessionUser } } | null
        if (active) setUser(response.ok && payload?.data?.user ? payload.data.user : null)
      })
      .catch(() => undefined)
      .finally(() => { if (active) setSessionChecked(true) })
    return () => { active = false }
  }, [ownHeader])

  // the header says «signed out» only once the server has cleared the session; a failed request leaves it as it was
  const signOut = async () => {
    const response = await fetch('/api/session/logout', { method: 'POST' }).catch(() => null)
    if (response?.ok) setUser(null)
  }

  const needsDecision = requests.filter((r) => r.status === 'needs_decision').length
  const unread = inbox.filter((m) => m.unread).length
  const items: NavItem[] = [
    { href: '/map', label: 'الخريطة', icon: MapIcon },
    { href: '/homes', label: 'العقار', icon: House },
    { href: '/requests', label: 'الطلبات', icon: ClipboardList, count: needsDecision },
    { href: '/inbox', label: 'الوارد', icon: Inbox, count: unread },
  ]
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || false

  // The landing page owns its own header and calls to action.
  if (ownHeader) return <>{children}</>

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b bg-card/95 px-4 backdrop-blur-xl sm:px-6">
        <BrandMark />

        <nav aria-label="التنقل الرئيسي" className="hidden h-full flex-1 items-center justify-center gap-1 lg:flex">
          {items.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors',
                  active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <item.icon className={cn('size-[17px]', active && 'text-primary')} aria-hidden />
                {item.label}
                {item.count ? <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-bold leading-5 text-primary-foreground">{item.count}</span> : null}
              </Link>
            )
          })}
        </nav>

        <div className="mr-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {user ? (
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-full [&::-webkit-details-marker]:hidden" aria-label="الحساب المسجل">
                <span className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground" aria-hidden>{userInitial(user)}</span>
                <span className="hidden max-w-44 truncate text-xs font-medium text-muted-foreground xl:inline">{user.displayName || user.email || 'الحساب المسجل'}</span>
              </summary>
              <div className="absolute left-0 top-11 z-50 w-56 rounded-xl border bg-card p-2 shadow-lg">
                <p className="truncate px-2 py-1.5 text-xs text-muted-foreground">{user.email || user.displayName || 'الحساب المسجل'}</p>
                <button type="button" onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium hover:bg-muted">
                  <LogOut className="size-4" aria-hidden />
                  خروج
                </button>
              </div>
            </details>
          ) : sessionChecked ? (
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted">
              <LogIn className="size-3.5" aria-hidden />
              دخول
            </Link>
          ) : null}
        </div>
      </header>

      <div className="flex min-w-0 flex-col pb-16 lg:pb-0 lg:has-[[data-viewport-workspace]]:h-[calc(100dvh-4rem)] lg:has-[[data-viewport-workspace]]:min-h-0">
        {children}
      </div>

      <WhatsNew onMap={pathname === '/map'} />

      <nav aria-label="التنقل الرئيسي" className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {items.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn('relative flex flex-col items-center justify-center gap-1 text-xs font-medium', active ? 'text-primary' : 'text-muted-foreground')}
            >
              <span className="relative">
                <item.icon className="size-5" aria-hidden />
                {item.count ? <span className="absolute -top-1.5 -left-2.5 min-w-4 rounded-full bg-primary px-1 text-center text-xs leading-4 text-primary-foreground">{item.count}</span> : null}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
