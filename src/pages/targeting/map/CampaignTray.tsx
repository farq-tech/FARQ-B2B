import { useEffect, useState } from 'react'
import { listTemplates, templateBody, templateFits, templateVariables, OUTREACH_TEMPLATE, type MetaTemplate } from '../../../api/targetingClient'
import { scheduleCampaign } from '../../../api/scheduleClient'
import { Badge, Button, Icon, Money } from '../../../ui'
import { FOCUS_RING } from '../../../ui/cx'
import { cityCoords, fromKsaInput, ksaClock, nextScheduleSlot, RIYADH, scheduleWarning, toKsaInput, dualDateLabel } from '../../../lib/saudi'
import { categoryAr } from '../MessageStep'
import SendTiming from '../SendTiming'

// Meta does not always return the body for the default approved template. Keep
// the preview useful in that case; these are the two values sent by the API.
const DEFAULT_TEMPLATE_BODY = 'السلام عليكم {{1}}،\n{{2}}'
const labelForVariable = (n: number) => n === 1 ? 'اسم المنشأة المستلمة' : n === 2 ? 'نص الرسالة' : n === 3 ? 'الكمية' : n === 4 ? 'موقع أو موعد التوريد' : `المتغير ${n}`
const placeholderForVariable = (n: number) => n === 3 ? 'مثال: 120 م²' : n === 4 ? 'مثال: الرياض · خلال أسبوع' : `أدخل قيمة المتغير ${n}`
const previewTemplate = (body: string, message: string, values: Record<string, string>) => body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, raw) => {
  const n = Number(raw)
  if (n === 1) return '{اسم المنشأة}'
  if (n === 2) return message.trim() || '…'
  return values[String(n)]?.trim() || `{${labelForVariable(n)}}`
})

/*
 * «رسالة الحملة» as a tray under the map (owner 2026-10-16): hidden until at least one recipient is chosen, collapsed
 * by default, never on top of the map. It holds the approved template, the text, «إرسال الآن» / «جدولة» (Saudi time,
 * defaulting to the next allowed window), the prayer note and «وضع رمضان», and the cost with the riyal sign.
 * «إرسال الآن» opens the same review sheet as before (sending unchanged). «جدولة» calls POST /api/targeting/schedule;
 * a 404 there turns only the schedule option off («الجدولة قريباً»).
 */
type Props = {
  count: number
  keys: string[]
  cost: string | null
  message: string
  onMessage: (v: string) => void
  templateValues: Record<string, string>
  onTemplateValues: (values: Record<string, string>) => void
  template: string
  onTemplate: (v: string) => void
  templates: MetaTemplate[]
  /** why «أرسل» cannot run now (null = it can) */
  sendBlock: string | null
  /** template / message problems that also stop a schedule */
  scheduleBlock: string | null
  templateBadge: { tone: 'Success' | 'Warning' | 'Danger'; label: string } | null
  city: string
  showTiming: boolean
  onSend: () => void
  onPrepare?: () => void
  onOpenLeads?: () => void
  preparing?: boolean
  prepared?: boolean
  openRequest?: number
  onClear: () => void
  onNotice: (text: string) => void
  mobile: boolean
}

