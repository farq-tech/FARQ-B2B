import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { sendCampaign, sendStatus, TargetingError, OUTREACH_TEMPLATE, type TargetRow } from '../../api/targetingClient'
import { Badge, Button, Icon, useIsMobile } from '../../ui'

/*
 * «المراجعة والتكلفة» — Figma B2B M11 `18375:23935` / M11c `18416:2498` (sending not enabled).
 * Cost = the server's price per message × recipients, before tax. When this environment keeps sending closed
 * (server.py TARGETING_SEND unset) the sheet says so before anything is pressed and offers «احفظ الحملة كمسودة».
 *
 * «10 · تأكيد إرسال الحملة» — Figma 54:607. The only place a campaign can leave from: nothing is
 * sent until the owner presses «نعم، أرسل». Figma's batch pace (50 an hour) and opt-out count are
 * not something the service does or knows, so the sheet does not promise them; it says what the
 * button really does: one template message from the Farq number to each chosen place.
 */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function CampaignConfirmSheet({ holderRfqId, rows, message, query, price, onClose, onDone, onSaveDraft, template = OUTREACH_TEMPLATE }: {
  /** The approved template chosen on the page ({{1}} name, {{2}} campaign text); the invitation template by default. */
  template?: string
  holderRfqId: string
  rows: TargetRow[]
  message: string
  query: string
  /** Server price per WhatsApp message in SAR, before tax; null when the server did not give one. */
  price: number | null
  onClose: () => void
  onDone: (sent: number, failed: number) => void
  onSaveDraft: () => void
}) {
  const mobile = useIsMobile()
  const titleId = useId(), descId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<boolean | null>(null)
  // Figma M12: after a send the same sheet shows each recipient's stage. Delivery/read/reply are not in the
  // send answer (GAP D2), so they are not claimed here; replies arrive in the inbox. Nothing is resent.
  const [result, setResult] = useState<{ sent: Set<string>; failed: Map<string, string> } | null>(null)
  useEffect(() => { let on = true; void sendStatus().then((v) => { if (on) setOpen(v) }); return () => { on = false } }, [])
  const busyRef = useRef(busy)
  const closeRef = useRef(onClose)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    heading.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (!busyRef.current) closeRef.current(); return }
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) return
      const first = items[0], last = items[items.length - 1], a = document.activeElement
      if (e.shiftKey && (a === first || a === heading.current || !panel.current.contains(a))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (a === last || !panel.current.contains(a))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; if (opener && document.contains(opener)) opener.focus() }
  }, [])

  async function send() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const r = await sendCampaign(holderRfqId, rows, message, query, template)
      if (!r.ok) { setError(`ما انرسلت الحملة: ${r.error || 'خطأ غير معروف'}${r.sent?.length ? ` (انرسل ${r.sent.length} قبل الخطأ)` : ''}`); return }
      setResult({ sent: new Set((r.sent || []).map((x) => x.poi_key)), failed: new Map((r.failed || []).map((x) => [x.poi_key, x.error])) })
    } catch (e) {
      setError(e instanceof TargetingError ? (e.code === 'SEND_DISABLED' ? 'الإرسال مقفل في هذه البيئة، وما طلع أي شي.' : e.message) : 'تعذّر الإرسال. ما تأكدنا إن شي طلع — راجع صندوق الوارد قبل ما تعيد.')
    } finally { lock.current = false; setBusy(false) }
  }

  // Once a send happened, closing the sheet reports it (never a silent close after a send).
  const close = () => (result ? onDone(result.sent.size, result.failed.size) : onClose())
  useEffect(() => { busyRef.current = busy; closeRef.current = close })
  const count = rows.length.toLocaleString('en-US')
  const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const cost = price != null ? money(price * rows.length) : null
  const closedReason = open === false ? 'الإرسال غير مفعّل' : open === null ? 'نتحقق إن الإرسال مفتوح…' : null
  const row = (k: string, v: ReactNode, strong = false) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{k}</dt>
      <dd className={strong ? 'font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold tabular-nums' : 'min-w-0 text-end text-[16px] leading-[26px] font-semibold'}>{v}</dd>
    </div>
  )

  return (
    <div className={`fixed inset-0 z-[60] flex justify-center bg-[var(--color-bg-inverse)]/40 ${mobile ? 'items-end' : 'items-center p-4'}`} role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close() }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}
        className={`flex max-h-[92dvh] w-full flex-col overflow-y-auto bg-[var(--color-bg-surface)] px-6 pt-3 pb-6 text-start text-[var(--color-text-primary)] shadow-[var(--elevation-lg)] ${mobile ? 'rounded-t-[var(--radius-xl)]' : 'max-w-[520px] rounded-[var(--radius-xl)]'}`}>
        <span aria-hidden className="mx-auto mb-5 h-1 w-10 shrink-0 rounded-full bg-[var(--color-border-strong)]" />
        {result ? (
          <>
            <h2 id={titleId} ref={heading} tabIndex={-1} className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold outline-none">نتيجة الإرسال</h2>
            <p id={descId} className="mt-2"><Badge tone={result.failed.size ? 'Warning' : 'Info'} showDot={false} label={`أُرسلت ${result.sent.size.toLocaleString('en-US')} من ${count}`} /></p>
            <p className="mt-2 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">«أُرسلت» يعني إن رقم فرق سلّمها لواتساب. الردود توصلك في صندوق الوارد. ما نعيد الإرسال تلقائياً.</p>
            <h3 className="mt-4 text-[16px] leading-[26px] font-semibold">لكل مستلم</h3>
            <ul className="mt-2 flex flex-col divide-y divide-[var(--color-border-default)] rounded-[var(--radius-lg)] border border-[var(--color-border-default)]">
              {rows.map((r) => {
                const name = r.name_ar || r.name_en || 'مورد'
                const err = result.failed.get(r.poi_key)
                const ok = result.sent.has(r.poi_key)
                return (
                  <li key={r.poi_key} className="flex min-h-16 flex-row items-center gap-3 px-4 py-3">
                    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-primary-subtle)] font-medium">{name.trim().charAt(0)}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[16px] leading-[26px] font-medium">{name}</span>
                      <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{ok ? '✓ أُرسلت · الرد يظهر في الوارد' : err ? `ما وصلت: ${err}` : 'ما تأكدنا · ما رجع لها جواب من الإرسال'}</span>
                    </span>
                    <Badge tone={ok ? 'Info' : err ? 'Danger' : 'Warning'} showDot={false} label={ok ? 'أُرسلت' : err ? 'ما وصلت' : 'ما تأكدنا'} />
                  </li>
                )
              })}
            </ul>
            <div className="mt-6"><Button variant="Primary" size="L" fullWidth onClick={() => onDone(result.sent.size, result.failed.size)}>تم</Button></div>
          </>
        ) : <>
        <h2 id={titleId} ref={heading} tabIndex={-1} className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold outline-none">المراجعة والتكلفة</h2>
        <dl className="mt-4 flex flex-col gap-3">
          {row('المستلمون', <><bdi dir="ltr">{count}</bdi> موردين · واتساب <bdi dir="ltr">{count}</bdi></>)}
          {row('القالب', <><bdi dir="ltr">{template}</bdi> · معتمد</>)}
          {row('سعر الرسالة', price != null ? <><bdi dir="ltr">{money(price)} ر.س × {count}</bdi> · تسويق</> : 'ما وصلنا السعر الحين')}
          {row('التكلفة', cost != null ? <bdi dir="ltr">{cost} ر.س</bdi> : '—', true)}
        </dl>
        <p className="mt-3 text-[14px] leading-[22px] font-medium">السعر قبل الضريبة. الضريبة تُضاف حسب الفاتورة.</p>
        {open === false ? (
          <div className="mt-3 flex flex-col items-start gap-2">
            <p className="text-[14px] leading-[22px]">يفعّله فريق فرق لحسابك. احفظ الحملة وترسلها بضغطة لما يتفعّل.</p>
            <Badge tone="Warning" showDot={false} label="الإرسال غير مفعّل" />
          </div>
        ) : null}
        <p id={descId} className="mt-3 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">رسالة واحدة لكل مورد من رقم فرق. تأكيد واحد، بلا إعادة إرسال تلقائية.</p>
        <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] p-3">
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">نص الرسالة</p>
          <p className="mt-1 text-[14px] leading-[22px] whitespace-pre-line">السلام عليكم {'{اسم المنشأة}'}،{'\n'}{message}</p>
        </div>
        {error ? (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />{error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-3">
          <Button variant="Primary" size="L" fullWidth disabled={busy || !rows.length || open !== true} title={closedReason || undefined} loading={busy} loadingLabel="جارٍ الإرسال…" onClick={() => void send()}>
            أرسل إلى {count} موردين{cost != null ? ` · التكلفة ${cost} ر.س` : ''}
          </Button>
          {open === true ? <Button variant="Secondary" size="L" fullWidth disabled={busy} onClick={onClose}>رجوع</Button>
            : <Button variant="Secondary" size="L" fullWidth disabled={busy} onClick={onSaveDraft}>احفظ الحملة كمسودة</Button>}
          {open === false ? <Button variant="Ghost" size="M" fullWidth onClick={onClose}>رجوع</Button> : null}
        </div>
        </>}
      </div>
    </div>
  )
}
