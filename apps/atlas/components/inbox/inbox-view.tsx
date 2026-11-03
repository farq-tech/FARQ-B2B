'use client'

import { ArrowRight, CheckCheck, ClipboardList, FileText, Inbox as InboxIcon, MailOpen, Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { numberFormat } from '@/lib/insights-api'
import { EmptyState } from '@/components/shared/empty-state'
import { ChipRow } from '@/components/shared/search-pill'
import { Chip, ChipCount } from '@/components/ui/chip'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, type KeyboardEvent } from 'react'
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
  // short enough that the four sit on one row in the list column; each row's own label still says what it is
  { id: 'rfq', label: 'التسعير' },
  { id: 'campaign', label: 'الحملات' },
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
  const unreadVisible = visible.filter((m) => m.unread)

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

  // On a phone the list and the message take turns on screen, so the button that was tapped disappears: focus
  // moves to the message on open and back to its row on «كل الرسائل», instead of falling to the page.
  const detail = useRef<HTMLElement>(null)
  const pendingFocus = useRef<'detail' | string | null>(null)
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (window.matchMedia('(min-width: 1024px)').matches) return   // side by side: the row is still there
    if (target === 'detail') detail.current?.focus({ preventScroll: false })
    else document.getElementById(`inbox-row-${target}`)?.focus()
  }, [selectedId])
  const open = (id: string) => { pendingFocus.current = 'detail'; setParams({ m: id }) }
  const back = () => { pendingFocus.current = selectedId; setParams({ m: null }) }

  // keyboard: ↑/↓ move between messages, Home/End jump to the first and last, Enter opens (the row is a button)
  const moveFocus = (event: KeyboardEvent<HTMLUListElement>) => {
    const rows = visible.map((m) => document.getElementById(`inbox-row-${m.id}`)).filter((row): row is HTMLElement => Boolean(row))
    const at = rows.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null
    if (next == null) return
    event.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus()
  }

  // Mark read only when a message is first opened, so a manual "mark unread" isn't immediately undone.
  const lastOpened = useRef<string | null>(null)
  // keyed by the message's id and read flag, not the message object (a new object on every store change)
  const selectedUnread = selected?.unread ?? false
  useEffect(() => {
    if (!selectedId || !selected || lastOpened.current === selectedId) return
    lastOpened.current = selectedId
    if (selectedUnread) markRead(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `selected` is read for presence only; its id is the key
  }, [selectedId, Boolean(selected), selectedUnread, markRead])

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 pb-24 lg:py-8 lg:pb-8">
      {/* with a message open on a phone the header is hidden from sight but not from screen readers: the page keeps its h1 */}
      <header className={cn('flex flex-wrap items-end justify-between gap-3', selected && 'max-lg:sr-only')}>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-balance">الوارد</h1>
          <p className="text-sm text-muted-foreground">
            ردود طلبات التسعير وتفاعلات الحملات التسويقية في مكان واحد.
            {unreadVisible.length > 0 && <span className="font-semibold text-foreground"> {numberFormat.format(unreadVisible.length)} غير مقروءة.</span>}
          </p>
        </div>
        {/* clearing a backlog took one open per message; this marks what the current filter shows, nothing hidden */}
        {unreadVisible.length > 1 && (
          <Button variant="outline" size="sm" onClick={() => unreadVisible.forEach((m) => markRead(m.id))}>
            <CheckCheck data-icon="inline-start" />علّم المعروض كمقروء
          </Button>
        )}
      </header>

      {/* a first visit has no message to filter or open: one welcome that says what arrives here and where it comes
          from, instead of four «0» filters beside «لا رسائل هنا» and an «اختر رسالة» that has nothing to choose */}
      {inbox.length === 0 ? (
        <EmptyState heading="h2" icon={InboxIcon} title="لا رسائل بعد"
          body="ردود الموردين على طلبات التسعير وتفاعلات حملاتك تصل هنا، بعد أن ترسل الطلب أو الحملة بنفسك من صفحته."
          action={<Button nativeButton={false} render={<Link href="/requests" />}><ClipboardList data-icon="inline-start" />افتح الطلبات</Button>} />
      ) : (
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(20rem,24rem)_1fr]">
        <section aria-label="قائمة الرسائل" className={cn('flex min-w-0 flex-col gap-3', selected && 'hidden lg:flex')}>
          <p id="inbox-keys" className="sr-only">تنقّل بين الرسائل بالسهمين لأعلى ولأسفل، واضغط Enter لفتح الرسالة.</p>
          {/* one row that scrolls if it must, never a second row that pushes the list down; padding keeps focus rings whole */}
          {/* the filters stay under the app bar while a long list scrolls */}
          <div className="sticky top-16 z-20 -mx-4 bg-background/90 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-background/75 lg:mx-0 lg:px-0">
          <ChipRow label="تصفية الوارد" className="max-w-none gap-1.5 px-0.5 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => (
              <Chip key={f.id} active={filter === f.id} onClick={() => setParams({ f: f.id })} className="px-2.5">
                {f.label}
                <ChipCount value={inbox.filter((m) => matches(m, f.id)).length} active={filter === f.id} />
              </Chip>
            ))}
          </ChipRow>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={InboxIcon} title="لا رسائل في هذا التصنيف" body="اختر «الكل» لترى كل الوارد."
              action={<Button size="sm" variant="outline" onClick={() => setParams({ f: 'all' })}>اعرض الكل</Button>} />
          ) : (
            <ul onKeyDown={moveFocus} aria-describedby="inbox-keys" className="flex flex-col overflow-hidden rounded-2xl border bg-card">
              {visible.map((m) => {
                const b = businessById.get(m.businessId)
                const active = m.id === selected?.id
                const Icon = m.source === 'rfq' ? FileText : Megaphone
                return (
                  <li key={m.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      id={`inbox-row-${m.id}`}
                      onClick={() => open(m.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-start transition-colors outline-none focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
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
                          <span className={cn('min-w-0 flex-1 truncate text-sm', m.unread ? 'font-bold' : 'font-medium')}>{b?.name ?? 'غير متاح'}</span>
                          <time className="shrink-0 text-xs text-muted-foreground" dateTime={m.receivedAt}>
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

        <section ref={detail} tabIndex={-1} aria-label="تفاصيل الرسالة"
          // on a phone, Escape leaves the message for the list, like «كل الرسائل»; a field keeps its own Escape
          onKeyDown={(event) => { if (event.key === 'Escape' && selected && !(event.target instanceof HTMLTextAreaElement) && !window.matchMedia('(min-width: 1024px)').matches) back() }} className={cn('min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring', !selected && 'hidden lg:block')}>
          {selected ? (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={back}
                className="inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              >
                <ArrowRight className="size-4" aria-hidden />
                كل الرسائل
              </button>
              <MessageDetail key={selected.id} message={selected} />
            </div>
          ) : (
            <EmptyState icon={MailOpen} title="اختر رسالة" body="تظهر الرسالة هنا كاملة مع الطلب الذي تخصه، وتكتب ردك وتراجعه قبل أن ترسله."
              className="h-full min-h-80 justify-center" />
          )}
        </section>
      </div>
      )}
    </main>
  )
}
