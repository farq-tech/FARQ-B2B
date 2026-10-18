import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  getConstructionInboxStatus,
  getConstructionInboxThread,
  inboxThreadSupplierLabel,
  isOutboundInviteSnapshot,
  listConstructionInboxThreads,
  type ConstructionInboxStatus,
  type ConstructionInboxThread,
  type ConstructionInboxThreadDetail,
  type ConstructionInboxThreadMessage,
  type ConstructionReplyKind,
} from '../../api/constructionClient'
import { Badge, Bubble as MessageBubble, BubbleContent, Button, ChannelBadge, Chip, Icon, MobileAppBar, channelFromApi, useIsMobile, type BadgeTone } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'

/*
 * «06 · صندوق الوارد» — Figma 50:988 (desktop) / M06 58:431 (phone), on the inbox
 * endpoints that already exist in src/api (no new endpoint, no payload change):
 *   GET /api/construction/inbox/status
 *   GET /api/construction/inbox/threads?filter=all|needs_reply
 *   GET /api/construction/inbox/threads/:inviteId
 *
 * READ-ONLY on purpose. This screen sends nothing: no reply, no broadcast, no
 * read/unread write (the read-state endpoints are POSTs and are not called).
 * The composer of the Figma frame is shown disabled with the reason.
 *
 * Not in the API (see docs/qa/open-issues.md): the extracted offer with per-line
 * prices and confidence (Figma «عرض مستخرج»), evidence per supplier, and the
 * channel of a thread row. The panel shows the server's own reply classification
 * (reply_kind / reply_summary_ar) when present, and says the rest is missing.
 */

const POLL_MS = 15_000

type Filter = 'all' | 'needs_reply' | 'quoted'

export type InboxPageProps = {
  /** Opens the request file (screen 03) for a thread's request. */
  onOpenRequest?: (rfqId: string) => void
  /** Thread to open first (e.g. /inbox?thread=<inviteId>). */
  initialInviteId?: string | null
  /** Called when the user opens a thread, so the shell can mirror it in the URL. */
  onSelectThread?: (inviteId: string | null) => void
}

const REPLY_KIND: Record<ConstructionReplyKind, { tone: BadgeTone; label: string }> = {
  QUOTE_FILE: { tone: 'Success', label: 'أرفق عرض سعر' },
  PRICE_IN_TEXT: { tone: 'Success', label: 'ذكر السعر في الرسالة' },
  QUESTION: { tone: 'Warning', label: 'يسأل' },
  DECLINED: { tone: 'Danger', label: 'اعتذر' },
  INTERESTED: { tone: 'Info', label: 'مهتم' },
  ALT_CONTACT: { tone: 'Info', label: 'أعطى رقمًا آخر' },
  AUTO_REPLY: { tone: 'Neutral', label: 'رد آلي' },
  OTHER: { tone: 'Neutral', label: 'رد' },
}

