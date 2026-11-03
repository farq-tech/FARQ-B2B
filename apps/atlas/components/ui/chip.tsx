import type { ComponentProps } from 'react'
import { numberFormat } from '@/lib/insights-api'
import { cn } from '@/lib/utils'

/** A filter or choice chip (control radius) (the Airbnb chip row): outlined, olive and bold when on. */
export function Chip({ active, className, ...props }: ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={props.role === 'tab' ? undefined : active}
      aria-selected={props.role === 'tab' ? active : undefined}
      className={cn(
        'inline-flex h-9 pointer-coarse:min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3.5 text-sm whitespace-nowrap transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        // the olive tint is laid over an opaque card: a bare 10% tint let whatever lies under the chip (map labels on the
        // phone's floating row) show through its text, which then read doubled
        active ? 'border-primary bg-card bg-linear-to-r from-primary/10 to-primary/10 font-semibold text-primary' : 'bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** The count beside a chip's label. */
export function ChipCount({ value, active }: { value: number; active?: boolean }) {
  return <span className={cn('rounded-md px-1.5 text-xs tabular-nums', active ? 'bg-primary/15' : 'bg-muted')}>{numberFormat.format(value)}</span>
}
