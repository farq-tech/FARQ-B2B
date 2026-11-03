'use client'

import { ArrowLeft, Check } from 'lucide-react'
import { CopyLinkButton } from '@/components/shared/copy-link'
import { Chip } from '@/components/ui/chip'
import { numberFormat } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import type { Decision, DecisionAction, SitesCompared } from './journey-logic'
import type { SiteComparison } from './tools/overlay'
import type { JourneyStep, Lens, ToolId } from './lenses'

/**
 * «ابدأ من …»: a step that takes a district, opened with none picked, offers the district an earlier step of the
 * journey put first, so the answer just seen is one tap from the next question (no dead end on «اختر حياً»).
 */
export function StartFrom({ name, from, onPick }: { name: string; from: JourneyStep; onPick: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/40 bg-primary/5 p-3 text-sm">
      <span className="min-w-0 flex-1">ابدأ من <span className="font-semibold">{name}</span>، الأول في «{from.label}»</span>
      <Chip onClick={onPick} className="border-primary/50 font-semibold text-primary">اعرض {name}</Chip>
    </div>
  )
}

/**
 * «قارن مباشرة»: the comparison step with fewer than two districts picked offers the two its ranking puts first (or the
 * picked one and the top other), as one tap, instead of asking for two taps on the map.
 */
export function CompareStart({ names, why, onPick }: { names: [string, string]; why: string; onPick: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/40 bg-primary/5 p-3 text-sm">
      <span className="min-w-0 flex-1">أو قارن مباشرة: <span className="font-semibold">{names[0]}</span> و<span className="font-semibold">{names[1]}</span>، {why}</span>
      <Chip onClick={onPick} className="border-primary/50 font-semibold text-primary">قارن بينهما</Chip>
    </div>
  )
}

/**
 * The shop owner's candidate sites side by side, as «قارن المواقع» scored them (attractionScores, the same numbers as
 * its table): the score out of 100 and its three factors per site, the best first. A factor not measured reads «غير متاح».
 */
