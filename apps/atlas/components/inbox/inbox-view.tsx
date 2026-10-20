'use client'

import { ArrowRight, FileText, Inbox as InboxIcon, Megaphone } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { businessById } from '@/lib/mock-data'
import { formatDateTime } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { InboxMessage } from '@/lib/types'
import { cn } from '@/lib/utils'
import { MessageDetail } from './message-detail'
import { SourceLabel } from './source-label'

export type InboxFilter = 'all' | 'unread' | 'rfq' | 'campaign'

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'unread', label: 'غير مقروء' },
  { id: 'rfq', label: 'ردود التسعير' },
  { id: 'campaign', label: 'تفاعلات تسويقية' },
]

const matches = (m: InboxMessage, f: InboxFilter) =>
  f === 'all' ? true : f === 'unread' ? m.unread : m.source === f

export function InboxView() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { inbox, markRead } = useAppStore()

  const filterParam = params.get('f')
  const filter: InboxFilter = FILTERS.some((f) => f.id === filterParam) ? (filterParam as InboxFilter) : 'all'
  const selectedId = params.get('m')
  const selected = inbox.find((m) => m.id === selectedId) ?? null

  const sorted = [...inbox].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  const visible = sorted.filter((m) => matches(m, filter))

  const setParams = (next: { m?: string | null; f?: InboxFilter }) => {
    const sp = new URLSearchParams(params.toString())
    if (next.m !== undefined) {
      if (next.m) sp.set('m', next.m)
      else sp.delete('m')
    }
    if (next.f !== undefined) {
      if (next.f === 'all') sp.delete('f')
      else sp.set('f', next.f)
    }
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // Mark read only when a message is first opened, so a manual "mark unread" isn't immediately undone.
  const lastOpened = useRef<string | null>(null)
  useEffect(() => {
    if (!selected || lastOpened.current === selected.id) return
    lastOpened.current = selected.id
    if (selected.unread) markRead(selected.id)
  }, [selected, markRead])

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 pb-24 lg:py-8 lg:pb-8">
      <header className={cn('flex flex-col gap-1', selected && 'hidden lg:flex')}>
        <h1 className="text-2xl font-bold text-balance">الوارد</h1>
        <p className="text-sm text-muted-foreground">ردود طلبات التسعير وتفاعلات الحملات التسويقية في مكان واحد.</p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(20rem,24rem)_1fr]">
        <section aria-label="قائمة الرسائل" className={cn('flex min-w-0 flex-col gap-3', selected && 'hidden lg:flex')}>
          <div role="tablist" aria-label="تصفية الوارد" className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1">
            {FILTERS.map((f) => {
              const count = inbox.filter((m) => matches(m, f.id)).length
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParams({ f: f.id })}
                  className={cn(
                    'inline-flex flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium whitespace-nowrap',
                    active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {f.label}
                  <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', active ? 'bg-background/20' : 'bg-muted')}>{count}</span>
                </button>
              )
            })}
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card p-10 text-center">
              <InboxIcon className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">لا توجد رسائل في هذا التصنيف.</p>
            </div>
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-2xl border bg-card">
              {visible.map((m) => {
                const b = businessById.get(m.businessId)
                const active = m.id === selected?.id
                const Icon = m.source === 'rfq' ? FileText : Megaphone
                return (
                  <li key={m.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setParams({ m: m.id })}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-right transition-colors',
                        active ? 'bg-accent/50' : 'hover:bg-muted/50',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                          m.source === 'rfq' ? 'bg-secondary text-secondary-foreground' : 'bg-accent text-accent-foreground',
                        )}
                        aria-hidden
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <span className={cn('min-w-0 flex-1 truncate text-sm', m.unread ? 'font-bold' : 'font-medium')}>{b?.name}</span>
                          <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={m.receivedAt}>
                            {formatDateTime(m.receivedAt)}
                          </time>
                        </span>
                        <SourceLabel message={m} compact />
                        <span className={cn('line-clamp-1 text-xs', m.unread ? 'text-foreground' : 'text-muted-foreground')}>{m.body}</span>
                      </span>
                      {m.unread ? (
                        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
                          <span className="sr-only">غير مقروء</span>
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-label="تفاصيل الرسالة" className={cn('min-w-0', !selected && 'hidden lg:block')}>
          {selected ? (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setParams({ m: null })}
                className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground lg:hidden"
              >
                <ArrowRight className="size-4" aria-hidden />
                كل الرسائل
              </button>
              <MessageDetail key={selected.id} message={selected} />
            </div>
          ) : (
            <div className="flex h-full min-h-80 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-card p-10 text-center">
              <InboxIcon className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">اختر رسالة لعرض تفاصيلها.</p>
              <Link href="/requests" className="text-sm font-medium text-primary hover:underline">
                أو انتقل إلى الطلبات
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
