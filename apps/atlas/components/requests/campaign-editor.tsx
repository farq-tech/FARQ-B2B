'use client'

import { CheckCheck, CircleCheck, ChevronLeft, ChevronRight, CircleQuestionMark, Clock, Minus, ShieldCheck, CircleX, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { AUTO_VARIABLES, TEMPLATES, businessById, districtById } from '@/lib/mock-data'
import type { Business, CampaignDetails, LiveBusinessSnapshot } from '@/lib/types'
import { deliveryLabel, openingReplyFilter, replyFilterKey, replyGroups, wasSent, writeReplyFilter, type ReplyFilter, type ServerDelivery, type ServerElsewhere } from '@/lib/inbox-feed'
import { Chip, ChipCount } from '@/components/ui/chip'
import { counted, numberFormat } from '@/lib/insights-api'
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

/**
 * Where one recipient of a reviewed campaign stands: left out and why, or its send result, and once WhatsApp reports
 * on the message (`tracked`, from the account's feed) whether it arrived and was read. A message WhatsApp reports on
 * was sent, so it also settles a result this device could not confirm.
 */
export function recipientState(ineligible: string | undefined, included: boolean, demo: boolean, delivery: Delivery | undefined, tracked?: ServerDelivery['status']): { label: string; icon: LucideIcon; tone: string; muted?: boolean } {
  if (ineligible) return { label: ineligible, icon: Minus, tone: 'text-muted-foreground', muted: true }
  if (!included) return { label: 'استُبعدت عند المراجعة', icon: Minus, tone: 'text-muted-foreground', muted: true }
  if (demo) return { label: 'ليست من نتائج الدليل الحية', icon: Minus, tone: 'text-muted-foreground', muted: true }
  if (tracked === 'read') return { label: deliveryLabel('read'), icon: CheckCheck, tone: 'text-primary' }
  if (tracked === 'delivered') return { label: deliveryLabel('delivered'), icon: CheckCheck, tone: 'text-muted-foreground' }
  if (tracked === 'failed') return { label: deliveryLabel('failed'), icon: CircleX, tone: 'text-destructive' }
  if (tracked === 'sent') return { label: deliveryLabel('sent'), icon: CircleCheck, tone: 'text-primary' }
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
  /** What WhatsApp reported on each recipient's message (sent, delivered, read, failed), by recipient id. */
  tracked?: Record<string, ServerDelivery['status']>
  /** Each recipient's latest reply in the inbox (its message id), by recipient id. */
  replied?: Record<string, string>
  /** Recipients who answered another of the person's campaigns instead of this one, by recipient id. */
  elsewhere?: Record<string, ServerElsewhere>
  /** Starts a follow-up draft: `ids` ticked, `heldBack` listed unticked with their reason. It is reviewed and confirmed
   * like any campaign; nothing is sent here. */
  onFollowUp?: (ids: string[], heldBack: string[]) => void
  /** The request's id: its recipient filter is kept for this tab under it, so the inbox and back keep the view. */
  filterKey?: string
}


const REPLY_FILTERS: { id: ReplyFilter; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'waiting', label: 'لم تردّ' },
  { id: 'replied', label: 'ردّت' },
]