export default function CampaignTray(p: Props) {
  const [open, setOpen] = useState(false)
  const [accountTemplates, setAccountTemplates] = useState<MetaTemplate[]>(p.templates)
  const [mode, setMode] = useState<'now' | 'schedule'>('now')
  const where = cityCoords(p.city) || RIYADH
  const [when, setWhen] = useState(() => toKsaInput(nextScheduleSlot(new Date(), where)))
  const [soon, setSoon] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (p.openRequest) setOpen(true) }, [p.openRequest])
  useEffect(() => { setAccountTemplates(p.templates) }, [p.templates])
  useEffect(() => {
    if (!open) return
    listTemplates().then((listed) => { if (listed.ok) setAccountTemplates(listed.data || []) }, () => { /* retain parent data */ })
  }, [open])
  const sendableTemplates = accountTemplates.filter(templateFits)
  useEffect(() => {
    if (!sendableTemplates.length || sendableTemplates.some((t) => t.name === p.template)) return
    const fallback = sendableTemplates.find((t) => t.name === OUTREACH_TEMPLATE) || sendableTemplates[0]
    p.onTemplate(fallback.name)
  }, [p.template, sendableTemplates.map((t) => t.name).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const at = fromKsaInput(when)
  const warn = at ? scheduleWarning(at, new Date(), where) : 'اختر التاريخ والوقت.'
  const hardStop = !at || (warn !== null && (warn.startsWith('اختر') || warn.startsWith('هذا الوقت وقت صلاة')))
  const activeTemplate = accountTemplates.find((t) => t.name === p.template) || { name: '', status: '' } as MetaTemplate
  const body = templateBody(activeTemplate)
  const variables = templateVariables(activeTemplate)
  const hasExtraVariables = variables.some((n) => n > 2)
  const preview = previewTemplate(body || DEFAULT_TEMPLATE_BODY, p.message, p.templateValues)

  async function schedule() {
    if (!at || busy) return
    setBusy(true); setError(null)
    const r = await scheduleCampaign({ keys: p.keys, message: p.message.trim(), template: p.template, send_at: at.toISOString() })
    setBusy(false)
    if (r.status === 'soon') { setSoon(true); setMode('now'); return }
    if (r.status === 'error') { setError(r.message); return }
    setOpen(false)
    p.onNotice(`أبشر، جدولنا الحملة لـ ${p.count.toLocaleString('en-US')} منشأة: ${dualDateLabel(at)} الساعة ${ksaClock(at)} بتوقيت السعودية.`)
  }

  const costLine = p.cost != null ? <>≈ <Money amount={p.cost} vat="excl" noteClassName="text-[length:inherit] leading-[inherit] font-[inherit]" /></> : 'السعر يظهر في المراجعة'
  return (
    <section aria-labelledby="campaign-title" data-testid="campaign-tray"
      className={`flex min-h-0 max-h-[min(72dvh,34rem)] flex-col overflow-hidden border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] shadow-[0_-6px_20px_-12px_var(--map-ink)] ${p.mobile ? '-mx-4 rounded-[18px] border' : 'max-h-[46%] shrink-0'}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-col">
          <h2 id="campaign-title" className="text-[16px] leading-[24px] font-semibold">{p.onPrepare ? 'قائمة حملة واتساب' : 'رسالة الحملة'} <span className="font-medium text-[var(--color-text-secondary)]">· اخترت <bdi dir="ltr">{p.count.toLocaleString('en-US')}</bdi> منشأة</span></h2>
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">واتساب عبر فرق · {p.onPrepare ? 'مسودة للمراجعة' : costLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="Ghost" size="S" onClick={p.onClear}>إلغاء التحديد</Button>
          <button type="button" aria-expanded={open} aria-controls="campaign-body" onClick={() => setOpen((o) => !o)}
            className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--map-ink)] px-4 py-2 text-[14px] leading-[22px] font-medium text-white ${FOCUS_RING}`}>
            {open ? 'صغّر' : p.onPrepare ? 'راجع الحملة' : 'اكتب الرسالة'}<Icon name="chevron-down" size={14} className={open ? '' : 'rotate-180'} />
          </button>
        </div>
      </div>
      {open ? (
        <div id="campaign-body" className={`grid min-h-0 flex-1 touch-pan-y gap-4 overflow-y-auto overscroll-contain border-t border-[var(--color-border-default)] px-4 py-3 ${p.mobile ? 'grid-cols-1' : 'grid-cols-[1.2fr_1fr]'}`}>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="campaign-template" className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">قالب واتساب</label>
              {p.templateBadge ? <Badge tone={p.templateBadge.tone} showDot={false} label={p.templateBadge.label} /> : null}
            </div>
            <select id="campaign-template" value={p.template} onChange={(e) => p.onTemplate(e.target.value)} className={`rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-[14px] ${FOCUS_RING}`}>
              {sendableTemplates.map((t) => <option key={t.name} value={t.name}>{[t.name, categoryAr(t.category)].filter(Boolean).join(' · ')}</option>)}
            </select>
            {!sendableTemplates.length ? <p role="alert" className="text-[12px] leading-[18px] text-[var(--color-text-danger)]">لا يوجد قالب معتمد ومهيأ للإرسال الآن.</p> : null}
            {p.onPrepare ? <p className="rounded-[12px] bg-[var(--color-bg-surface-2)] px-3 py-3 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">تظهر القوالب المعتمدة والمهيأة للإرسال فقط. القوالب قيد المراجعة تظهر هنا بعد اعتمادها من ميتا.</p> : <>
              <label className="flex flex-col rounded-[12px] bg-[var(--color-bg-surface-2)] px-3 py-2.5 focus-within:outline-2 focus-within:outline-solid focus-within:outline-[var(--color-border-primary)]">
                <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">نص الرسالة · المتغير 2</span>
                <span className="sr-only">نص الرسالة</span>
                <textarea value={p.message} onChange={(e) => p.onMessage(e.target.value)} rows={3} maxLength={900} className="w-full resize-none bg-transparent text-[15px] leading-[24px] outline-none" />
              </label>
              {variables.map((n) => n === 1 ? (
                <label key={n} className="flex flex-col gap-1 rounded-[12px] bg-[var(--color-bg-surface-2)] px-3 py-2.5 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{labelForVariable(n)}
                  <input value="يُعبأ تلقائياً من الدليل لكل مستلم" readOnly aria-label={labelForVariable(n)} className="rounded-[8px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-[14px] text-[var(--color-text-primary)]" />
                </label>
              ) : n === 2 ? null : (
                <label key={n} className="flex flex-col gap-1 rounded-[12px] bg-[var(--color-bg-surface-2)] px-3 py-2.5 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{labelForVariable(n)}
                  <input value={p.templateValues[String(n)] || ''} onChange={(e) => p.onTemplateValues({ ...p.templateValues, [String(n)]: e.target.value })} placeholder={placeholderForVariable(n)} aria-label={labelForVariable(n)} className={`rounded-[8px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-[14px] text-[var(--color-text-primary)] ${FOCUS_RING}`} />
                </label>
              ))}
              <section data-testid="campaign-message-preview" aria-label="معاينة الرسالة قبل الإرسال" className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2.5">
                <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">معاينة الرسالة قبل الإرسال</p>
                <p className="mt-1 whitespace-pre-line text-[14px] leading-[22px]">{preview}</p>
              </section>
            </>}
          </div>
          <div className="flex flex-col gap-2.5">
            {!p.onPrepare ? <fieldset className="m-0 flex gap-2 border-0 p-0">
              <legend className="sr-only">وقت الإرسال</legend>
              {([['now', 'إرسال الآن'], ['schedule', 'جدولة']] as const).map(([k, l]) => (
                <label key={k} className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[14px] font-medium has-[:checked]:border-[var(--map-ink)] has-[:checked]:bg-[var(--map-ink)] has-[:checked]:text-white has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 border-[var(--color-border-default)]`}>
                  <input type="radio" name="campaign-when" value={k} checked={mode === k} disabled={k === 'schedule' && (soon || hasExtraVariables)} onChange={() => setMode(k)} className="sr-only" />
                  {l}
                </label>
              ))}
            </fieldset> : null}
            {soon ? <p role="status" className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">الجدولة قريباً. تقدر ترسل الآن.</p> : null}
            {hasExtraVariables ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">القوالب ذات المتغيرات الإضافية تُرسل الآن بعد المراجعة؛ الجدولة لا تحفظ هذه القيم بعد.</p> : null}
            {!p.onPrepare && mode === 'schedule' ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="campaign-at" className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">موعد الإرسال (بتوقيت السعودية)</label>
                <input id="campaign-at" type="datetime-local" step={900} value={when} onChange={(e) => setWhen(e.target.value)} className={`rounded-[10px] border border-[var(--color-border-default)] px-2 py-1.5 text-[14px] ${FOCUS_RING}`} />
                {at ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{dualDateLabel(at)} · {ksaClock(at)}</p> : null}
                {warn ? <p className={`text-[12px] leading-[18px] ${hardStop ? 'text-[var(--color-text-danger)]' : 'text-[var(--color-text-secondary)]'}`}>{warn}</p> : null}
              </div>
            ) : null}
            {!p.onPrepare && p.showTiming ? <SendTiming city={p.city} /> : null}
            {error ? <p role="alert" className="text-[12px] leading-[18px] text-[var(--color-text-danger)]">{error}</p> : null}
            {p.onPrepare ? (
              <>
                <Button variant="Primary" size="M" icon="whatsapp" disabled={Boolean(p.sendBlock) || p.preparing || p.prepared} loading={p.preparing} loadingLabel="نضيف القائمة…" title={p.sendBlock || undefined} onClick={p.onPrepare}>{p.prepared ? 'المسودة محفوظة' : 'أضف إلى حملة واتساب'}</Button>
                <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">هذه الخطوة تحفظ قائمتك كمسودة في واتساب ولا ترسل رسالة. الإرسال يبقى إجراءً يدويًا منفصلًا.</p>
                {p.sendBlock ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{p.sendBlock}</p> : null}
              </>
            ) : mode === 'now' ? (
              <>
                <Button variant="Primary" size="M" icon="send" disabled={Boolean(p.sendBlock)} title={p.sendBlock || undefined} onClick={p.onSend}>أرسل الحملة</Button>
                {p.sendBlock ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{p.sendBlock}</p> : null}
              </>
            ) : (
              <>
                <Button variant="Primary" size="M" icon="clock" disabled={Boolean(p.scheduleBlock) || hardStop || busy} loading={busy} loadingLabel="نجدول…" title={p.scheduleBlock || undefined} onClick={() => void schedule()}>جدول الحملة</Button>
                {p.scheduleBlock ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{p.scheduleBlock}</p> : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
