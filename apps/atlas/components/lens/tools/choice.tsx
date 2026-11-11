'use client'

import type { ReactNode } from 'react'
import { Hourglass } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One question's answers as pressed buttons, the same in every lens tool (it was written out seven times with seven
 * slightly different sizes). `label` names the question for screen readers («الجنس», «نطاق كل موقع»…).
 * - solid: a row of equal buttons, the pressed one filled (a filter: sex, income, the order of a list);
 * - outline: the same row, the pressed one outlined (a view of one result, beside a solid filter row);
 * - chip: wrapping pills, the pressed one outlined (property types, rent periods), with an optional icon.
 * `className` lays the buttons out (a grid of three, a wrap), the buttons keep their own look.
 */
export function Choice<T extends string | number>({ label, value, options, onChange, variant = 'solid', size = 'sm', className }: {
  label: string
  value: T
  options: { id: T; label: ReactNode; icon?: ReactNode }[]
  onChange: (id: T) => void
  variant?: 'solid' | 'outline' | 'chip'
  size?: 'sm' | 'base'
  className?: string
}) {
  const chip = variant === 'chip'
  return (
    <div role="group" aria-label={label} className={cn(chip ? 'flex flex-wrap gap-1.5' : 'flex gap-1.5', className)}>
      {options.map((option) => {
        const on = value === option.id
        return (
          <button key={String(option.id)} type="button" onClick={() => onChange(option.id)} aria-pressed={on}
            className={cn(
              'outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              size === 'base' ? 'text-base' : 'text-sm',
              chip
                ? cn('inline-flex items-center gap-1.5 rounded-full border py-1', option.icon ? 'ps-1.5 pe-3' : 'px-3 py-1.5', on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:border-primary hover:text-foreground')
                : cn('min-h-10 flex-1 rounded-lg border px-2 py-2', variant === 'solid'
                  ? (on ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')
                  : (on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'font-semibold hover:border-primary')),
            )}>
            {option.icon}{option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The line a slow request shows under its skeleton («ما زلنا نحسب…»), so a long wait reads as work, not as a page that
 * stopped. `children` says what takes the time, in the tool's own words.
 */
export function StillWorking({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Hourglass className="size-4 shrink-0 animate-pulse text-primary" aria-hidden />
      <span>ما زلنا نحسب. {children}</span>
    </p>
  )
}
