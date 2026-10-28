'use client'

import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
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
      <PopoverTrigger className={cn('group inline-flex cursor-help items-center gap-1 rounded-md text-start underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/60', className)} aria-label={`كيف حُسب: ${title}`}>
        {children}
        {/* the «i» tells people a figure opens how it was worked out */}
        <Info className="size-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary" aria-hidden />
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
