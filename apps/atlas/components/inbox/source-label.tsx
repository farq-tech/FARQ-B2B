'use client'

import { useAppStore } from '@/lib/store'
import type { InboxMessage } from '@/lib/types'
import { cn } from '@/lib/utils'

const SENTIMENT_STYLE: Record<NonNullable<InboxMessage['sentiment']>, string> = {
  مهتم: 'bg-primary/10 text-primary',
  استفسار: 'bg-secondary text-secondary-foreground',
  'غير مهتم': 'bg-muted text-muted-foreground',
}

export function SourceLabel({ message, compact }: { message: InboxMessage; compact?: boolean }) {
  const { requests } = useAppStore()
  const request = requests.find((r) => r.id === message.requestId)
  const label = message.source === 'rfq' ? (message.quote ? 'عرض سعر · طلب تسعير' : 'رد على طلب تسعير') : 'تفاعل حملة تسويقية'

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
          message.source === 'rfq' ? 'bg-secondary text-secondary-foreground' : 'bg-accent text-accent-foreground',
        )}
      >
        {label}
      </span>
      {message.sentiment ? (
        <span className={cn('inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', SENTIMENT_STYLE[message.sentiment])}>
          {message.sentiment}
        </span>
      ) : null}
      {!compact && request ? <span className="truncate text-xs text-muted-foreground">{request.title}</span> : null}
    </span>
  )
}
