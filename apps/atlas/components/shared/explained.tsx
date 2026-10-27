'use client'

import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** A figure that opens a short «how it was worked out» card when tapped (lib/explanations.ts). */
export function Explained({ title, lines, children, className }: {
  title: string
  lines: string[]
  children: ReactNode
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger className={cn('cursor-help text-start underline decoration-dotted decoration-muted-foreground/50 underline-offset-4', className)} aria-label={`كيف حُسب: ${title}`}>
        {children}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80">
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
