'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, Inbox, LogIn, MapPinned, TrendingUp, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'

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
        <img src="/brand/farq-b2b.svg" alt="" className="h-6 w-auto" />
        <span className="text-[15px] font-bold text-foreground">أطلس</span>
      </span>
      <span className="hidden flex-col leading-tight sm:flex">
        <span className="sr-only">فرق أطلس</span>
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground">منصة الفرص التجارية</span>
      </span>
    </Link>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { requests, inbox } = useAppStore()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/session/me', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: { user?: SessionUser } } | null
        if (active && response.ok && payload?.data?.user) setUser(payload.data.user)
      })
      .catch(() => undefined)
      .finally(() => { if (active) setSessionChecked(true) })
    return () => { active = false }
  }, [])

  const needsDecision = requests.filter((r) => r.status === 'needs_decision').length
  const unread = inbox.filter((m) => m.unread).length
  const items: NavItem[] = [
    { href: '/opportunity-map', label: 'السوق', icon: MapPinned },
    { href: '/insights', label: 'الرؤى', icon: TrendingUp },
    { href: '/requests', label: 'الطلبات', icon: ClipboardList, count: needsDecision },
    { href: '/inbox', label: 'الوارد', icon: Inbox, count: unread },
  ]
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === '/insights' && pathname === '/market-gaps')
  const marketBadge = <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">السوق الحي</span>
  const workspaceBadge = <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">مساحة العمل</span>
  const shellBadge = pathname.startsWith('/opportunity-map') ? marketBadge : workspaceBadge

  // The opportunity map owns its full-screen workspace, including navigation.
  // Keep it unwrapped so the Bolt-designed map can use the full Atlas viewport.
  if (pathname === '/opportunity-map') return <>{children}</>

  // The landing page owns its own header and calls to action.
  if (pathname === '/' || pathname === '/login') return <>{children}</>

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b bg-card/95 px-4 backdrop-blur-xl sm:px-6 print:hidden">
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
                {item.count ? <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[10px] font-bold leading-5 text-primary-foreground">{item.count}</span> : null}
              </Link>
            )
          })}
        </nav>

        <div className="mr-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline-flex">{shellBadge}</span>
          {user ? (
            <div className="flex items-center gap-2.5" aria-label="الحساب المسجل">
              <span className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground" aria-hidden>{userInitial(user)}</span>
              <span className="hidden max-w-44 truncate text-xs font-medium text-muted-foreground xl:inline">{user.displayName || user.email || 'الحساب المسجل'}</span>
            </div>
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

      <nav aria-label="التنقل الرئيسي" className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden print:hidden">
        {items.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn('relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-primary' : 'text-muted-foreground')}
            >
              <span className="relative">
                <item.icon className="size-5" aria-hidden />
                {item.count ? <span className="absolute -top-1.5 -left-2.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">{item.count}</span> : null}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
