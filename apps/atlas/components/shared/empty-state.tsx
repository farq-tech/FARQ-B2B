import { DatabaseZap, SearchX, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The one shape every empty and failed state takes: an icon disc, a title, one line of text and at most one action.
 * `tone` picks the colour (neutral olive for «nothing here yet», destructive for a failure); `compact` lays it out as
 * one row for lists, panels and map overlays instead of the centred block.
 */
export function StateMessage({ icon: Icon, title, body, action, tone = 'neutral', compact = false, role, heading = 'h3', className }: {
  icon: LucideIcon
  title: string
  body?: string
  action?: ReactNode
  tone?: 'neutral' | 'error'
  compact?: boolean
  role?: 'alert' | 'status'
  /** the centred block's heading level: h3 inside a panel or card (the default), h2 when it is the page's own content
   * right under its h1, h1 when it is all the page says (not found, a page that broke)
   * so a screen reader's heading list neither skips a level nor misses the page's title */
  heading?: 'h1' | 'h2' | 'h3'
  className?: string
}) {
  const Heading = heading
  const box = tone === 'error' ? 'border-destructive/25 bg-destructive/5' : 'border-dashed bg-card/70'
  const disc = tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-accent text-primary'
  if (compact) {
    return (
      <div role={role} className={cn('flex items-center gap-3 rounded-2xl border p-3', box, className)}>
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', disc)}><Icon className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          {body && <p className="text-xs leading-5 text-muted-foreground">{body}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    )
  }
  return (
    <div role={role} className={cn('flex flex-col items-center gap-3 rounded-2xl border px-6 py-10 text-center', box, className)}>
      <span className={cn('grid size-12 place-items-center rounded-full', disc)}><Icon className="size-6" aria-hidden /></span>
      <Heading className="text-base font-bold">{title}</Heading>
      {body && <p className="max-w-xs text-sm leading-7 text-muted-foreground">{body}</p>}
      {action}
    </div>
  )
}

/** Nothing here yet: what this place is for and the one step that fills it. */
export function EmptyState({ icon, title, body, action, compact, heading, className }: { icon: LucideIcon; title: string; body: string; action?: ReactNode; compact?: boolean; heading?: 'h1' | 'h2' | 'h3'; className?: string }) {
  return <StateMessage icon={icon} title={title} body={body} action={action} compact={compact} heading={heading} className={className} />
}

/**
 * Asked, and nothing matched (no business of this activity, no listing for these filters): what was asked, and the
 * one change most likely to find something. Never shown as a 0 in a figure.
 */
export function NoResult({ title, body, action, compact = true, className }: { title: string; body: string; action?: ReactNode; compact?: boolean; className?: string }) {
  return <StateMessage role="status" icon={SearchX} title={title} body={body} action={action} compact={compact} className={className} />
}

/**
 * The data does not exist for this place yet (CLAUDE.md: «غير متاح», never 0, never an estimate): what is missing,
 * where, and what still works instead. Same wording as Unavailable (unavailable.tsx), kept literal here so this file
 * stays usable from server components.
 */
export function NotAvailable({ what, where, body, action, compact = true, className }: { what: string; where?: string; body: string; action?: ReactNode; compact?: boolean; className?: string }) {
  return <StateMessage role="status" icon={DatabaseZap} title={`${what}: غير متاح${where ? ` في ${where}` : ''}`} body={body} action={action} compact={compact} className={className} />
}
