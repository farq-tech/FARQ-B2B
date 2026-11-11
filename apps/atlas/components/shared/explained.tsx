'use client'

import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * A figure that opens a short «how it was worked out» card (lib/explanations.ts). It is a click popover, not a hover
 * tooltip: a tap opens it on a phone, Enter or Space from the keyboard, and a second tap, Escape or a tap outside
 * closes it. While open the «i» stays olive, since a touch screen has no hover to show it. Find a trigger with
 * `[data-explained]`.
 */
export function Explained({ title, lines, children, className }: {
  title: string
  lines: string[]
  children: ReactNode
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger className={cn('group inline-flex cursor-help touch-manipulation items-center gap-1 rounded-md text-start underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring', className)} data-explained="">
        {children}
        {/* the name a screen reader hears starts with what is on screen (the figure), then says it opens how it was
            worked out: an aria-label in its place hid the figure itself (WCAG 2.5.3, label in name) */}
        <span className="sr-only">، كيف حُسب: {title}</span>
        {/* the «i» tells people a figure opens how it was worked out */}
        <Info className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary group-focus-visible:text-primary group-data-[popup-open]:text-primary" aria-hidden />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-[min(20rem,calc(100vw-2rem))]">
        <p className="text-base font-semibold">{title}</p>
        {lines.map((line) => (
          // a worked sum («22,600 ÷ 1,784 = 13») reads left to right like any equation, inside the Arabic card
          /^[\d,.\s÷×+\-=%]+$/.test(line)
            ? <p key={line} dir="ltr" className="text-end text-base font-semibold tabular-nums text-foreground">{line}</p>
            : <p key={line} className="text-sm leading-7 text-muted-foreground">{line}</p>
        ))}
      </PopoverContent>
    </Popover>
  )
}
