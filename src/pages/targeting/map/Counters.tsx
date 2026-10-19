import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible } from '@base-ui/react/collapsible'
import { formatNumber } from '../../../lib/formatNumber'
import { FOCUS_RING } from '../../../ui/cx'
import { recordMapActivityCounterSelection, recordMapInteraction } from '../../../lib/mapAnalytics'

/*
 * Live counters strip above the map (owner 2026-10-16): numbers count up / down to the visible cohort,
 * ease-out over ≤ 700 ms, instant under reduced motion. «المنشآت» is the dark lead tile.
 */
const fmt = (v: number) => formatNumber(Math.round(v))
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function Rolling({ value }: { value: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const frame = useRef(0)
  useEffect(() => {
    const start = from.current
    if (start === value) return
    if (reduced()) { from.current = value; setShown(value); return }
    const t0 = performance.now(), dur = 700
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3)
      const v = start + (value - start) * e
      from.current = v
      setShown(v)
      if (k < 1) frame.current = requestAnimationFrame(step)
      else from.current = value
    }
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [value])
  return <>{fmt(shown)}</>
}
export type CounterItem = { key: string; label: string; value: number | null; lead?: boolean; loading?: boolean }

export default function Counters({ items, compact = false, selectedMainId, selectedCounterKey, onActivitySelect, onCounterSelect }: {
  items: CounterItem[]
  compact?: boolean
  selectedMainId?: string | null
  selectedCounterKey?: string | null
  onActivitySelect?: (mainId: string) => void
  onCounterSelect?: (key: string) => void
}) {
  // Keep the many activity filters out of the primary mobile scroll. The
  // summary stays immediately usable, while the compact disclosure gives the
  // same choices without turning the map page into a long row of tiny cards.
  const grouped = items.some((item) => item.key.startsWith('market-main-'))
  const summaryItems = grouped ? items.filter((item) => !item.key.startsWith('market-main-')) : items
  const detailItems = grouped ? items.filter((item) => item.key.startsWith('market-main-')) : []
  const tiles = (values: CounterItem[], className: string, trackDetailSelection = false) => (
    <div className={className}>
      {values.map((c) => {
        const mainId = c.key.startsWith('market-main-') ? c.key.slice('market-main-'.length) : null
        const selectableActivity = Boolean(mainId && onActivitySelect)
        const selectableSummary = Boolean(!mainId && onCounterSelect && c.value != null && ['market-size', 'market-districts', 'market-whatsapp', 'market-wholesale', 'city-places', 'city-whatsapp', 'city-districts'].includes(c.key))
        const selectable = selectableActivity || selectableSummary
        const pressed = mainId ? selectedMainId === mainId : selectedCounterKey === c.key
        const opensDistrictPicker = c.key === 'market-districts' || c.key === 'city-districts'
        const toggleable = Boolean(mainId || c.key === 'market-whatsapp' || c.key === 'market-wholesale' || c.key === 'city-whatsapp')
        const hoverClass = c.lead ? 'hover:border-[var(--map-green)] hover:bg-[var(--map-ink)]' : 'hover:border-[var(--map-green)] hover:bg-[var(--color-bg-surface-2)]'
        const className = `relative flex shrink-0 flex-col rounded-[12px] border ${compact ? 'px-3' : 'px-2.5'} py-1.5 ${compact ? 'min-w-[76px]' : 'min-w-0'} text-right ${c.lead ? 'border-[var(--map-ink)] bg-[var(--map-ink)] text-white' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)]'} ${selectable ? `cursor-pointer transition-colors ${hoverClass}` : ''} ${pressed ? 'ring-2 ring-[var(--map-green)]' : ''}`
        const body = <>
          <span className={`font-[family-name:var(--font-display)] ${compact ? 'text-[17px] leading-[24px]' : 'text-[20px] leading-[28px]'} font-semibold tabular-nums`}>
            {c.value == null ? '—' : <span aria-hidden><Rolling value={c.value} /></span>}
          </span>
          <span className={`flex items-center gap-1 ${compact ? 'text-[12px] leading-[18px]' : 'text-[11px] leading-[16px]'} ${c.lead ? 'text-white/80' : 'text-[var(--color-text-secondary)]'}`}>
            <span className="sr-only">{c.value == null ? 'غير متاح' : fmt(c.value)} </span>{c.label}
            {selectable ? <ChevronDown aria-hidden size={12} className="shrink-0" /> : null}
          </span>
        </>
        const actionLabel = opensDistrictPicker
          ? `اختيار حي من قائمة الأحياء، ${fmt(c.value!)} حياً مغطى`
          : `تصفية الخريطة حسب ${c.label}، ${c.value == null ? 'العدد غير متاح' : fmt(c.value)} منشأة`
        return selectable ? <button key={c.key} type="button" data-counter={c.key} aria-pressed={toggleable ? pressed : undefined} aria-label={actionLabel} onClick={() => {
          if (selectableActivity) {
            if (trackDetailSelection) {
              recordMapInteraction('map_activity_counter_detail_select')
              recordMapActivityCounterSelection(mainId!)
            }
            onActivitySelect?.(mainId!)
          } else onCounterSelect?.(c.key)
        }} className={`${className} ${FOCUS_RING}`}>{body}</button>
          : <div key={c.key} data-counter={c.key} className={className}>{body}</div>
      })}
    </div>
  )

  if (grouped) return (
    <section aria-label="مؤشرات الخريطة" className="flex flex-col gap-2">
      {tiles(summaryItems, compact ? '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1' : `grid ${summaryItems.length > 4 ? 'grid-cols-5' : 'grid-cols-4'} gap-2`)}
      <Collapsible.Root
        className="overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]"
        onOpenChange={(open) => { if (open) recordMapInteraction('map_activity_counter_panel_open') }}
      >
        <Collapsible.Trigger className={`flex min-h-10 w-full items-center justify-between gap-3 px-3 text-start text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] data-panel-open:[&_svg]:rotate-180 ${FOCUS_RING}`}>
          <span className="flex min-w-0 items-center gap-2"><span className="truncate">تفصيل التصنيفات الرئيسية</span><span className="rounded-full bg-[var(--color-bg-surface-2)] px-2 py-0.5 text-[11px] tabular-nums">{fmt(detailItems.length)}</span></span>
          <ChevronDown aria-hidden size={16} className="shrink-0 transition-transform" />
        </Collapsible.Trigger>
        <Collapsible.Panel className="overflow-hidden border-t border-[var(--color-border-default)] p-2">
          {tiles(detailItems, compact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5', true)}
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  )

  return (
    <section aria-label="مؤشرات الخريطة">
      {tiles(items, compact ? '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1' : `grid ${items.length > 4 ? 'grid-cols-5' : 'grid-cols-4'} gap-2`)}
    </section>
  )
}
