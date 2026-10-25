'use client'

import { ShieldCheck } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { AUTO_VARIABLES, TEMPLATES, businessById, districtById } from '@/lib/mock-data'
import type { Business, CampaignDetails, LiveBusinessSnapshot } from '@/lib/types'
import { cn } from '@/lib/utils'

export function templateVariables(body: string) {
  return Array.from(new Set(Array.from(body.matchAll(/\{\{(.+?)\}\}/g), (m) => m[1])))
}

type TemplateRecipient = Pick<Business, 'name'> & { districtId?: string; district?: string }

export function renderTemplate(body: string, vars: Record<string, string>, b?: TemplateRecipient) {
  return body.replace(/\{\{(.+?)\}\}/g, (_, key: string) => {
    if (key === 'اسم_المنشأة') return b?.name ?? '[اسم المنشأة]'
    if (key === 'الحي') return b?.district ?? (b?.districtId ? districtById.get(b.districtId)?.name : undefined) ?? '[الحي]'
    return vars[key]?.trim() || `[${key.replace(/_/g, ' ')}]`
  })
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

interface CampaignEditorProps {
  value: CampaignDetails
  businessIds: string[]
  liveBusinesses?: LiveBusinessSnapshot[]
  editable: boolean
  onChange: (v: CampaignDetails) => void
}

const fieldClass =
  'h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25 disabled:bg-muted/40'

export function CampaignEditor({ value, businessIds, liveBusinesses = [], editable, onChange }: CampaignEditorProps) {
  const template = TEMPLATES.find((t) => t.id === value.templateId)
  const vars = template ? templateVariables(template.body).filter((v) => !AUTO_VARIABLES.includes(v)) : []
  const liveById = new Map(liveBusinesses.map((business) => [business.id, business]))
  const sampleId = value.included.find((id) => businessIds.includes(id)) ?? businessIds[0]
  const sample = businessById.get(sampleId) ?? liveById.get(sampleId)

  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="tpl-title">
        <h2 id="tpl-title" className="font-semibold">
          نص الرسالة
        </h2>
        <p className="text-xs text-muted-foreground">يُرسل هذا النص داخل قالب واتساب السحابي المعتمد، مع اسم المنشأة.</p>
        <div role="radiogroup" aria-label="القوالب" className="grid gap-2 sm:grid-cols-2">
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
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-right transition-colors disabled:cursor-not-allowed',
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
        </div>

        {vars.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {vars.map((v) => (
              <label key={v} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{v.replace(/_/g, ' ')}</span>
                <input
                  disabled={!editable}
                  value={value.variables[v] ?? ''}
                  onChange={(e) => onChange({ ...value, variables: { ...value.variables, [v]: e.target.value } })}
                  className={cn(fieldClass, !value.variables[v]?.trim() && 'border-destructive/60')}
                />
              </label>
            ))}
          </div>
        ) : null}

        {template ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">معاينة {sample ? `لـ ${sample.name}` : ''}</p>
            <div className="max-w-md self-start rounded-2xl rounded-tr-sm bg-accent px-3.5 py-2.5 text-sm leading-relaxed text-accent-foreground">
              {renderTemplate(template.body, value.variables, sample)}
            </div>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="recip-title">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="recip-title" className="font-semibold">
              المستلمون ومراجعة الأهلية
            </h2>
            <p className="text-xs text-muted-foreground">
              {value.included.length} مؤهلون للإرسال السحابي من {businessIds.length}. نستبعد من لا يملك رقم واتساب.
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
                {e.ok ? <span className="text-[11px] text-primary">مؤهل</span> : <span className="text-[11px] text-muted-foreground">{e.reason}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