export function CampaignEditor({ value, businessIds, liveBusinesses = [], editable, onChange, tracked, replied, elsewhere, onFollowUp, filterKey }: CampaignEditorProps) {
  // after sending: who has not answered yet, for a follow-up the person decides on (nothing is sent from here). The
  // choice is in the address (?replies=waiting|replied), so a link or a reload opens the same view.
  const [replyFilter, setReplyFilterState] = useState<ReplyFilter>('all')
  const writeAddress = (filter: ReplyFilter) => {
    const search = writeReplyFilter(window.location.search, filter)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
  }
  // the address wins; a bare address (from the inbox, the list, Back) reopens the filter last used on this request
  useEffect(() => {
    let remembered: string | null = null
    try { remembered = filterKey ? window.sessionStorage.getItem(replyFilterKey(filterKey)) : null } catch { /* storage blocked */ }
    const opening = openingReplyFilter(window.location.search, remembered)
    setReplyFilterState(opening)
    if (opening !== 'all' && !new URLSearchParams(window.location.search).has('replies')) writeAddress(opening)
    // a filter opened from a link is the one to come back to as well
    try { if (filterKey) window.sessionStorage.setItem(replyFilterKey(filterKey), opening) } catch { /* storage blocked */ }
  }, [filterKey])
  const setReplyFilter = (filter: ReplyFilter) => {
    setReplyFilterState(filter)
    writeAddress(filter)
    try { if (filterKey) window.sessionStorage.setItem(replyFilterKey(filterKey), filter) } catch { /* storage blocked */ }
  }
  const sentTo = (id: string) => wasSent(id, tracked, value.delivery)
  const replyGroupsFor = replyGroups(businessIds, sentTo, replied)
  const followUpIds = replyGroupsFor.waiting.filter((id) => !elsewhere?.[id])
  const elsewhereWaiting = replyGroupsFor.waiting.length - followUpIds.length
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
                <Input
                  disabled={!editable}
                  required
                  aria-invalid={!value.variables[v]?.trim() || undefined}
                  aria-describedby={!value.variables[v]?.trim() ? `var-missing-${v}` : undefined}
                  value={value.variables[v] ?? ''}
                  onChange={(e) => onChange({ ...value, variables: { ...value.variables, [v]: e.target.value } })}
                  className={cn('bg-background', !value.variables[v]?.trim() && 'border-destructive/60')}
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
        {!editable && replyGroupsFor.all.some((id) => sentTo(id)) ? (
          <div role="group" aria-label="تصفية المستلمين حسب الرد" className="flex flex-wrap gap-1.5">
            {REPLY_FILTERS.map((f) => (
              <Chip key={f.id} active={replyFilter === f.id} onClick={() => setReplyFilter(f.id)} className="px-2.5">
                {f.label}
                <ChipCount value={replyGroupsFor[f.id].length} active={replyFilter === f.id} />
              </Chip>
            ))}
          </div>
        ) : null}
        {/* a follow-up for those who have not answered: a new draft, reviewed and confirmed like any campaign. A recipient who
            answered another of the person's campaigns is left out of it (the person sees why on its row). */}
        {!editable && onFollowUp && followUpIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onFollowUp(followUpIds, replyGroupsFor.waiting.filter((id) => elsewhere?.[id]))}>
              <MessageSquarePlus data-icon="inline-start" />جهّز حملة متابعة لمن لم يردّ ({numberFormat.format(followUpIds.length)})
            </Button>
            <span className="text-xs text-muted-foreground">
              مسودة جديدة تراجعها وتؤكد إرسالها بنفسك.{elsewhereWaiting ? ` ${counted(elsewhereWaiting, 'business')} ردّت على حملة أخرى تظهر فيها غير محددة، ولك أن تضيفها.` : ''}
            </span>
          </div>
        ) : null}
        {!editable && replyFilter !== 'all' && !replyGroupsFor[replyFilter].length ? (
          <p className="text-sm text-muted-foreground">{replyFilter === 'waiting' ? 'كل من وصلتهم الرسالة ردّوا.' : 'لم يردّ أحد بعد.'}</p>
        ) : null}
        <ul className="flex flex-col divide-y">
          {businessIds.filter((id) => editable || replyFilter === 'all' || replyGroupsFor[replyFilter].includes(id)).map((id) => {
            const mockBusiness = businessById.get(id)
            const liveBusiness = liveById.get(id)
            const b = mockBusiness ?? liveBusiness
            if (!b) return null
            const e = mockBusiness ? eligibility(mockBusiness) : { ok: Boolean(liveBusiness?.whatsapp), reason: 'لا توجد إشارة واتساب' }
            const checked = value.included.includes(id)
            if (!editable) {
              // after review the row says where this recipient stands, so a sent batch shows who got it
              const state = recipientState(e.ok ? undefined : e.reason, checked, Boolean(mockBusiness), value.delivery?.[id], tracked?.[id])
              const StateIcon = state.icon
              return (
                <li key={id} className="flex items-center gap-3 py-2">
                  <StateIcon className={cn('size-4 shrink-0', state.tone)} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', state.muted && 'text-muted-foreground')}>{b.name}</span>
                    {/* the facts the business list below used to repeat, now that this is the one list */}
                    <span className="block truncate text-xs text-muted-foreground">
                      {(mockBusiness ? [mockBusiness.role, districtById.get(mockBusiness.districtId)?.name] : [liveBusiness?.category, liveBusiness?.district]).filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className={cn('text-xs', state.tone)}>{state.label}</span>
                    {/* whether the business answered: its reply one tap away, or «لا رد بعد» once the message went out */}
                    {replied?.[id] ? (
                      <Link href={`/inbox?m=${encodeURIComponent(replied[id])}`} className="rounded text-xs font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">ردّت · اقرأ الرد</Link>
                    ) : elsewhere?.[id] ? (
                      // this number answered another of the person's campaigns: not a silence to chase
                      <Link href={`/inbox?m=${encodeURIComponent(elsewhere[id].messageId)}`} className="rounded text-xs font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">ردّت على حملة أخرى</Link>
                    ) : sentTo(id) ? (
                      <span className="text-xs text-muted-foreground">لا رد بعد</span>
                    ) : null}
                  </span>
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
                {/* a follow-up leaves out who answered another campaign; the reason stays beside the box until it is ticked */}
                {e.ok && !checked && value.heldBack?.[id] === 'replied_elsewhere'
                  ? <span className="text-xs text-muted-foreground">ردّت على حملة أخرى · غير محددة</span>
                  : e.ok ? <span className="text-xs text-primary">مؤهل</span> : <span className="text-xs text-muted-foreground">{e.reason}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
