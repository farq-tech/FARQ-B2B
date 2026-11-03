'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { counted, numberFormat } from '@/lib/insights-api'
import { cn } from '@/lib/utils'

const ROW = 'flex min-w-0 flex-1 items-center gap-2 py-2 text-start'

/**
 * One line of a tool's result list (a district, a street, a chain, a listing): what it is on the start side, its
 * figure on the end side, the same spacing and truncation in every tool. Inside an <ol className="divide-y">.
 *
 * With `onClick` the line is one button. An interactive figure (an Explained card) cannot sit inside a button, so it
 * goes in `aside`, beside the button. `active` marks the line the map is showing, for sight and for screen readers.
 * Every digit in the line is tabular, so figures stack in a column down the list.
 * `onHover` tells the map which line the pointer or keyboard focus is on, so it can outline that district.
 */
export function ResultRow({ leading, title, sub, value, valueSub, aside, onClick, onHover, active = false, disabled = false, id }: {
  leading?: ReactNode
  title: ReactNode
  sub?: ReactNode
  /** the row's figure, already formatted through numberFormat */
  value?: ReactNode
  /** a smaller line under the figure */
  valueSub?: ReactNode
  aside?: ReactNode
  onClick?: () => void
  onHover?: (on: boolean) => void
  active?: boolean
  disabled?: boolean
  id?: string
}) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {sub != null && sub !== false && <span className="block truncate text-sm text-muted-foreground">{sub}</span>}
      </span>
      {(value != null || valueSub != null) && (
        <span className="shrink-0 text-end">
          {value != null && <span className="block font-bold">{value}</span>}
          {valueSub != null && <span className="block text-sm text-muted-foreground">{valueSub}</span>}
        </span>
      )}
    </>
  )
  return (
    <li id={id} aria-current={active ? 'true' : undefined}
      onPointerEnter={onHover && (() => onHover(true))} onPointerLeave={onHover && (() => onHover(false))}
      onFocus={onHover && (() => onHover(true))} onBlur={onHover && (() => onHover(false))}
      className={cn('flex items-center gap-2 tabular-nums', active && 'text-primary')}>
      {onClick ? (
        <button type="button" onClick={onClick} disabled={disabled}
          className={cn(ROW, 'rounded-md outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default disabled:hover:text-inherit')}>
          {body}
        </button>
      ) : <div className={ROW}>{body}</div>}
      {aside != null && <span className="shrink-0 text-end">{aside}</span>}
    </li>
  )
}

const WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-2/3', 'w-1/3']

/** A result list that is loading, drawn with ResultRow's own parts so nothing moves when the rows arrive. */
export function ResultRowsSkeleton({ rows = 5, leading, sub = false, value = true, valueSub = false, label, className }: {
  rows?: number
  leading?: 'thumb' | 'swatch' | 'rank'
  sub?: boolean
  value?: boolean
  valueSub?: boolean
  label?: string
  className?: string
}) {
  return (
    <SkeletonStatus label={label} className={cn('flex flex-col divide-y', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-2 py-2">
          {leading === 'thumb' && <Skeleton className="size-14 shrink-0 rounded-lg" />}
          {leading === 'swatch' && <Skeleton className="h-3 w-5 shrink-0 rounded-sm" />}
          {leading === 'rank' && <Skeleton className="h-4 w-4 shrink-0" />}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-5', WIDTHS[index % WIDTHS.length])} />
            {sub && <Skeleton className="h-4 w-1/3" />}
          </div>
          {(value || valueSub) && (
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {value && <Skeleton className="h-5 w-12" />}
              {valueSub && <Skeleton className="h-4 w-16" />}
            </div>
          )}
        </div>
      ))}
    </SkeletonStatus>
  )
}

/** How many rows a long list shows: `step` at first, `step` more on each «اعرض المزيد», back to `step` when `reset` changes. */
export function useShowMore(step: number, reset: string) {
  const [limit, setLimit] = useState(step)
  useEffect(() => { setLimit(step) }, [step, reset])
  return [limit, () => setLimit((current) => current + step)] as const
}

/**
 * Under a list that shows part of what it ranks: «أعلى 30 من 120 حياً», so a cut list never reads as the whole city,
 * and «اعرض المزيد» while there is more to show. Nothing when every row is already shown.
 */
export function MoreRows({ shown, total, noun, lead = 'أعلى', suffix = '', canMore, onMore }: {
  shown: number
  total: number
  noun: Parameters<typeof counted>[1]
  /** the word before the figure: «أعلى» for a ranking, «أقرب» for a list by distance */
  lead?: string
  /** words after the total when the list ranks only part of what the service counted («على الخريطة») */
  suffix?: string
  /** whether more rows can be shown (defaults to shown < total) */
  canMore?: boolean
  onMore: () => void
}) {
  if (shown >= total) return null
  return (
    <div className="flex items-center justify-between gap-2 pt-1.5 text-sm tabular-nums text-muted-foreground">
      <span>{lead} {numberFormat.format(shown)} من {counted(total, noun)}{suffix}</span>
      {(canMore ?? shown < total) && (
        <button type="button" onClick={onMore} className="rounded-md font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">اعرض المزيد</button>
      )}
    </div>
  )
}