function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff) || diff < 0) return ''
  const m = Math.round(diff / 60000)
  if (m < 2) return 'الحين'
  if (m < 60) return `${m} د`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} س`
  return `${Math.round(h / 24)} ي`
}

function clock(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })
}

function threadStatus(t: ConstructionInboxThread): { tone: BadgeTone; label: string } | null {
  if (t.response_status === 'QUOTED') return { tone: 'Success', label: 'أرسل سعر' }
  if (t.response_status === 'DECLINED') return { tone: 'Danger', label: 'اعتذر' }
  if (t.needs_reply) return { tone: 'Warning', label: 'يحتاج رد' }
  return null
}

const surface = 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)]'

function StateBox({ tone = 'neutral', title, body, action }: { tone?: 'neutral' | 'danger'; title: string; body?: string; action?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className="flex flex-col items-start gap-2 p-6 text-start">
      <p className={`text-[16px] leading-[26px] font-medium ${tone === 'danger' ? 'text-[var(--color-text-danger)]' : 'text-[var(--color-text-primary)]'}`}>{title}</p>
      {body ? <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{body}</p> : null}
      {action}
    </div>
  )
}

/** Figma M06a `18425:2713`: Row (Entity Badge) — initial, supplier, «request · "preview" · time», status. */
function ThreadRow({ t, selected, onOpen }: { t: ConstructionInboxThread; selected: boolean; onOpen: () => void }) {
  const st = threadStatus(t)
  const unread = Number(t.unread_count || 0)
  const name = inboxThreadSupplierLabel(t)
  const preview = t.preview || t.subject || ''
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined}
        className={`flex min-h-16 w-full items-center gap-3 border-b px-5 py-3 text-start ${selected ? 'border-[var(--color-border-default)] bg-[var(--color-bg-primary-subtle)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-primary-subtle)]'} ${FOCUS_RING} focus-visible:-outline-offset-2`}>
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-primary-subtle)] text-[16px] font-medium">{name.trim().charAt(0)}</span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className={`max-w-full truncate text-[16px] leading-[26px] ${unread ? 'font-semibold' : 'font-medium'}`}>{name}</span>
          <span className="line-clamp-2 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
            {[t.request_context?.reference || null, preview ? `«${preview}»` : 'بدون نص', timeAgo(t.last_received_at) || null].filter(Boolean).join(' · ')}
          </span>
        </span>
        {unread ? <span className="shrink-0 rounded-full bg-[var(--color-bg-primary)] px-2 text-[12px] leading-[18px] font-medium text-[var(--color-text-on-primary)]"><span className="sr-only">غير مقروءة: </span>{unread}</span> : null}
        {st ? <Badge tone={st.tone} label={st.label} showDot={false} className="shrink-0" /> : null}
      </button>
    </li>
  )
}

function Bubble({ m }: { m: ConstructionInboxThreadMessage }) {
  const inbound = m.direction === 'INBOUND'
  const kind = inbound && m.reply_kind ? REPLY_KIND[m.reply_kind] : null
  const ch = channelFromApi(m.channel)
  const files = m.files || []
  return (
    <li className={`flex w-full flex-col gap-1.5 ${inbound ? 'items-start' : 'items-end'}`}>
      <MessageBubble align={inbound ? 'start' : 'end'} variant={inbound ? 'secondary' : 'default'}>
        <BubbleContent>
        {m.subject && !m.body_text ? <p className="text-[14px] leading-[22px] font-medium">{m.subject}</p> : null}
        <p className="text-[16px] leading-[26px] break-words whitespace-pre-wrap">{m.body_text || (files.length ? '' : '—')}</p>
        {files.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {files.map((f) => <li key={f.id} className="flex items-center gap-1.5 text-[14px] leading-[22px]"><Icon name="paperclip" size={14} />{f.filename || 'مرفق'}{f.state && f.state !== 'STORED' ? ' (غير متاح للتنزيل)' : ''}</li>)}
          </ul>
        ) : null}
        <p className={`mt-1 text-[12px] leading-[18px] ${inbound ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-on-inverse-secondary)]'}`}>
          {[!inbound && m.employee_name ? m.employee_name : null, clock(m.created_at), !inbound && m.state && m.state !== 'SENT' ? (m.state === 'FAILED' ? 'تعذر الإرسال' : 'قيد الإرسال') : null].filter(Boolean).join(' · ')}
        </p>
        </BubbleContent>
      </MessageBubble>
      {kind || ch ? (
        <div className={`flex flex-wrap items-center gap-2 ${inbound ? 'self-start' : 'self-end'}`}>
          {ch ? <ChannelBadge channel={ch} /> : null}
          {kind ? <Badge tone={kind.tone} label={kind.label} className="text-[12px] leading-[18px]" /> : null}
          {m.reply_summary_ar ? <span className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{m.reply_summary_ar}</span> : null}
        </div>
      ) : null}
    </li>
  )
}

