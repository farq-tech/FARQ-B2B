import { useEffect, useState, type ReactNode } from 'react'
import { listTemplates, templateStatus, templateBody, templateFits, OUTREACH_TEMPLATE, type MetaTemplate } from '../../api/targetingClient'
import { Badge, Button, Icon, MobileAppBar, Money, type BadgeTone } from '../../ui'
import SendTiming from './SendTiming'
import { FOCUS_RING } from '../../ui/cx'
import { metaReasonAr } from './metaReason'

/*
 * «الرسالة» — Figma B2B M08 `18375:467`: choose a Meta-approved template, see the message as each supplier
 * gets it, «قالب جديد», and the summary bar (template · recipients · cost) with «التالي» → review (M11).
 * Any approved Arabic template whose body takes exactly {{1}} (the place's name) and {{2}} (the campaign text edited
 * here) can be chosen: that is what the send path fills. Others are listed with their real state and why not.
 */

export const CAMPAIGN_STEPS = ['الشريحة المستهدفة', 'الرسالة', 'موافقة ميتا', 'المراجعة والإرسال'] as const

export function Steps({ current }: { current: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div role="progressbar" aria-label="خطوات الحملة" aria-valuemin={1} aria-valuemax={4} aria-valuenow={current + 1} className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-surface-2)]">
        <div className="h-full rounded-full bg-[var(--color-bg-brand)]" style={{ width: `${((current + 1) / CAMPAIGN_STEPS.length) * 100}%` }} />
      </div>
      <ol className="grid grid-cols-4 gap-1 text-[12px] leading-[18px]">
        {CAMPAIGN_STEPS.map((s, i) => <li key={s} aria-current={i === current ? 'step' : undefined} className={i === current ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}>{s}</li>)}
      </ol>
    </div>
  )
}

type Choice = { name: string; title: string; detail: string; tone: BadgeTone; badge: string; usable: boolean; body: string; reason?: { ar: string; original: string } | null }
const CATEGORY: Record<string, string> = { MARKETING: 'تسويق', UTILITY: 'خدمة', AUTHENTICATION: 'تحقق' }
export const categoryAr = (c?: string) => (c ? CATEGORY[c] || c : '')

const titleOf = (t: MetaTemplate) => (t.name === OUTREACH_TEMPLATE ? 'دعوة الموردين للانضمام' : (t.components || []).find((c) => c.type === 'BODY')?.text?.split('\n')[0]?.slice(0, 40) || t.name)

function choiceOf(t: MetaTemplate): Choice {
  const reason = t.status === 'REJECTED' ? metaReasonAr(t.rejected_reason) : null
  const body = templateBody(t)
  // the status endpoint gives no body for the invitation template: it is known to take {{1}} and {{2}}
  const fits = templateFits(t) || (t.status === 'APPROVED' && t.name === OUTREACH_TEMPLATE && !body)
  if (fits) return { name: t.name, title: titleOf(t), detail: [t.name, categoryAr(t.category)].filter(Boolean).join(' · '), tone: 'Success', badge: 'معتمد', usable: true, body }
  if (t.status === 'APPROVED') return { name: t.name, title: titleOf(t), detail: 'معتمد، لكن متغيراته ما تناسب الحملة ({{1}} الاسم و{{2}} النص)', tone: 'Success', badge: 'معتمد', usable: false, body }
  if (t.status === 'REJECTED') return { name: t.name, title: titleOf(t), detail: 'ما ينفع للإرسال · عدّله', tone: 'Danger', badge: 'مرفوض', usable: false, reason, body }
  return { name: t.name, title: titleOf(t), detail: 'ما ينفع للإرسال الآن', tone: 'Warning', badge: 'قيد المراجعة', usable: false, body }
}

/** Fills a template body for the preview: {{1}} = the place's name, {{2}} = the campaign text. */
export const previewOf = (body: string, message: string) => body.replace(/\{\{\s*1\s*\}\}/g, '{اسم المنشأة}').replace(/\{\{\s*2\s*\}\}/g, message.trim() || '…')

