'use client'

import { CircleCheck, ChevronLeft, ChevronRight, CircleQuestionMark, Clock, Minus, ShieldCheck, CircleX, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { AUTO_VARIABLES, TEMPLATES, businessById, districtById } from '@/lib/mock-data'
import type { Business, CampaignDetails, LiveBusinessSnapshot } from '@/lib/types'
import { numberFormat } from '@/lib/insights-api'
import { cn } from '@/lib/utils'

export function templateVariables(body: string) {
  return Array.from(new Set(Array.from(body.matchAll(/\{\{(.+?)\}\}/g), (m) => m[1])))
}

type TemplateRecipient = Pick<Business, 'name'> & { districtId?: string; district?: string }

/** The message cut into its fixed text and its filled-in values; a value with nothing to fill it is `missing`. */
export function templateParts(body: string, vars: Record<string, string>, b?: TemplateRecipient): { text: string; missing?: boolean }[] {
  const parts: { text: string; missing?: boolean }[] = []
  let last = 0
  for (const match of body.matchAll(/\{\{(.+?)\}\}/g)) {
    if (match.index! > last) parts.push({ text: body.slice(last, match.index) })
    const key = match[1]
    const value = key === 'اسم_المنشأة' ? b?.name
      : key === 'الحي' ? b?.district ?? (b?.districtId ? districtById.get(b.districtId)?.name : undefined)
        : vars[key]?.trim()
    parts.push(value ? { text: value } : { text: `[${key.replace(/_/g, ' ')}]`, missing: true })
    last = match.index! + match[0].length
  }
  if (last < body.length) parts.push({ text: body.slice(last) })
  return parts
}

export function renderTemplate(body: string, vars: Record<string, string>, b?: TemplateRecipient) {
  return templateParts(body, vars, b).map((part) => part.text).join('')
}

export function eligibility(b: Business): { ok: boolean; reason?: string } {
  if (!b.whatsapp) return { ok: false, reason: 'لا يوجد رقم واتساب' }
  return { ok: true }
}

export function campaignIssues(c: CampaignDetails) {
  const t = TEMPLATES.find((x) => x.id === c.templateId)
  const issues: string[] = []
  if (!t || t.approval !== 'معتمد') issues.push('اختر صيغة رسالة متاحة.')
  if (t) {
    const missing = templateVariables(t.body).filter((v) => !AUTO_VARIABLES.includes(v) && !c.variables[v]?.trim())
    if (missing.length) issues.push(`أكمل المتغيرات: ${missing.map((m) => m.replace(/_/g, ' ')).join('، ')}.`)
  }
  if (c.included.length === 0) {
    issues.push('لا يوجد مستلمون مؤهلون.')
  }
  return issues
}

type Delivery = NonNullable<CampaignDetails['delivery']>[string]

/** Where one recipient of a reviewed campaign stands: left out and why, or its send result. */
export function recipientState(ineligible: string | undefined, included: boolean, demo: boolean, delivery: Delivery | undefined): { label: string; icon: LucideIcon; tone: string; muted?: boolean } {
  if (ineligible) return { label: ineligible, icon: Minus, tone: 'text-muted-foreground', muted: true }
  if (!included) return { label: 'استُبعدت عند المراجعة', icon: Minus, tone: 'text-muted-foreground', muted: true }
  if (demo) return { label: 'ليست من نتائج الدليل الحية', icon: Minus, tone: 'text-muted-foreground', muted: true }
  if (delivery === 'sent') return { label: 'أُرسلت', icon: CircleCheck, tone: 'text-primary' }
  if (delivery === 'failed') return { label: 'فشل الإرسال', icon: CircleX, tone: 'text-destructive' }
  if (delivery === 'unknown') return { label: 'النتيجة غير مؤكدة', icon: CircleQuestionMark, tone: 'text-warning' }
  return { label: 'بانتظار الإرسال', icon: Clock, tone: 'text-muted-foreground' }
}

interface CampaignEditorProps {
  value: CampaignDetails
  businessIds: string[]
  liveBusinesses?: LiveBusinessSnapshot[]
  editable: boolean
  onChange: (v: CampaignDetails) => void
}

const fieldClass =
  'h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25 disabled:bg-muted/40'

export function CampaignEditor({ value, businessIds, liveBusinesses = [], editable, onChange }: CampaignEditorProps) {
  const template = TEMPLATES.find((t) => t.id === value.templateId)
  const vars = template ? templateVariables(template.body).filter((v) => !AUTO_VARIABLES.includes(v)) : []
  const liveById = new Map(liveBusinesses.map((business) => [business.id, business]))
  // the preview walks the actual recipients, so each one's name and district can be checked before review
  const recipients = value.included.filter((id) => businessIds.includes(id))
  const [at, setAt] = useState(0)
  const sampleId = recipients[Math.min(at, Math.max(0, recipients.length - 1))] ?? businessIds[0]
  const sample = businessById.get(sampleId) ?? liveById.get(sampleId)

  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="tpl-title">
        <h2 id="tpl-title" className="font-semibold">
          نص الرسالة
        </h2>
        <p className="text-xs text-muted-foreground">يُرسل هذا النص عبر واتساب في رسالة معتمدة، مع اسم المنشأة.</p>
        {/* after review the choice is made: name it, instead of four greyed-out options and locked fields */}
        {!editable ? (
          <p className="text-sm">
            <span className="text-muted-foreground">الصيغة: </span>
            <span className="font-medium">{template ? `${template.name} (${template.kind})` : 'غير متاح'}</span>
          </p>
        ) : null}
        {editable ? <div role="radiogroup" aria-label="القوالب" className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const approved = t.approval === 'معتمد'
            const active = t.id === value.templateId
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!editable || !approved}
                onClick={() => onChange({ ...value, templateId: t.id })}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-start transition-colors disabled:cursor-not-allowed',
                  active ? 'border-primary bg-accent/40' : 'bg-background/50 enabled:hover:border-foreground/20',
                  !approved && 'opacity-60',
                )}
              >
                <span className="text-sm font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.kind} · {approved ? 'متاح للإرسال' : 'قيد المراجعة — غير متاح'}
                </span>
              </button>
            )
          })}
        </div> : null}

        {editable && vars.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {vars.map((v) => (
              <label key={v} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{v.replace(/_/g, ' ')}</span>
                <input
                  disabled={!editable}
                  required
                  aria-invalid={!value.variables[v]?.trim() || undefined}
                  aria-describedby={!value.variables[v]?.trim() ? `var-missing-${v}` : undefined}
                  value={value.variables[v] ?? ''}
                  onChange={(e) => onChange({ ...value, variables: { ...value.variables, [v]: e.target.value } })}
                  className={cn(fieldClass, !value.variables[v]?.trim() && 'border-destructive/60')}
                />
                {/* said in words, not by the red edge alone (WCAG 1.4.1) */}
                {!value.variables[v]?.trim() && <span id={`var-missing-${v}`} className="text-xs text-destructive">مطلوب قبل المراجعة</span>}
              </label>
            ))}
          </div>
        ) : null}

        {template ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">{sample ? `كما تصل إلى ${sample.name}` : 'معاينة الرسالة'}</p>
              {recipients.length > 1 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Button variant="ghost" size="sm" onClick={() => setAt((i) => (i - 1 + recipients.length) % recipients.length)} aria-label="المستلم السابق"><ChevronRight aria-hidden /></Button>
                  <span className="tabular-nums" aria-live="polite">{numberFormat.format(Math.min(at, recipients.length - 1) + 1)} من {numberFormat.format(recipients.length)}</span>
                  <Button variant="ghost" size="sm" onClick={() => setAt((i) => (i + 1) % recipients.length)} aria-label="المستلم التالي"><ChevronLeft aria-hidden /></Button>
                </div>
              )}
            </div>
            {/* the recipient's chat: an incoming bubble, line breaks kept, and any value still empty marked in the text */}
            <div className="max-w-md self-start whitespace-pre-line rounded-2xl rounded-ss-sm bg-accent px-3.5 py-2.5 text-sm leading-relaxed text-accent-foreground">
              {templateParts(template.body, value.variables, sample).map((part, index) => part.missing
                ? <mark key={index} className="rounded bg-destructive/10 px-0.5 text-destructive">{part.text}</mark>
                : <span key={index}>{part.text}</span>)}
            </div>
            {templateParts(template.body, value.variables, sample).some((part) => part.missing) && (
              <p className="text-xs text-destructive">ما بين القوسين لم يُملأ لهذا المستلم بعد، فأكمله قبل المراجعة.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="recip-title">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="recip-title" className="font-semibold">
              {editable ? 'المستلمون ومراجعة الأهلية' : 'المستلمون وحالة الإرسال'}
            </h2>
            <p className="text-xs text-muted-foreground">
              المؤهلون للإرسال عبر واتساب: {numberFormat.format(value.included.length)} من {numberFormat.format(businessIds.length)}. نستبعد من لا يملك رقم واتساب.
            </p>
          </div>
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
        </div>
        <ul className="flex flex-col divide-y">
          {businessIds.map((id) => {
            const mockBusiness = businessById.get(id)
            const liveBusiness = liveById.get(id)
            const b = mockBusiness ?? liveBusiness
            if (!b) return null
            const e = mockBusiness ? eligibility(mockBusiness) : { ok: Boolean(liveBusiness?.whatsapp), reason: 'لا توجد إشارة واتساب' }
            const checked = value.included.includes(id)
            if (!editable) {
              // after review the row says where this recipient stands, so a sent batch shows who got it
              const state = recipientState(e.ok ? undefined : e.reason, checked, Boolean(mockBusiness), value.delivery?.[id])
              const StateIcon = state.icon
              return (
                <li key={id} className="flex items-center gap-3 py-2">
                  <StateIcon className={cn('size-4 shrink-0', state.tone)} aria-hidden />
                  <span className={cn('min-w-0 flex-1 truncate text-sm', state.muted && 'text-muted-foreground')}>{b.name}</span>
                  <span className={cn('shrink-0 text-xs', state.tone)}>{state.label}</span>
                </li>
              )
            }
            return (
              <li key={id} className="flex items-center gap-3 py-2">
                <Checkbox
                  checked={e.ok && checked}
                  disabled={!editable || !e.ok}
                  aria-label={`تضمين ${b.name}`}
                  onCheckedChange={(v) =>
                    onChange({ ...value, included: v ? [...value.included, id] : value.included.filter((x) => x !== id) })
                  }
                />
                <span className={cn('min-w-0 flex-1 truncate text-sm', !e.ok && 'text-muted-foreground')}>{b.name}</span>
                {e.ok ? <span className="text-xs text-primary">مؤهل</span> : <span className="text-xs text-muted-foreground">{e.reason}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