/** Figma «عرض مستخرج». Only what the server classified; the price extraction is not in the API. */
function ExtractPanel({ detail, onOpenRequest, compact }: { detail: ConstructionInboxThreadDetail; onOpenRequest?: (rfqId: string) => void; compact?: boolean }) {
  const latest = [...(detail.messages || [])].reverse().find((m) => m.direction === 'INBOUND')
  const kind = latest?.reply_kind ? REPLY_KIND[latest.reply_kind] : null
  const contacts = latest?.reply_contacts || []
  const rfqId = detail.rfq_id || detail.request_context?.rfq_id
  return (
    <section aria-labelledby="extract-h" className={`flex flex-col items-start gap-3 text-start ${compact ? `rounded-[var(--radius-xl)] border p-4 ${surface}` : 'p-6'}`}>
      <h2 id="extract-h" className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">قراءة آخر رد</h2>
      {kind ? <Badge tone={kind.tone} label={kind.label} /> : <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">ما وصل تصنيف لآخر رد من المورد.</p>}
      {latest?.reply_summary_ar ? <p className="text-[14px] leading-[22px]">{latest.reply_summary_ar}</p> : null}
      {contacts.length ? (
        <ul className="flex flex-col gap-1 text-[14px] leading-[22px]">
          {contacts.map((c) => <li key={`${c.type}-${c.value}`} className="flex items-center gap-1.5"><Icon name={c.type === 'phone' ? 'phone' : 'mail'} size={16} /><span dir="ltr">{c.value}</span></li>)}
        </ul>
      ) : null}
      <p className="flex w-full items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] p-3 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
        <Icon name="info" size={16} className="mt-0.5 shrink-0" />
        استخراج الأسعار من المحادثة (البنود والمبالغ ودرجة الثقة) غير متاح من الـAPI حاليًا، فما نعرض أرقامًا هنا. الأسعار المعتمدة في ملف الطلب.
      </p>
      {rfqId && onOpenRequest ? <Button variant="Secondary" size="M" icon="file" onClick={() => onOpenRequest(rfqId)}>افتح ملف الطلب{detail.request_context?.reference ? ` ${detail.request_context.reference}` : ''}</Button> : null}
    </section>
  )
}

function Composer() {
  return (
    <div className={`border-t p-4 ${surface}`}>
      <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-4 py-3">
        <label htmlFor="inbox-reply" className="sr-only">الرد على المورد</label>
        <input id="inbox-reply" disabled aria-describedby="inbox-reply-note" placeholder="الرد من هنا غير مفعّل" className="min-w-0 flex-1 bg-transparent text-[14px] leading-[22px] placeholder:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed" />
        <Button variant="Primary" size="M" icon="send" disabled>أرسل</Button>
      </div>
      <p id="inbox-reply-note" className="mt-2 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">هذه الشاشة للقراءة فقط: <bdi dir="ltr">Farq B2B</bdi> ما يرسل ردودًا للموردين حاليًا. الرد من فرق بناء.</p>
    </div>
  )
}

export default function InboxPage({ onOpenRequest, initialInviteId = null, onSelectThread }: InboxPageProps) {
  const mobile = useIsMobile()
  const [status, setStatus] = useState<ConstructionInboxStatus | null>(null)
  const [threads, setThreads] = useState<ConstructionInboxThread[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(initialInviteId)
  const [detail, setDetail] = useState<ConstructionInboxThreadDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const [showSent, setShowSent] = useState(false)
  const listHeading = useRef<HTMLHeadingElement>(null)
  const convHeading = useRef<HTMLHeadingElement>(null)

  const loadList = useCallback(async () => {
    try {
      const r = await listConstructionInboxThreads({ filter: filter === 'needs_reply' ? 'needs_reply' : 'all' })
      setThreads(r.threads || [])
      setListError(null)
      setRefreshedAt(Date.now())
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'تعذر تحميل المحادثات')
    }
  }, [filter])

  useEffect(() => {
    getConstructionInboxStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    void loadList()
    const t = window.setInterval(() => void loadList(), POLL_MS)
    return () => window.clearInterval(t)
  }, [loadList])

  const loadDetail = useCallback(async (inviteId: string) => {
    setDetailLoading(true)
    try {
      const d = await getConstructionInboxThread(inviteId)
      setDetail(d)
      setDetailError(null)
    } catch (e) {
      setDetail(null)
      setDetailError(e instanceof Error ? e.message : 'تعذر تحميل المحادثة')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selected) { setDetail(null); return }
    void loadDetail(selected)
  }, [selected, loadDetail])

  // The open conversation follows the list: a newer inbound message re-reads it (GET only).
  const selectedRow = useMemo(() => (threads || []).find((t) => t.invite_id === selected) || null, [threads, selected])
  const lastSeen = useRef<string | null>(null)
  useEffect(() => {
    const stamp = selectedRow?.last_received_at || null
    if (selected && stamp && lastSeen.current && stamp !== lastSeen.current) void loadDetail(selected)
    lastSeen.current = stamp
  }, [selectedRow, selected, loadDetail])

  const open = (id: string | null) => {
    setSelected(id)
    onSelectThread?.(id)
    if (mobile) window.setTimeout(() => (id ? convHeading.current : listHeading.current)?.focus(), 0)
  }

  const { visible, hiddenSent } = useMemo(() => {
    const q = query.trim()
    let rows = threads || []
    const sent = rows.filter(isOutboundInviteSnapshot)
    if (!showSent) rows = rows.filter((t) => !isOutboundInviteSnapshot(t))
    if (filter === 'quoted') rows = rows.filter((t) => t.response_status === 'QUOTED')
    if (q) rows = rows.filter((t) => [inboxThreadSupplierLabel(t), t.request_context?.reference, t.preview, t.subject].some((v) => String(v || '').includes(q)))
    return { visible: rows, hiddenSent: showSent ? 0 : sent.length }
  }, [threads, filter, query, showSent])

  // Counts for the chips come from the loaded list; with «يحتاج رد» selected the server returns only those.
  const counts = useMemo(() => {
    if (!threads || filter !== 'all') return null
    const rows = threads.filter((t) => showSent || !isOutboundInviteSnapshot(t))
    return { all: rows.length, needs: rows.filter((t) => t.needs_reply).length, quoted: rows.filter((t) => t.response_status === 'QUOTED').length }
  }, [threads, filter, showSent])

  const disabledReason = status && (status.enabled === false || status.allowed === false) ? 'صندوق الوارد غير مفعّل لهذا الحساب.' : null

  const list = (
    <section aria-labelledby="inbox-h" className={`flex min-h-0 flex-col ${mobile ? '' : `w-[320px] shrink-0 border-e ${surface}`}`}>
      <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 id="inbox-h" ref={listHeading} tabIndex={-1} className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold outline-none">صندوق الوارد</h1>
          <button type="button" aria-label="تحديث المحادثات" title="تحديث" onClick={() => void loadList()} className={`rounded-[var(--radius-sm)] p-1 text-[var(--color-icon-secondary)] hover:text-[var(--color-text-primary)] ${FOCUS_RING}`}><Icon name="refresh" size={18} /></button>
        </div>
        <label className={`flex h-10 flex-row items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] px-3 focus-within:outline-2 focus-within:outline-solid focus-within:outline-[var(--color-border-primary)]`}>
          <Icon name="search" size={18} className="text-[var(--color-icon-secondary)]" />
          <span className="sr-only">ابحث بالمورد أو رقم الطلب</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالمورد أو رقم الطلب" className="min-w-0 flex-1 bg-transparent text-[14px] leading-[22px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
        </label>
        <div role="group" aria-label="تصفية المحادثات" className="flex flex-wrap items-center gap-2">
          <Chip label={`الكل${counts ? ` ${counts.all}` : ''}`} selected={filter === 'all'} onClick={() => setFilter('all')} />
          <Chip label={`يحتاج رد${counts ? ` ${counts.needs}` : ''}`} selected={filter === 'needs_reply'} onClick={() => setFilter('needs_reply')} />
          <Chip label={`أرسل سعر${counts ? ` ${counts.quoted}` : ''}`} selected={filter === 'quoted'} onClick={() => setFilter('quoted')} />
        </div>
        <p aria-live="polite" className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">
          {refreshedAt ? `${visible.length} محادثات · يتحدث تلقائياً · آخر تحديث ${clock(new Date(refreshedAt).toISOString())}` : 'جارٍ التحميل…'}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {disabledReason ? <StateBox title={disabledReason} body="تفعيله من إعدادات الشركة في فرق بناء." /> : null}
        {listError ? <StateBox tone="danger" title="تعذر تحميل المحادثات" body={listError} action={<Button variant="Secondary" size="M" icon="refresh" onClick={() => void loadList()}>أعد المحاولة</Button>} /> : null}
        {!listError && threads === null ? <StateBox title="جارٍ تحميل المحادثات…" /> : null}
        {!listError && threads !== null && visible.length === 0 ? (
          <StateBox title={query ? 'لا توجد محادثة تطابق البحث' : filter === 'all' ? 'ما وصلت ردود من الموردين بعد' : 'لا توجد محادثات في هذا التصنيف'} body={filter === 'all' && !query ? 'أول ما يرد مورد على طلب تسعير تظهر رسالته هنا.' : undefined} />
        ) : null}
        <ul aria-label="المحادثات">
          {visible.map((t) => <ThreadRow key={t.invite_id} t={t} selected={t.invite_id === selected} onOpen={() => t.invite_id && open(t.invite_id)} />)}
        </ul>
        {hiddenSent ? (
          <button type="button" onClick={() => setShowSent(true)} className={`w-full p-4 text-center text-[14px] leading-[22px] font-medium text-[var(--color-text-link)] ${FOCUS_RING} focus-visible:-outline-offset-2`}>
            إظهار {hiddenSent} دعوة مرسلة بدون رد
          </button>
        ) : null}
      </div>
    </section>
  )

  const title = detail ? inboxThreadSupplierLabel(detail) : selectedRow ? inboxThreadSupplierLabel(selectedRow) : 'محادثة'
  const conversation = (
    <section aria-labelledby="conv-h" className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent">
      {mobile ? null : (
        <header className={`flex items-center justify-between gap-3 border-b px-6 py-4 ${surface}`}>
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <h2 id="conv-h" ref={convHeading} tabIndex={-1} className="max-w-full truncate font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold outline-none">{selected ? title : 'اختر محادثة'}</h2>
            {detail?.request_context?.reference || detail?.owner_name ? (
              <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{[detail?.request_context?.reference ? `طلب ${detail.request_context.reference}` : null, detail?.owner_name ? `المسؤول: ${detail.owner_name}` : null].filter(Boolean).join(' · ')}</p>
            ) : null}
          </div>
        </header>
      )}
      {mobile ? <h2 id="conv-h" ref={convHeading} tabIndex={-1} className="sr-only">{title}</h2> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        {!selected ? <StateBox title="اختر محادثة من القائمة" body="تظهر هنا رسائل المورد وردودكم بالترتيب." /> : null}
        {selected && detailLoading && !detail ? <StateBox title="جارٍ تحميل المحادثة…" /> : null}
        {selected && detailError ? <StateBox tone="danger" title="تعذر تحميل المحادثة" body={detailError} action={<Button variant="Secondary" size="M" icon="refresh" onClick={() => selected && void loadDetail(selected)}>أعد المحاولة</Button>} /> : null}
        {detail && !detail.messages?.length ? <StateBox title="لا توجد رسائل في هذه المحادثة بعد" /> : null}
        {detail?.messages?.length ? (
          <ol aria-label="الرسائل" className="flex flex-col gap-4">
            {detail.messages.map((m) => <Bubble key={m.id} m={m} />)}
          </ol>
        ) : null}
        {detail && mobile ? <div className="mt-5"><ExtractPanel detail={detail} onOpenRequest={onOpenRequest} compact /></div> : null}
      </div>
      {selected ? <Composer /> : null}
    </section>
  )

  if (mobile) {
    return (
      <div className="pricing-v2 flex min-h-dvh flex-col bg-transparent text-[var(--color-text-primary)]">
        {selected ? (
          <>
            <MobileAppBar title={title} onBack={() => open(null)} />
            {conversation}
          </>
        ) : <div className={`flex min-h-dvh flex-col pb-24 ${surface}`}>{list}</div>}
      </div>
    )
  }

  return (
    <div className="pricing-v2 flex h-dvh min-h-0 bg-transparent text-[var(--color-text-primary)]">
      {list}
      {conversation}
      <aside aria-label="قراءة الرد" className={`flex w-[340px] shrink-0 flex-col overflow-y-auto border-s ${surface}`}>
        {detail ? <ExtractPanel detail={detail} onOpenRequest={onOpenRequest} /> : <StateBox title="قراءة الرد" body="اختر محادثة لعرض تصنيف آخر رد من المورد." />}
      </aside>
    </div>
  )
}
