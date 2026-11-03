'use client'

import { Activity, ArrowRight, Inbox as InboxIcon, Link2, LogIn, ShieldAlert, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { Modal } from '@/components/shared/modal'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'
import { healthState, kindNote, previewText, type SourceHealth } from '@/lib/inbox-feed'
import { numberFormat } from '@/lib/insights-api'
import { signInHref } from '@/lib/use-signed-in'

type Candidate = { outboundId: string; account: string | null; requestId: string | null; requestTitle: string | null; name: string | null; sentAt: string }
type Unlinked = { id: string; from: string | null; kind: string; body: string; receivedAt: string; candidates: Candidate[] }
type Pending = { message: Unlinked; candidate: Candidate | null }

const shortId = (id: string | null) => (id ? `…${id.slice(-6)}` : 'غير متاح')
const kindOf = (kind: string) => (kind === 'text' || kind === 'button' || kind === 'interactive' ? undefined : kind)

/**
 * Farq owner review of WhatsApp replies no campaign could be matched to. Each one can be placed on a campaign message
 * Farq sent to the same number (the only choices offered), after a confirmation, or set aside. Placing a reply puts it
 * in that account's inbox; setting it aside keeps it out of every inbox.
 */
export function UnlinkedReview() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'forbidden' | 'error'>('loading')
  const [messages, setMessages] = useState<Unlinked[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState<SourceHealth | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const response = await fetch('/api/inbox/unlinked', { cache: 'no-store' })
      if (response.status === 401) return setState('signed-out')
      if (response.status === 403) return setState('forbidden')
      const body = await response.json().catch(() => null) as { ok?: boolean; messages?: Unlinked[]; health?: SourceHealth } | null
      if (!response.ok || !body?.ok) return setState('error')
      setMessages(Array.isArray(body.messages) ? body.messages : [])
      setHealth(body.health ?? null)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const decide = async () => {
    if (!pending || busy) return
    setBusy(true)
    const { message, candidate } = pending
    try {
      const response = await fetch('/api/inbox/unlinked', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(candidate ? { action: 'attach', messageId: message.id, outboundId: candidate.outboundId } : { action: 'dismiss', messageId: message.id }),
      })
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (response.ok && body?.ok) {
        setMessages((list) => list.filter((item) => item.id !== message.id))
        toast.success(candidate ? 'رُبط الرد بالحملة' : 'استُبعد الرد', { description: candidate ? 'يظهر الآن في وارد الحساب المرسِل.' : 'لا يظهر في أي وارد.' })
        setPending(null)
      } else {
        toast.error(body?.error ?? 'تعذر حفظ المراجعة.')
        if (response.status === 409) { setPending(null); void load() }
      }
    } catch {
      toast.error('تعذر حفظ المراجعة.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 pb-24 lg:py-8 lg:pb-8">
      <header className="flex flex-col gap-1">
        <Link href="/inbox" className="inline-flex min-h-11 w-fit items-center gap-1 rounded-lg text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowRight className="size-4" aria-hidden />الوارد
        </Link>
        <h1 className="text-2xl font-bold text-balance">ردود غير مرتبطة</h1>
        <p className="text-sm text-muted-foreground">
          ردود واتساب لم تُطابق أي حملة تلقائياً. اربط كل رد بحملة أُرسلت إلى الرقم نفسه، أو استبعده.
          {state === 'ready' && messages.length ? <span className="font-semibold text-foreground"> {numberFormat.format(messages.length)} بانتظار المراجعة.</span> : null}
        </p>
      </header>

      {state === 'ready' ? <SourceHealthNote health={health} /> : null}

      {state === 'loading' ? <p className="text-sm text-muted-foreground" aria-live="polite">جارٍ التحميل...</p>
        : state === 'signed-out' ? (
          <EmptyState heading="h2" icon={LogIn} title="سجّل الدخول أولاً" body="هذه المراجعة لمالك فرق."
            action={<Button nativeButton={false} render={<Link href={signInHref('/inbox/unlinked')} />}><LogIn data-icon="inline-start" />سجّل الدخول</Button>} />
        ) : state === 'forbidden' ? (
          <EmptyState heading="h2" icon={ShieldAlert} title="هذه الصفحة لمالك فرق فقط" body="ردود حملاتك تصل إلى الوارد مباشرة."
            action={<Button variant="outline" nativeButton={false} render={<Link href="/inbox" />}>افتح الوارد</Button>} />
        ) : state === 'error' ? (
          <LoadError what="الردود غير المرتبطة" onRetry={() => void load()} compact={false} />
        ) : messages.length === 0 ? (
          <EmptyState heading="h2" icon={InboxIcon} title="لا ردود بانتظار المراجعة" body="كل رد وصل رُبط بحملته أو استُبعد." />
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((message) => {
              const note = kindNote(kindOf(message.kind))
              return (
                <li key={message.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                    {/* masked: enough to tell two senders apart, never the number itself */}
                    <span dir="ltr" className="font-semibold text-foreground tabular-nums">{message.from ?? 'غير متاح'}</span>
                    <time dateTime={message.receivedAt}>{formatDateTime(message.receivedAt)}</time>
                  </p>
                  {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
                  <blockquote className="whitespace-pre-line rounded-2xl rounded-ss-sm bg-muted px-4 py-3 text-base leading-7">{previewText({ body: message.body, kind: kindOf(message.kind) })}</blockquote>
                  <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold">{message.candidates.length ? 'حملات أُرسلت إلى الرقم نفسه' : 'لم تُرسل أي حملة إلى هذا الرقم'}</h2>
                    {message.candidates.length ? (
                      <ul className="flex flex-col divide-y rounded-xl border">
                        {message.candidates.map((candidate) => (
                          <li key={candidate.outboundId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm font-medium">{candidate.name ?? 'غير متاح'}</span>
                              {/* the campaign by the title its sender gave it; the id only when it was sent before titles were kept */}
                              <span className="truncate text-xs text-foreground">{candidate.requestTitle ? `«${candidate.requestTitle}»` : <>الطلب <span dir="ltr">{shortId(candidate.requestId)}</span></>}</span>
                              <span className="text-xs text-muted-foreground">
                                أُرسلت {formatDateTime(candidate.sentAt)} · الحساب <span dir="ltr">{shortId(candidate.account)}</span>
                              </span>
                            </span>
                            <Button size="sm" variant="outline" onClick={() => setPending({ message, candidate })}>
                              <Link2 data-icon="inline-start" />اربطه بها
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <Button size="sm" variant="ghost" className="self-start" onClick={() => setPending({ message, candidate: null })}>
                      <X data-icon="inline-start" />استبعد الرد
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

      <Modal
        open={Boolean(pending)}
        onClose={() => { if (!busy) setPending(null) }}
        title={pending?.candidate ? 'ربط الرد بالحملة' : 'استبعاد الرد'}
        description={pending?.candidate
          ? `يظهر الرد في وارد الحساب الذي أرسل ${pending.candidate.requestTitle ? `«${pending.candidate.requestTitle}»` : 'الحملة'} إلى «${pending.candidate.name ?? 'غير متاح'}». لا يُرسل أي شيء.`
          : 'يبقى الرد محفوظاً ولا يظهر في أي وارد. لا يُرسل أي شيء.'}
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>إلغاء</Button>
            <Button onClick={() => void decide()} disabled={busy}>{pending?.candidate ? 'اربط الرد' : 'استبعد الرد'}</Button>
          </>
        }
      >
        {pending ? <p className="line-clamp-3 text-sm text-muted-foreground">{previewText({ body: pending.message.body, kind: kindOf(pending.message.kind) })}</p> : null}
      </Modal>
    </main>
  )
}

/**
 * Whether replies are reaching Atlas at all: when the source last read successfully and, if its last poll failed, the
 * kind of error (InsufficientPrivilege: the database role cannot read the inbox tables). An empty list below means
 * nothing to review only when this says the source is reading.
 */
function SourceHealthNote({ health }: { health: SourceHealth | null }) {
  const state = healthState(health, Date.now())
  if (state === 'unknown') return null
  const failing = state === 'failing' || state === 'off'
  const Icon = failing ? TriangleAlert : Activity
  const title = state === 'off' ? 'قراءة الردود متوقفة على الخادم'
    : state === 'failing' ? 'آخر محاولة لقراءة الردود فشلت'
      : state === 'never' ? 'لم تكتمل أول قراءة للردود بعد'
        : state === 'stale' ? 'لم تُقرأ الردود منذ مدة'
          : 'الردود تُقرأ بانتظام'
  const parts = [
    health?.lastOkAt ? `آخر قراءة ناجحة ${formatDateTime(health.lastOkAt)}` : 'لا قراءة ناجحة بعد',
    state === 'failing' && health?.lastErrorKind ? `نوع الخطأ: ${health.lastErrorKind}` : null,
    state === 'failing' && health?.failures ? `${numberFormat.format(health.failures)} محاولة فاشلة متتالية` : null,
  ].filter(Boolean)
  return (
    <p role={failing ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${failing ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'text-muted-foreground'}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span><span className="font-semibold">{title}.</span> {parts.join(' · ')}</span>
    </p>
  )
}
