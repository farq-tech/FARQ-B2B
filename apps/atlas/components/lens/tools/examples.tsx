'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Icon3D } from '@/components/shared/icon-3d'
import { cn } from '@/lib/utils'

/**
 * The example activities under a tool's activity box, as one row of chips. Once an activity is chosen (`collapse`),
 * they fold to the one being studied and a «أمثلة أخرى» chip, so the answer moves up the panel instead of sitting
 * under a block of suggestions the visitor no longer needs; the chip opens them again. They open again on their own
 * when the activity is cleared.
 */
export function Examples({ examples, active, collapse, onPick }: {
  examples: string[]
  /** The example being studied, marked pressed; null when the activity is not one of them. */
  active: string | null
  collapse: boolean
  onPick: (example: string) => void
}) {
  const [open, setOpen] = useState(false)
  // a new choice folds them again; the visitor's «أمثلة أخرى» holds only until the next one
  useEffect(() => { setOpen(false) }, [active, collapse])
  const folded = collapse && !open
  const shown = folded ? examples.filter((example) => example === active) : examples
  return (
    <div role="group" aria-label="أمثلة" className="flex flex-wrap gap-2">
      {shown.map((example) => {
        const on = example === active
        return (
          <button key={example} type="button" onClick={() => onPick(example)} aria-pressed={on}
            className={cn('inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm', on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:border-primary hover:text-primary')}>
            <Icon3D activity={example} />{example}
          </button>
        )
      })}
      {folded && (
        <button type="button" onClick={() => setOpen(true)} aria-expanded={false}
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:border-primary hover:text-primary">
          أمثلة أخرى ({examples.length - shown.length})<ChevronDown className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
