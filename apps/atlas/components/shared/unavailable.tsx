'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** The one wording for a figure the data does not have (CLAUDE.md: never 0, never an estimate). */
export const UNAVAILABLE = 'غير متاح'

/**
 * An inline «غير متاح» in place of a missing number: muted, smaller than the figure it stands for. With a `reason`
 * it opens a short card on tap, click, Enter or Space (a title attribute alone never shows on a phone). Without one
 * it is a plain span, so it can sit inside another trigger such as Explained.
 */
export function Unavailable({ reason, className }: { reason?: string; className?: string }) {
  const look = cn('text-sm font-medium text-muted-foreground', className)
  if (!reason) return <span className={look}>{UNAVAILABLE}</span>
  return (
    <Popover>
      <PopoverTrigger aria-label={`${UNAVAILABLE}: ${reason}`}
        className={cn(look, 'cursor-help touch-manipulation rounded-md underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
        {UNAVAILABLE}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64">
        <p className="text-sm leading-7 text-muted-foreground">{reason}</p>
      </PopoverContent>
    </Popover>
  )
}
