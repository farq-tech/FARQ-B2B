import { BookmarkPlus, CircleCheck, Clock, FileText, Hand, Megaphone, PenLine, Send, type LucideIcon } from 'lucide-react'
import { STATUS_SINGULAR, TYPE_LABEL } from '@/lib/format'
import type { RequestStatus, RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_STYLE: Record<RequestStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  needs_decision: 'bg-primary text-primary-foreground',
  ready_manual: 'border border-primary/40 bg-card text-primary',
  awaiting: 'bg-accent text-accent-foreground',
  completed: 'border text-muted-foreground',
}

// each status has its own shape as well as its colour, so the five read apart in greyscale and at a glance
export const STATUS_ICON: Record<RequestStatus, LucideIcon> = {
  draft: PenLine,
  needs_decision: Hand,
  ready_manual: Send,
  awaiting: Clock,
  completed: CircleCheck,
}

export function StatusBadge({ status, className, label }: { status: RequestStatus; className?: string; label?: string }) {
  const Icon = STATUS_ICON[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_STYLE[status], className)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">الحالة: </span>
      {label ?? STATUS_SINGULAR[status]}
    </span>
  )
}

export const TYPE_ICON: Record<RequestType, typeof FileText> = {
  rfq: FileText,
  list: BookmarkPlus,
  campaign: Megaphone,
}

export function TypeLabel({ type }: { type: RequestType }) {
  const Icon = TYPE_ICON[type]
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {TYPE_LABEL[type]}
    </span>
  )
}
