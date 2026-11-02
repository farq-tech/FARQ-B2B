'use client'

import type { ReactNode } from 'react'
import { Explained } from '@/components/shared/explained'
import { Unavailable } from '@/components/shared/unavailable'
import { numberFormat, percent } from '@/lib/insights-api'
import { cn } from '@/lib/utils'

/** The muted box a figure sits in: a caption label over its value. */
export function StatTile({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl bg-muted/60 px-3 py-2.5', className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

/**
 * One figure with its «how it was worked out» card. `value` is already formatted (numberFormat); null reads
 * «غير متاح», never 0.
 */
export function Stat({ label, value, explain }: { label: string; value: string | null; explain: string[] }) {
  return (
    <StatTile label={label}>
      <Explained title={label} lines={explain} className={cn('mt-0.5 font-bold tabular-nums', value == null ? 'text-sm text-muted-foreground' : 'text-xl')}>
        {value ?? <Unavailable className="font-bold" />}
      </Explained>
    </StatTile>
  )
}

export type SplitPart = { label: string; value: number | null; color: string }

/** Two parts of one whole (women and men, Saudis and others) as one bar, each part with its number and share. */
export function Split({ title, left, right, explain }: { title: string; left: SplitPart; right: SplitPart; explain: string[] }) {
  const total = left.value != null && right.value != null ? left.value + right.value : null
  if (!total) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{title}</span>
        <Explained title={title} lines={explain} className="text-muted-foreground"><Unavailable className="font-normal" /></Explained>
      </div>
    )
  }
  const share = (value: number) => Math.round((100 * value) / total)
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{title}</p>
      <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden>
        <span style={{ width: `${share(left.value!)}%`, background: left.color }} />
        <span style={{ width: `${100 - share(left.value!)}%`, background: right.color }} />
      </div>
      <div className="flex justify-between text-sm">
        {[left, right].map((part) => (
          <Explained key={part.label} title={part.label} lines={explain} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: part.color }} aria-hidden />
            <span className="text-muted-foreground">{part.label}</span>
            <span className="font-bold tabular-nums">{numberFormat.format(Math.round(part.value!))}</span>
            <span className="text-xs text-muted-foreground">{percent(share(part.value!))}</span>
          </Explained>
        ))}
      </div>
    </div>
  )
}
