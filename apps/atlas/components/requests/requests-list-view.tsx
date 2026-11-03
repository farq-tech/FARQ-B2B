'use client'

import { ChevronLeft, ClipboardList, LogIn, MapPinned } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { ChipRow, PillField, SearchPill, pillControl } from '@/components/shared/search-pill'
import { Chip, ChipCount } from '@/components/ui/chip'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { STATUS_LABEL, formatDate, nextStep, requestCity, statusLabel } from '@/lib/format'
import { counted, numberFormat, useCities } from '@/lib/insights-api'
import { normalizeArabic } from '@/lib/search'
import { useAppStore } from '@/lib/store'
import { signInHref, useSignedIn } from '@/lib/use-signed-in'
import { requestAccessHref } from '@/lib/access-request'
import type { RequestStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { STATUS_ICON, StatusBadge, TypeLabel } from './request-badges'
import { SavedList } from '@/components/lens/saved-comparisons'
import { lastView } from '@/lib/handoff'

const TABS: RequestStatus[] = ['draft', 'needs_decision', 'ready_manual', 'awaiting', 'completed']
// where a person's next step is: a decision first, then what is ready to send, then drafts to finish
const ATTENTION: RequestStatus[] = ['needs_decision', 'ready_manual', 'draft', 'awaiting', 'completed']

export function RequestsListView() {
  const { requests, inbox, views } = useAppStore()
  // the map as the person left it (its city, step and districts), where a new request starts
  const [mapView, setMapView] = useState('/map')
  useEffect(() => { setMapView(lastView('/map')) }, [])
  const cities = useCities()
  // until the person picks a tab, the page opens on the first one that holds something to act on (the store loads
  // from this device after the first paint, so this is derived, not set once)
  const [chosen, setTab] = useState<RequestStatus | null>(null)
  const tab = chosen ?? ATTENTION.find((s) => requests.some((r) => r.status === s)) ?? 'draft'
  const [q, setQ] = useState('')
  // a signed-out visitor is told to sign in, not «لا طلبات بعد» as if their account were empty
  const signedIn = useSignedIn()

  const none = requests.length === 0
  const nq = normalizeArabic(q)
  // a search counts across every status: the tabs then show where the matches are, so a draft searched for from
  // «تحتاج قرارك» is one tap away instead of «لا طلب بهذا العنوان»
  const matches = nq ? requests.filter((r) => normalizeArabic(r.title).includes(nq)) : requests
  const visible = matches
    .filter((r) => r.status === tab)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const elsewhere = nq && !visible.length ? TABS.find((s) => matches.some((r) => r.status === s)) : undefined

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 pb-24 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-balance">الطلبات</h1>
          <p className="text-sm text-muted-foreground">القوائم وطلبات التسعير ومسودات الحملات في مكان واحد.</p>
        </div>
        {!none && (
          <Button variant="outline" nativeButton={false} render={<Link href={mapView} />}>
            <MapPinned data-icon="inline-start" />
            طلب جديد من الخريطة
          </Button>
        )}
      </header>

      {/* a first visit has nothing to search or sort: one welcome that says what a request is and where it starts,
          instead of an empty search box, five «0» tabs and «لا شيء في مسودات» */}
      {none && signedIn === null ? null : none && !signedIn ? (
        <EmptyState heading="h2" icon={LogIn} title="سجّل الدخول لترى طلباتك"
          body="هنا قوائم المنشآت التي حفظتها وطلبات التسعير ومسودات الحملات، تراجعها قبل أي إرسال."
          action={<div className="flex flex-wrap items-center justify-center gap-2">
            <Button nativeButton={false} render={<Link href={signInHref('/requests')} />}><LogIn data-icon="inline-start" />سجّل الدخول</Button>
            <Button variant="outline" nativeButton={false} render={<Link href={requestAccessHref('/requests')} />}>اطلب حساباً</Button>
          </div>} />
      ) : none ? (
        <EmptyState heading="h2" icon={ClipboardList} title="لا طلبات بعد"
          body="الطلب قائمة منشآت تحفظها، أو طلب تسعير لموردين، أو مسودة حملة. يبدأ كل طلب من الخريطة، ويبقى هنا للمراجعة قبل أي إرسال."
          action={<Button nativeButton={false} render={<Link href={mapView} />}><MapPinned data-icon="inline-start" />ابدأ من الخريطة</Button>} />
      ) : (<>

      {/* the search and the status chips stay under the app bar while a long list scrolls, so changing status or
          search never means scrolling back up */}
      <div className="sticky top-16 z-20 -mx-4 flex flex-col gap-3 bg-background/90 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-background/75">
      <SearchPill label="ابحث في الطلبات">
        <PillField label="ابحث في الطلبات">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بعنوان الطلب" className={pillControl} />
        </PillField>
      </SearchPill>

      <ChipRow label="حالة الطلب" className="max-w-none">
        {TABS.map((s) => {
          const Icon = STATUS_ICON[s]
          return (
          <Chip key={s} active={tab === s} onClick={() => setTab(s)}>
            <Icon className="size-4" aria-hidden />
            {STATUS_LABEL[s]}
            <ChipCount value={matches.filter((r) => r.status === s).length} active={tab === s} />
          </Chip>
          )
        })}
      </ChipRow>
      </div>

      {visible.length === 0 && elsewhere ? (
        <EmptyState heading="h2" icon={ClipboardList} title={`لا نتيجة في «${STATUS_LABEL[tab]}»`}
          body={`بهذا العنوان في حالات أخرى: ${counted(matches.length, 'request')}.`}
          action={<Chip onClick={() => setTab(elsewhere)}>اعرض «{STATUS_LABEL[elsewhere]}» ({numberFormat.format(matches.filter((r) => r.status === elsewhere).length)})</Chip>} />
      ) : visible.length === 0 ? (
        <EmptyState heading="h2" icon={ClipboardList} title={`لا شيء في «${STATUS_LABEL[tab]}»`}
          body={q ? 'لا طلب بهذا العنوان هنا. جرّب حالة أخرى أو كلمة أقصر.' : 'اختر منشآت من الخريطة ثم «جهّز قائمة» أو «طلب تسعير»، فتظهر طلباتك هنا للمراجعة قبل أي إرسال.'}
          action={<Button size="sm" nativeButton={false} render={<Link href={mapView} />}><MapPinned data-icon="inline-start" />ابدأ من الخريطة</Button>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => {
            const replies = inbox.filter((m) => m.requestId === r.id)
            const unread = replies.filter((m) => m.unread).length
            const next = nextStep(r.status, r.type)
            return (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className="group flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-all outline-none hover:border-foreground/20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <TypeLabel type={r.type} />
                      <StatusBadge status={r.status} label={statusLabel(r.status, r.type)} />
                    </div>
                    <h2 className="truncate font-semibold">{r.title}</h2>
                    {next && <p className="text-sm font-medium text-primary">الخطوة التالية: {next}</p>}
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {/* a request saved from a city no longer listed still says where it was, never an empty gap */}
                      <span>{requestCity(r, cities) ?? 'المدينة غير متاحة'}</span>
                      <span>{counted(r.businessIds.length, 'business')}</span>
                      {replies.length ? (
                        <span className={cn(unread && 'font-semibold text-primary')}>
                          {counted(replies.length, 'reply')}{unread ? ` (${numberFormat.format(unread)} ${unread === 1 ? 'جديد' : 'جديدة'})` : ''}
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
      </>)}
      {/* the comparisons saved on the map, beside the requests: kept by name inside Atlas, each one reopens on the map */}
      {views.length > 0 && (
        <section aria-label="المقارنات المحفوظة" className="rounded-2xl border bg-card p-4">
          <SavedList heading="h2" />
        </section>
      )}
    </main>
  )
}
