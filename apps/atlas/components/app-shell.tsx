'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, Inbox, LogIn, MapPinned, type LucideIcon } from 'lucide-react'
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
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground" aria-hidden>
        أ
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[15px] font-bold">فرق أطلس</span>
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
          منصة الفرص التجارية
        </span>
      </span>
    </div>
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
    { href: '/opportunity-map', label: 'خريطة الفرص', icon: MapPinned },
    { href: '/requests', label: 'الطلبات', icon: ClipboardList, count: needsDecision },
    { href: '/inbox', label: 'الوارد', icon: Inbox, count: unread },
  ]
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const marketBadge = <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">السوق الحي</span>
  const workspaceBadge = <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">محفوظة على هذا الجهاز</span>
  const shellBadge = pathname === '/' ? null : pathname.startsWith('/opportunity-map') ? marketBadge : workspaceBadge

  // The landing page owns its own header and calls to action. Rendering the
  // workspace shell here duplicates the brand on small screens and adds an
  // unrelated bottom navigation before the visitor starts a workspace.
  if (pathname === '/') return <>{children}</>

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-l bg-sidebar lg:flex">
        <div className="px-5 pt-5 pb-6">
          <BrandMark />
        </div>
        <nav aria-label="التنقل الرئيسي" className="flex flex-col gap-1 px-3">
          {items.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <item.icon className="size-[18px]" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {item.count ? (
                  <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-5 text-primary-foreground">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-3 border-t p-4">
          {shellBadge}
          {user ? (
            <div className="flex items-center gap-3" aria-label="الحساب المسجل">
              <span className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-semibold" aria-hidden>{userInitial(user)}</span>
              <div className="flex min-w-0 flex-col text-sm leading-tight">
                <span className="truncate font-medium">{user.displayName || user.email || 'الحساب المسجل'}</span>
                {user.displayName && user.email ? <span className="truncate text-xs text-muted-foreground">{user.email}</span> : null}
              </div>
            </div>
          ) : sessionChecked ? (
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
              <LogIn className="size-4" aria-hidden />
              سجّل الدخول
            </Link>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-16 has-[[data-viewport-workspace]]:h-dvh lg:pb-0 lg:has-[[data-viewport-workspace]]:h-auto">
        <header className="flex items-center justify-between border-b bg-card px-4 py-3 lg:hidden">
          <BrandMark />
          {shellBadge}
        </header>
        {children}
      </div>

      <nav
        aria-label="التنقل الرئيسي"
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-3 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {items.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="relative">
                <item.icon className="size-5" aria-hidden />
                {item.count ? (
                  <span className="absolute -top-1.5 -left-2.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                    {item.count}
                  </span>
                ) : null}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
