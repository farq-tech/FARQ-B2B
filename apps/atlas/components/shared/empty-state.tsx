import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Nothing here yet: what this place is for and the one step that fills it. */
export function EmptyState({ icon: Icon, title, body, action, className }: { icon: LucideIcon; title: string; body: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/70 px-6 py-10 text-center', className)}>
      <span className="grid size-12 place-items-center rounded-full bg-accent text-primary"><Icon className="size-6" aria-hidden /></span>
      <h3 className="text-base font-bold">{title}</h3>
      <p className="max-w-xs text-sm leading-7 text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}
