'use client'

import { Tags, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import type { LiveActivityMain } from '@/lib/live-market'

export function LiveActivityFilter({
  activities,
  activeId,
  onSelect,
  onClear,
}: {
  activities: readonly LiveActivityMain[]
  activeId?: string
  onSelect: (activity: LiveActivityMain) => void
  onClear: () => void
}) {
  if (!activities.length) return null
  const visible = activities.slice(0, 8)
  const active = activities.find((activity) => activity.main_id === activeId)

  return (
    <section className="rounded-xl border bg-card p-4" aria-label="التصنيفات الحية">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Tags className="size-4" aria-hidden /></span>
          <div>
            <p className="text-sm font-semibold">التصنيفات الحية</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">اختَر تصنيفاً لتحديث الأحياء والشوارع والتجمعات على الخريطة.</p>
          </div>
        </div>
        {active ? (
          <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={onClear}>
            <X data-icon="inline-start" />
            مسح
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {visible.map((activity) => {
          const selected = activity.main_id === activeId
          return (
            <button
              key={activity.main_id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(activity)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/40 hover:text-primary'}`}
            >
              <span className="truncate">{activity.main_ar}</span>
              <span className={selected ? 'text-primary-foreground/80 tabular-nums' : 'text-muted-foreground tabular-nums'}>{formatNumber(activity.shops)}</span>
            </button>
          )
        })}
      </div>
      {active ? <p className="mt-2 text-xs text-muted-foreground">النطاق الحالي: {active.main_ar} · {formatNumber(active.streets)} شارع نشاط.</p> : null}
    </section>
  )
}
