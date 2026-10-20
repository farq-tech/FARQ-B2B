'use client'

import { MapPin, MessageCircle, Phone } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { districtById, streetById } from '@/lib/mock-data'
import { formatPhone } from '@/lib/format'
import type { ScoredBusiness } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ResultCardProps {
  business: ScoredBusiness
  selected: boolean
  focused: boolean
  onToggle: () => void
  onFocus: () => void
}

export function ResultCard({ business: b, selected, focused, onToggle, onFocus }: ResultCardProps) {
  return (
    <article
      className={cn(
        'flex gap-3 rounded-xl border bg-card p-3.5 transition-colors',
        selected ? 'border-primary/60 bg-accent/30' : 'hover:border-foreground/20',
        focused && 'ring-2 ring-primary/30',
      )}
    >
      <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`تحديد ${b.name}`} className="mt-1" />
      <button type="button" onClick={onFocus} className="flex min-w-0 flex-1 flex-col gap-2 text-right" aria-label={`عرض ${b.name} على الخريطة`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{b.name}</h3>
            <p className="text-xs text-muted-foreground">
              {b.activity} · {b.specialty}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1" aria-label={`نسبة المطابقة ${b.relevance}%`}>
            <span className="text-xs font-semibold text-primary tabular-nums">{b.relevance}%</span>
            <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${b.relevance}%` }} />
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden />
            {districtById.get(b.districtId)?.name} · {streetById.get(b.streetId)?.name}
          </span>
          {b.whatsapp ? (
            <span className="inline-flex items-center gap-1 text-foreground/80" dir="ltr">
              <MessageCircle className="size-3.5 text-primary" aria-hidden />
              {formatPhone(b.whatsapp)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3.5" aria-hidden />
              بدون واتساب
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">{b.role}</span>
          {b.wholesale ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">جملة</span> : null}
          <span className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">سبب المطابقة:</span> {b.reasons.join('، ')}
          </span>
        </div>
      </button>
    </article>
  )
}