export default function MessageStep({ count, cost, message, onMessage, onBack, onNext, onNewTemplate, blocked, template, onTemplate, city }: {
  /** the search city (City.en): prayer times for the send note */
  city?: string | null
  /** The chosen template (page state, so the confirm sheet sends it). */
  template?: string
  onTemplate?: (name: string) => void
  /** A reason from the page that stops «التالي» (e.g. no holder request for replies). */
  blocked?: string | null
  count: number
  cost: string | null
  message: string
  onMessage: (v: string) => void
  onBack: () => void
  onNext: () => void
  onNewTemplate: () => void
}) {
  const [choices, setChoices] = useState<Choice[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [own, setOwn] = useState<string | null>(null)
  const picked = template ?? own
  const setPicked = (name: string) => { setOwn(name); onTemplate?.(name) }
  useEffect(() => {
    let on = true
    listTemplates().then((r) => { if (!r.ok) throw new Error(r.error); return r.data })
      .catch(() => templateStatus().then((t) => [{ name: t.name, status: t.status, category: t.category, rejected_reason: t.rejected_reason }] as MetaTemplate[]))
      .then((list) => {
        if (!on) return
        const rows = list.map(choiceOf).sort((a, b) => Number(b.usable) - Number(a.usable))
        setChoices(rows)
        const first = rows.find((c) => c.usable && c.name === (template || OUTREACH_TEMPLATE)) || rows.find((c) => c.usable)
        if (first) { setOwn(first.name); onTemplate?.(first.name) }
      }, () => { if (on) setFailed(true) })
    return () => { on = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = choices?.find((c) => c.name === picked) || null
  const rejected = choices?.filter((c) => c.reason) || []
  const block = blocked ? blocked : failed ? 'تعذّر التحقق من القوالب' : !choices ? 'نتحقق من القوالب…' : !chosen ? 'ما فيه قالب معتمد للإرسال بعد' : !message.trim() ? 'اكتب نص الرسالة' : null

  return (
    <section aria-labelledby="msg-h" className="flex min-h-full flex-col bg-transparent">
      <MobileAppBar title="حملة موردين" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 id="msg-h" className="sr-only">حملة موردين · الرسالة</h1>
        <Steps current={1} />
        <h2 className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-semibold">اختر قالباً معتمداً من ميتا</h2>
        {failed ? <p role="alert" className="text-[14px] text-[var(--color-text-danger)]">ما قدرنا نجيب القوالب الحين. حاول بعد شوي.</p> : null}
        {!choices && !failed ? <p role="status" className="text-[14px] text-[var(--color-text-secondary)]">نجيب القوالب…</p> : null}
        <div role="radiogroup" aria-label="القالب" className="flex flex-col gap-2">
          {(choices || []).map((c) => (
            <label key={c.name} className={`flex min-h-16 flex-row items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-4 py-3 ${c.usable ? 'cursor-pointer' : 'opacity-70'}`}>
              <Icon name="file" size={20} className="shrink-0 text-[var(--color-text-secondary)]" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[16px] leading-[26px] font-medium">{c.title}</span>
                <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]"><bdi>{c.detail}</bdi></span>
              </span>
              <input type="radio" name="campaign-template" checked={picked === c.name} disabled={!c.usable} onChange={() => setPicked(c.name)} className={`size-5 shrink-0 accent-[var(--color-bg-primary)] ${FOCUS_RING}`} />
              <Badge tone={c.tone} showDot={false} label={c.badge} className="shrink-0" />
            </label>
          ))}
        </div>
        {rejected.map((c) => (
          <div key={c.name} className="flex flex-col gap-1 text-[14px] leading-[22px] text-[var(--color-text-danger)]">
            <p>رفضت ميتا «{c.title}»: {c.reason!.ar}</p>
            <details className="text-[12px] text-[var(--color-text-secondary)]"><summary className="cursor-pointer">النص الأصلي من ميتا</summary><p dir="ltr" className="text-start">{c.reason!.original}</p></details>
          </div>
        ))}
        <Button variant="Secondary" size="L" fullWidth icon="plus" onClick={onNewTemplate}>قالب جديد</Button>
        <label className="flex flex-col gap-2">
          <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">معاينة: هكذا تصل الرسالة لكل مورد باسمه</span>
          <span className="flex flex-col rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-4 py-3 focus-within:outline-2 focus-within:outline-solid focus-within:outline-[var(--color-border-primary)]">
            <span className="text-[14px] leading-[22px]">السلام عليكم {'{اسم المنشأة}'}،</span>
            <textarea value={message} onChange={(e) => onMessage(e.target.value)} rows={4} maxLength={900} aria-label="نص الرسالة" className="w-full resize-none border-0 bg-transparent p-0 text-[14px] leading-[22px] outline-none" />
          </span>
        </label>
        {chosen?.body ? <p className="rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-4 py-3 text-[14px] leading-[22px] whitespace-pre-line text-[var(--color-text-secondary)]">{previewOf(chosen.body, message)}</p> : null}
        <SendTiming city={city} className="rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-4 py-3" />
      </div>
      <SummaryBar
        title={chosen ? <>القالب: <bdi dir="ltr">{chosen.name}</bdi> · معتمد</> : 'اختر قالباً'}
        detail={<><bdi dir="ltr">{count}</bdi> موردين{cost != null ? <> · = <Money amount={cost} vat="excl" noteClassName="text-[length:inherit] leading-[inherit] text-[var(--color-text-on-inverse-secondary)]" /></> : null}</>}
        action={<Button variant="Secondary" size="M" disabled={Boolean(block)} title={block || undefined} onClick={onNext}>التالي</Button>}
        reason={block}
      />
    </section>
  )
}

/** Figma «Basket bar»: dark bar above the tab bar with the running choice and the next step. */
export function SummaryBar({ title, detail, action, reason }: { title: ReactNode; detail: ReactNode; action: ReactNode; reason?: string | null }) {
  return (
    <div className="sticky bottom-0 flex flex-col gap-1 bg-[var(--color-bg-inverse)] px-4 py-3 text-[var(--color-text-on-inverse)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <p className="text-[16px] leading-[26px] font-medium">{title}</p>
          <p className="text-[12px] leading-[18px] text-[var(--color-text-on-inverse-secondary)]">{detail}</p>
        </div>
        {action}
      </div>
      {reason ? <p className="text-[12px] leading-[18px] text-[var(--color-text-on-inverse-secondary)]">{reason}</p> : null}
    </div>
  )
}
