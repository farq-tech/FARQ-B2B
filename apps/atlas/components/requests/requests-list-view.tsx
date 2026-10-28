'use client'

import { ChevronLeft, ClipboardList, MapPinned } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { ChipRow, PillField, SearchPill, pillControl } from '@/components/shared/search-pill'
import { Chip, ChipCount } from '@/components/ui/chip'
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
  const [tab, setTab] = useState<RequestStatus>('draft')
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
        <Button variant="outline" nativeButton={false} render={<Link href="/map" />}>
          <MapPinned data-icon="inline-start" />
          طلب جديد من الخريطة
        </Button>
      </header>

      <SearchPill label="ابحث في الطلبات">
        <PillField label="ابحث في الطلبات">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بعنوان الطلب" className={pillControl} />
        </PillField>
      </SearchPill>

      <ChipRow label="حالة الطلب" className="max-w-none">
        {TABS.map((s) => (
          <Chip key={s} active={tab === s} onClick={() => setTab(s)}>
            {STATUS_LABEL[s]}
            <ChipCount value={requests.filter((r) => r.status === s).length} active={tab === s} />
          </Chip>
        ))}
      </ChipRow>

      {visible.length === 0 ? (
        <EmptyState icon={ClipboardList} title={`لا شيء في «${STATUS_LABEL[tab]}»`}
          body={q ? 'لا طلب بهذا العنوان هنا. جرّب حالة أخرى أو كلمة أقصر.' : 'اختر منشآت من الخريطة ثم «جهّز قائمة» أو «طلب تسعير»، فتظهر طلباتك هنا للمراجعة قبل أي إرسال.'}
          action={<Button size="sm" nativeButton={false} render={<Link href="/map" />}><MapPinned data-icon="inline-start" />ابدأ من الخريطة</Button>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => {
            const replies = inbox.filter((m) => m.requestId === r.id)
            const unread = replies.filter((m) => m.unread).length
            return (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className="group flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-all outline-none hover:border-foreground/20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/60"
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
