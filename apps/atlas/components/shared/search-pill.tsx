import { Search } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The one search bar every Atlas page opens with (the Airbnb pattern): labelled segments in a rounded pill and a round
 * olive search button. With onSubmit it is a search form; without one the button only marks the pill.
 */
export function SearchPill({ children, onSubmit, label = 'ابحث', className }: { children: ReactNode; onSubmit?: () => void; label?: string; className?: string }) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit?.() }
  return (
    <form role="search" aria-label={label} onSubmit={submit}
      className={cn('mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1 rounded-3xl border bg-card p-1.5 shadow-sm transition-shadow focus-within:shadow-md sm:flex-nowrap sm:rounded-full', className)}>
      {children}
      {onSubmit
        ? <button type="submit" aria-label={label} className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2"><Search className="size-5" aria-hidden /></button>
        : <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden><Search className="size-5" /></span>}
    </form>
  )
}

/** One labelled segment of the pill; segments after the first get a thin divider before them. */
export function PillField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-[8rem] flex-1 flex-col rounded-full px-4 py-1 transition-colors hover:bg-muted focus-within:bg-muted sm:[&:not(:first-child)]:border-s', className)}>
      <span className="text-xs font-semibold">{label}</span>
      {children}
    </label>
  )
}

/** The quiet control inside a segment: a select or an input with no box of its own. */
export const pillControl = 'w-full min-w-0 bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/80 disabled:opacity-50'

/** The chip row under the pill. */
export function ChipRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div role="group" aria-label={label} className={cn('mx-auto flex w-full max-w-5xl gap-2 overflow-x-auto pb-1', className)}>{children}</div>
}
