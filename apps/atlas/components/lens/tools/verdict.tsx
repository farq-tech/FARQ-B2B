'use client'

import type { ReactNode } from 'react'
import { CircleAlert, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VerdictText } from './tool-answers'

/**
 * The top of every tool's answer, in one shape: the decision in one bold line, the one or two figures behind it, what
 * makes it less sure (thin or partial data, said, never hidden), and a slot for the next step (`next`: a link to the
 * request, price or listing surfaces, given by the map shell). The list under it is the evidence; this is the answer.
 * The words come from tool-answers.ts, where they are tested.
 */
export function Verdict({ verdict, next, className }: { verdict: VerdictText | null; next?: ReactNode; className?: string }) {
  if (!verdict) return null
  return (
    <div role="status" aria-label="الخلاصة" className={cn('flex flex-col gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5', className)}>
      <p className="flex items-start gap-1.5 text-base font-bold leading-snug">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>{verdict.lead}</span>
      </p>
      {verdict.why.map((line) => <p key={line} className="ps-5.5 text-sm leading-6 text-muted-foreground tabular-nums">{line}</p>)}
      {verdict.caution && (
        <p className="flex items-start gap-1.5 ps-0.5 text-sm leading-6 text-warning">
          <CircleAlert className="mt-1 size-3.5 shrink-0" aria-hidden />
          <span>{verdict.caution}</span>
        </p>
      )}
      {next && <div className="flex flex-wrap gap-2 ps-5.5 pt-0.5">{next}</div>}
    </div>
  )
}
