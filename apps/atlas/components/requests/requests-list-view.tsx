'use client'

import { ChevronLeft, MapPinned, Search } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cityById } from '@/lib/mock-data'
import { STATUS_LABEL, formatDate } from '@/lib/format'
import { normalizeArabic } from '@/lib/search'
import { useAppStore } from '@/lib/store'
import type { RequestStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { StatusBadge, TypeLabel } from './request-badges'

const TABS: RequestStatus[] = ['draft', 'needs_decision', 'ready_manual', 'awaiting', 'completed']

export function RequestsListView() {
  const { requests, inbox } = useAppStore()
  const [tab, setTab] = useState<RequestStatus>('needs_decision')
  const [q, setQ] = useState('')

  const nq = normalizeArabic(q)
  const visible = requests
    .filter((r) => r.status === tab && (!nq || normalizeArabic(r.title).includes(nq)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 pb-24 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-balance">الطلبات</h1>
          <p className="text-sm text-muted-foreground">القوائم وطلبات التسعير ومسودات الحملات في مكان واحد.</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/opportunity-map" />}>
          <MapPinned data-icon="inline-start" />
          طلب جديد من الخريطة
        </Button>
      </header>

      <div role="tablist" aria-label="حالة الطلب" className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1">
        {TABS.map((s) => {
          const count = requests.filter((r) => r.status === s).length
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={tab === s}
              onClick={() => setTab(s)}
              className={cn(
                'inline-flex flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap',
                tab === s ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {STATUS_LABEL[s]}
              <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', tab === s ? 'bg-background/20' : 'bg-muted')}>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="relative">
        <label htmlFor="req-search" className="sr-only">
          ابحث في الطلبات
        </label>
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id="req-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث بعنوان الطلب"
          className="h-10 w-full rounded-lg border bg-card pr-9 pl-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25"
        />
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">لا توجد طلبات في «{STATUS_LABEL[tab]}».</p>
          <Button size="sm" nativeButton={false} render={<Link href="/opportunity-map" />}>
            ابدأ من خريطة الفرص
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => {
            const replies = inbox.filter((m) => m.requestId === r.id)
            const unread = replies.filter((m) => m.unread).length
            return (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className="group flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <TypeLabel type={r.type} />
                      <StatusBadge status={r.status} />
                    </div>
                    <h2 className="truncate font-semibold">{r.title}</h2>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{cityById.get(r.cityId)?.name}</span>
                      <span>{r.businessIds.length} منشأة</span>
                      {replies.length ? (
                        <span className={cn(unread && 'font-semibold text-primary')}>
                          {replies.length} رد{unread ? ` (${unread} جديد)` : ''}
                        </span>
                      ) : null}
                      <span>آخر تحديث {formatDate(r.updatedAt)}</span>
                    </p>
                  </div>
                  <ChevronLeft className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
