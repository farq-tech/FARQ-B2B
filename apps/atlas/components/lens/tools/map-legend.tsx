'use client'

import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, Layers } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** The key to the colours a tool paints on the map, from one end of its scale to the other. A tool hands it over
 * in its overlay, and the map shows it in its corner, where the colours are. `title` names what the colours show;
 * when a tool leaves it out, the map titles it with the open step. */
export type Legend = {
  from: string
  to: string
  shades: string[]
  extra?: { color: string; label: string }
  title?: string
  /** How the colours were given, from lib/explanations.ts; the scale then opens it on a tap, like any figure. */
  explain?: string[]
}

/** A short title over the key, so the corner reads «what is coloured» before «from what to what». */
export function LegendTitle({ children }: { children: ReactNode }) {
  return <p className="text-sm font-bold text-foreground">{children}</p>
}

export function MapLegend({ from, to, shades, extra, title, explain }: Legend) {
  const scale = (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{from}</span>
      <span className="flex gap-0.5" aria-hidden>{shades.map((shade) => <span key={shade} className="h-4 w-7 rounded-sm" style={{ background: shade }} />)}</span>
      <span className="text-muted-foreground">{to}</span>
    </span>
  )
  return (
    <div className="flex flex-col gap-1.5" aria-label={title ? `مفتاح الألوان: ${title}` : 'مفتاح الألوان على الخريطة'}>
      {title && <LegendTitle>{title}</LegendTitle>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        {explain?.length ? <Explained title={title ?? 'ألوان الخريطة'} lines={explain} className="no-underline">{scale}</Explained> : scale}
        {extra && <span className="flex items-center gap-1.5"><span className="h-4 w-7 rounded-sm" style={{ background: extra.color }} aria-hidden /><span className="text-muted-foreground">{extra.label}</span></span>}
      </div>
    </div>
  )
}

/**
 * «طبقات»: the one control that picks which figure colours the map, sitting in the key that shows those colours (it
 * replaced a row of chips under the search, which left a newcomer seven buttons to choose from). A list in a popover:
 * the layer in use is marked, and picking one switches the map and closes the list. A layer's note («غير متاح»,
 * «غير متاح الآن» for one that did not load this time) is said beside it, quieter than its name, and it stays pickable:
 * a layer that failed is asked again when picked, and its key says so if it fails again.
 */
export function LayerPicker({ options, value, onChange }: { options: [id: string, label: string, note?: string][]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  if (options.length < 2) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label="طبقات الخريطة: اختر ما تلوّنه الخريطة"
        className="inline-flex h-8 pointer-coarse:min-h-10 shrink-0 items-center gap-1 rounded-lg border bg-card px-2 text-sm font-semibold text-foreground outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/60 data-[popup-open]:border-primary data-[popup-open]:text-primary">
        <Layers className="size-4" aria-hidden />
        طبقات
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[min(18rem,calc(100vw-2rem))] gap-1 p-1.5">
        <p className="px-2 pt-1 pb-0.5 text-sm font-bold">لوّن الخريطة حسب</p>
        <div role="group" aria-label="طبقات الخريطة" className="flex max-h-[50vh] flex-col overflow-y-auto">
          {options.map(([id, label, note]) => (
            <button key={id} type="button" aria-pressed={id === value} onClick={() => { onChange(id); setOpen(false) }}
              className={cn('flex min-h-10 items-center gap-2 rounded-lg px-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60',
                id === value ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground')}>
              <Check className={cn('size-4 shrink-0', id === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
              <span className="min-w-0 flex-1">{label}{note && <span className="sr-only"> · </span>}</span>
              {note && <span className="shrink-0 text-xs font-normal text-muted-foreground">{note}</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