function SitesSideBySide({ compared }: { compared: SitesCompared }) {
  const figure = (value: number | null, unit = '') => (value == null ? 'غير متاح' : `${numberFormat.format(Math.round(value))}${unit}`)
  const rows: { label: string; value: (site: SiteComparison) => string }[] = [
    { label: 'الجاذبية', value: (site) => (site.score == null ? 'غير متاح' : `${numberFormat.format(site.score)}/100`) },
    { label: `السكان في ${compared.reach}`, value: (site) => figure(site.audience) },
    { label: compared.byIncome ? 'دخل الحي' : 'حصة الفلل', value: (site) => figure(site.spending, compared.byIncome ? ' ريال' : '%') },
    { label: 'منشآت لكل كم²', value: (site) => (site.density == null ? 'غير متاح' : numberFormat.format(Math.round(site.density * 10) / 10)) },
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">المواقع المرشحة جنباً إلى جنب</caption>
        <thead>
          <tr>
            <th scope="col" className="py-1 text-start font-normal text-muted-foreground"><span className="sr-only">الرقم</span></th>
            {compared.sites.map((site, index) => (
              <th key={site.label} scope="col" className={cn('px-1.5 py-1 text-start', index === 0 && 'text-primary')}>
                الموقع {site.label}{site.district && <span className="block text-xs font-normal text-muted-foreground">{site.district}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="py-1 pe-2 text-start font-normal text-muted-foreground">{row.label}</th>
              {compared.sites.map((site, index) => <td key={site.label} className={cn('px-1.5 py-1 tabular-nums', index === 0 && 'font-semibold')}>{row.value(site)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * «خلاصة رحلتك» at the journey's last step: each step with its one-line answer as the step itself gave it (never
 * recomputed here), a ✓ where it answered, and a tap to open a step not done yet. What the customer carries into the
 * decision is on one card; the link reopens the same view inside the platform (no export).
 */
export function JourneySummary({ lens, cityName, tool, done, answers, picked, activity, decision, onAct, onOpen }: {
  lens: Lens
  cityName: string
  /** The open step: its row is not a button. */
  tool: ToolId
  done: readonly ToolId[]
  /** The one-line answer each step posted (its peek line), by tool. */
  answers: Partial<Record<ToolId, string>>
  /** The picked districts' names, said once at the top. */
  picked: string[]
  /** The studied activity, when the customer chose one (never the default nobody picked). */
  activity: string | null
  /** What the journey points to and what to do with it (journey-logic.ts decisionFor); no pick, no decision block. */
  decision?: Decision | null
  /** Runs a non-link action of the decision (open the businesses, open a step on a district). */
  onAct?: (action: DecisionAction) => void
  onOpen: (tool: ToolId) => void
}) {
  const answered = lens.steps.filter((step) => done.includes(step.tool)).length
  const context = [activity ? `نشاطك «${activity}»` : null, picked.length ? (picked.length === 1 ? `الحي ${picked[0]}` : `الأحياء ${picked.join('، ')}`) : null].filter(Boolean).join(' · ')
  return (
    <section aria-labelledby="journey-summary" className="flex flex-col gap-3 rounded-2xl border border-primary/40 bg-card p-4">
      <div>
        <h3 id="journey-summary" className="text-base font-bold">خلاصة رحلتك في {cityName}</h3>
        <p className="text-sm text-muted-foreground">
          {answered === lens.steps.length ? 'أكملت الخطوات كلها' : `أكملت ${numberFormat.format(answered)} من ${numberFormat.format(lens.steps.length)} خطوات`}{context ? ` · ${context}` : ''}
        </p>
      </div>
      {/* the decision first: what the steps pointed to, and its actions (each through the flow that already exists:
          the businesses list makes the quote request or the campaign after review; the other pages take a link) */}
      {decision?.pick && (
        <div className="flex flex-col gap-2 rounded-xl bg-primary/5 p-3">
          <p className="text-sm text-muted-foreground">{decision.title}</p>
          <p className="text-base font-bold">{decision.pick}</p>
          {decision.sites && <SitesSideBySide compared={decision.sites} />}
          {decision.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {decision.actions.map((action) => action.kind === 'link'
                ? <Link key={action.label} href={action.href} onClick={() => onAct?.(action)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-primary/50 bg-card px-3 text-sm font-semibold text-primary hover:bg-primary/10">{action.label}<ArrowLeft className="size-4" aria-hidden /></Link>
                : <Chip key={action.label} onClick={() => onAct?.(action)} className="h-auto min-h-9 border-primary/50 py-1.5 text-start font-semibold whitespace-normal text-primary">{action.label}</Chip>)}
            </div>
          )}
          <p className="text-xs text-muted-foreground">أطلس يجمع الأرقام ولا يقرر عنك. لا يُرسل شيء قبل مراجعتك.</p>
        </div>
      )}
      <ol className="flex flex-col gap-1.5">
        {lens.steps.map((step, index) => {
          const ok = done.includes(step.tool)
          const line = answers[step.tool] ?? (ok ? 'فيها نتيجة' : step.ask)
          const body = (
            <>
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold', ok ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {ok ? <><Check className="size-3.5" strokeWidth={3} aria-hidden /><span className="sr-only">تمت: </span></> : numberFormat.format(index + 1)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">{step.tool === tool ? step.label : <><span className="sr-only">افتح الخطوة: </span>{step.label}</>}</span>
                <span className={cn('text-sm', ok ? 'text-foreground' : 'text-muted-foreground')}>{line}</span>
              </span>
              {step.tool !== tool && <ArrowLeft className="mt-1 size-4 shrink-0 text-primary" aria-hidden />}
            </>
          )
          return (
            <li key={step.tool}>
              {step.tool === tool
                ? <div className="flex items-start gap-2.5 rounded-xl bg-muted/40 px-2.5 py-2">{body}</div>
                : (
                  <button onClick={() => onOpen(step.tool)}
                    className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-start outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60">
                    {body}
                  </button>
                )}
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <CopyLinkButton label="احفظ رابط رحلتك" className="shadow-none" />
        <span className="text-xs text-muted-foreground">يفتح الخريطة على ما تراه الآن، لك أو لفريقك.</span>
      </div>
    </section>
  )
}
