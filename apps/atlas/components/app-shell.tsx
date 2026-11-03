'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ClipboardList, House, Inbox, LogIn, LogOut, Map as MapIcon, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { numberFormat } from '@/lib/insights-api'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { REMEMBERED, lastView, loginHref } from '@/lib/handoff'
import { SignInLink } from '@/components/shared/sign-in-link'
import { announceSessionChange } from '@/lib/use-signed-in'
import { WhatsNew } from '@/components/shared/whats-new'
import { buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  count?: number
}

type SessionUser = { email: string | null; displayName: string | null }

/** A nav badge: the count in English digits, «99+» past 99 so it never outgrows its dot. */
const badge = (count: number) => (count > 99 ? '99+' : numberFormat.format(count))

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
  const router = useRouter()
  const { requests, inbox } = useAppStore()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)

  // The shell stays mounted across client navigation, so the session is read again on the way out of
  // the landing and login pages: signing in there and landing on /map shows the account straight away.
  const ownHeader = pathname === '/' || pathname === '/login' || pathname === '/request-access'
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

  // the main navigation goes back to each surface's last view in this tab (the map's city, step and districts, the
  // listings' filters, the price's answers), read again whenever the page changes; a first visit opens the default
  const [views, setViews] = useState<Record<string, string>>({})
  useEffect(() => { setViews(Object.fromEntries(REMEMBERED.map((path) => [path, lastView(path)]))) }, [pathname])

  // the header says «signed out» only once the server has cleared the session; a failed request leaves it as it was
  const signOut = async () => {
    const response = await fetch('/api/session/logout', { method: 'POST' }).catch(() => null)
    if (response?.ok) { setUser(null); announceSessionChange() }
  }

  const needsDecision = requests.filter((r) => r.status === 'needs_decision').length
  const unread = inbox.filter((m) => m.unread).length
  const items: NavItem[] = [
    { href: views['/map'] ?? '/map', label: 'الخريطة', icon: MapIcon },
    { href: views['/homes'] ?? '/homes', label: 'العقار', icon: House },
    { href: '/requests', label: 'الطلبات', icon: ClipboardList, count: needsDecision },
    { href: '/inbox', label: 'الوارد', icon: Inbox, count: unread },
  ]
  const isActive = (href: string) => { const path = href.split('?')[0]; return pathname === path || pathname.startsWith(`${path}/`) }

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
                key={item.label}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <item.icon className={cn('size-[17px]', active && 'text-primary')} aria-hidden />
                {item.label}
                {item.count ? <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-bold leading-5 text-primary-foreground">{badge(item.count)}</span> : null}
              </Link>
            )
          })}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {user ? (
            // a real menu, not <details>: Escape and a tap outside close it, arrow keys move inside it, focus returns
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={`الحساب: ${user.displayName || user.email || 'الحساب المسجل'}`}
                className="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                <span className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground" aria-hidden>{userInitial(user)}</span>
                <span className="hidden max-w-44 truncate text-xs font-medium text-muted-foreground xl:inline" aria-hidden>{user.displayName || user.email || 'الحساب المسجل'}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <p className="truncate px-2 py-1.5 text-xs text-muted-foreground">{user.email || user.displayName || 'الحساب المسجل'}</p>
                <DropdownMenuItem onClick={signOut} className="px-2 py-2 font-medium">
                  <LogOut aria-hidden />
                  خروج
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : sessionChecked ? (
            // back to the page as it is, with its whole address (the map's journey lives there), after signing in
            <SignInLink requestAccess={false} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'font-semibold' })}>
              <LogIn aria-hidden />
              دخول
            </SignInLink>
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
              key={item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn('relative flex flex-col items-center justify-center gap-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', active ? 'font-bold text-foreground' : 'font-medium text-muted-foreground')}
            >
              {/* the open page is marked by shape as well as colour: a filled pill behind its icon, its label bold */}
              <span className={cn('relative grid h-7 w-14 place-items-center rounded-full transition-colors', active ? 'bg-secondary text-primary' : 'text-current')}>
                <item.icon className="size-5" strokeWidth={active ? 2.4 : 2} aria-hidden />
                {item.count ? <span className="absolute -top-1.5 end-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-xs leading-4 text-primary-foreground">{badge(item.count)}</span> : null}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
