import { useEffect, useId, useRef, useState } from 'react'
import { sendCampaign, TargetingError, OUTREACH_TEMPLATE, type TargetRow } from '../../api/targetingClient'
import { Button, Icon, useIsMobile } from '../../ui'

/*
 * «10 · تأكيد إرسال الحملة» — Figma 54:607. The only place a campaign can leave from: nothing is
 * sent until the owner presses «نعم، أرسل». Figma's batch pace (50 an hour) and opt-out count are
 * not something the service does or knows, so the sheet does not promise them; it says what the
 * button really does: one template message from the Farq number to each chosen place.
 */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function CampaignConfirmSheet({ holderRfqId, rows, message, query, cost, onClose, onDone }: {
  holderRfqId: string
  rows: TargetRow[]
  message: string
  query: string
  cost: string
  onClose: () => void
  onDone: (sent: number, failed: number) => void
}) {
  const mobile = useIsMobile()
  const titleId = useId(), descId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(busy); busyRef.current = busy
  const closeRef = useRef(onClose); closeRef.current = onClose

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
      const r = await sendCampaign(holderRfqId, rows, message, query)
      if (!r.ok) { setError(`ما انرسلت الحملة: ${r.error || 'خطأ غير معروف'}${r.sent?.length ? ` (انرسل ${r.sent.length} قبل الخطأ)` : ''}`); return }
      onDone(r.sent?.length || 0, r.failed?.length || 0)
    } catch (e) {
      setError(e instanceof TargetingError ? (e.code === 'SEND_DISABLED' ? 'الإرسال مقفل في هذه البيئة، وما طلع أي شي.' : e.message) : 'تعذّر الإرسال. ما تأكدنا إن شي طلع — راجع صندوق الوارد قبل ما تعيد.')
    } finally { lock.current = false; setBusy(false) }
  }

  const count = rows.length.toLocaleString('en-US')
  const row = (k: string, v: string, strong = false) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{k}</dt>
      <dd className={strong ? 'font-[family-name:var(--font-display)] text-[16px] leading-[24px] font-semibold tabular-nums' : 'min-w-0 text-end text-[14px] leading-[22px] font-medium'}>{v}</dd>
    </div>
  )

  return (
    <div className={`fixed inset-0 z-[60] flex justify-center bg-[var(--color-bg-inverse)]/40 ${mobile ? 'items-end' : 'items-center p-4'}`} role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}
        className={`flex max-h-[92dvh] w-full flex-col overflow-y-auto bg-[var(--color-bg-surface)] px-6 pt-3 pb-6 text-start text-[var(--color-text-primary)] shadow-[var(--elevation-lg)] ${mobile ? 'rounded-t-[var(--radius-xl)]' : 'max-w-[520px] rounded-[var(--radius-xl)]'}`}>
        <span aria-hidden className="mx-auto mb-5 h-1 w-10 shrink-0 rounded-full bg-[var(--color-border-strong)]" />
        <h2 id={titleId} ref={heading} tabIndex={-1} className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold outline-none">إرسال الحملة على واتساب</h2>
        <p id={descId} className="mt-2 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
          بنرسل من رقم فرق الرسمي رسالة وحدة لكل جهة بالقالب المعتمد. الرسالة مدفوعة، وردودهم توصلك في صندوق الوارد.
        </p>
        <dl className="mt-5 flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface-2)] p-4">
          {row('المستلمين', `${count} جهة`)}
          {row('القالب', `${OUTREACH_TEMPLATE} · معتمد`)}
          {row('التكلفة التقديرية', `≈ ${cost} ر.س`, true)}
        </dl>
        <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] p-3">
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-tertiary)]">نص الرسالة</p>
          <p className="mt-1 text-[14px] leading-[22px] whitespace-pre-line">السلام عليكم {'{اسم المحل}'}،{'\n'}{message}</p>
        </div>
        {error ? (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />{error}
          </p>
        ) : null}
        <div className="mt-6 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Button variant="Primary" size="L" fullWidth disabled={busy || !rows.length} loading={busy} loadingLabel="جارٍ الإرسال…" onClick={() => void send()}>نعم، أرسل لـ {count} جهة</Button>
          </div>
          <Button variant="Secondary" size="L" disabled={busy} onClick={onClose}>رجوع</Button>
        </div>
      </div>
    </div>
  )
}
