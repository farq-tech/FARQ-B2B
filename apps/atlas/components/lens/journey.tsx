'use client'

import { ArrowLeft, Check } from 'lucide-react'
import { CopyLinkButton } from '@/components/shared/copy-link'
import { Chip } from '@/components/ui/chip'
import { numberFormat } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
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
 * «خلاصة رحلتك» at the journey's last step: each step with its one-line answer as the step itself gave it (never
 * recomputed here), a ✓ where it answered, and a tap to open a step not done yet. What the customer carries into the
 * decision is on one card; the link reopens the same view inside the platform (no export).
 */
export function JourneySummary({ lens, cityName, tool, done, answers, picked, activity, onOpen }: {
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
