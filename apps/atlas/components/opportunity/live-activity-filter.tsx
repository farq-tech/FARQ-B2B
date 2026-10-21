'use client'

import { ChevronDown, Tags, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import type { LiveActivityMain } from '@/lib/live-market'

export function LiveActivityFilter({
  activities,
  active,
  onSelect,
  onClear,
}: {
  activities: readonly LiveActivityMain[]
  active?: LiveActivityMain | null
  onSelect: (activity: LiveActivityMain, label?: string) => void
  onClear: () => void
}) {
  if (!activities.length) return null
  const visible = activities.slice(0, 8)
  const activeMain = activities.find((activity) => activity.main_id === active?.main_id)
  const activeSubIds = new Set(active?.subs.map((sub) => sub.sub_id) ?? [])
  const isNarrowScope = Boolean(active && activeMain && active.subs.length < activeMain.subs.length)

  return (
    <section className="rounded-xl border bg-card p-4" aria-label="التصنيفات الحية">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Tags className="size-4" aria-hidden /></span>
          <div>
            <p className="text-sm font-semibold">التصنيفات الحية</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">اختَر تصنيفاً لتحديث الأحياء والشوارع والتجمعات. الرقم يخص المنشآت الموصوفة على شوارع النشاط؛ إجمالي الخريطة يظهر في الأعلى.</p>
          </div>
        </div>
        {activeMain ? (
          <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={onClear}>
            <X data-icon="inline-start" />
            مسح
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {visible.map((activity) => {
          const selected = activity.main_id === active?.main_id
          return (
            <button
              key={activity.main_id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(activity)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/40 hover:text-primary'}`}
            >
              <span className="truncate">{activity.main_ar}</span>
              <span className={selected ? 'text-primary-foreground/80 tabular-nums' : 'text-muted-foreground tabular-nums'} title={`${formatNumber(activity.shops)} منشأة موصوفة على شوارع النشاط`}>{formatNumber(activity.shops)} في الشوارع</span>
            </button>
          )
        })}
      </div>
      {activeMain ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">النطاق الحالي: {isNarrowScope && active?.subs.length === 1 ? active.subs[0]?.sub_ar : activeMain.main_ar} · {formatNumber(active?.streets ?? activeMain.streets)} شارع نشاط.</p>
          {activeMain.subs.length ? (
            <details className="mt-2" defaultOpen={isNarrowScope}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-foreground marker:hidden">
                <span>تحديد تخصص أدق</span>
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
              </summary>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">اختيار تخصص يحدّث الأحياء والتجمعات والشوارع إلى نطاقه فقط.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeMain.subs.map((sub) => {
                  const selected = isNarrowScope && activeSubIds.has(sub.sub_id)
                  const scoped: LiveActivityMain = { ...activeMain, subs: [sub], streets: sub.streets, shops: sub.shops }
                  return (
                    <button
                      key={sub.sub_id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelect(selected ? activeMain : scoped, selected ? activeMain.main_ar : sub.sub_ar)}
                      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/40 hover:text-primary'}`}
                    >
                      <span className="truncate">{sub.sub_ar}</span>
                      <span className={selected ? 'text-primary-foreground/80 tabular-nums' : 'text-muted-foreground tabular-nums'}>{formatNumber(sub.shops)}</span>
                    </button>
                  )
                })}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
