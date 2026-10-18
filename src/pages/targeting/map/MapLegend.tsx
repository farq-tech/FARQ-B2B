import { Icon } from '../../../ui'
import { FOCUS_RING } from '../../../ui/cx'
import { recordMapInteraction } from '../../../lib/mapAnalytics'
import { FitSwatch, LayerSwatch } from './glyphs'
import type { PinFit } from './model'

/* Keep the map clear; the full key and fit filter live in the results panel's guide tab. */
const row = 'flex items-center gap-2'
const FITS: { fit: PinFit | 'all'; label: string }[] = [
  { fit: 'all', label: 'الكل' },
  { fit: 'likely', label: 'مرجّحة' },
  { fit: 'maybe', label: 'محتملة' },
  { fit: 'low', label: 'منخفضة' },
  { fit: 'unknown', label: 'بدون تقدير نموذجي' },
]

export default function MapLegend({ fitFilter, onFitFilterChange, counts }: {
  fitFilter: PinFit | 'all'
  onFitFilterChange: (fit: PinFit | 'all') => void
  counts: Record<PinFit | 'all', number>
}) {
  return (
    <details data-testid="map-legend" onToggle={(event) => recordMapInteraction(event.currentTarget.open ? 'map_legend_show' : 'map_legend_hide')} className="group mx-4 my-3 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
      <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-[13px] font-semibold ${FOCUS_RING}`}>
        <span>دليل الخريطة وتقدير الملاءمة</span>
        <Icon name="chevron-down" size={16} className="shrink-0 text-[var(--color-icon-secondary)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[var(--color-border-default)] px-4 py-3 text-[13px] leading-[20px]">
        <p className="m-0 font-medium">العلامة الصغيرة تقدير آلي للملاءمة، وليست تأكيداً.</p>
        <p className="mt-1 text-[var(--color-text-secondary)]">التقدير متاح لـ {counts.likely + counts.maybe + counts.low} من {counts.all} منشأة محمّلة. قد يظهر سبب مطابقة قائم على نشاط المنشأة حتى دون تقدير نموذجي.</p>
        <fieldset className="mt-3 grid min-w-0 grid-cols-2 gap-1 border-0 p-0">
          <legend className="sr-only">تصفية المنشآت حسب تقدير الملاءمة</legend>
          {FITS.filter(({ fit }) => fit === 'all' || counts[fit] > 0).map(({ fit, label }) => (
            <button key={fit} type="button" aria-pressed={fitFilter === fit}
              onClick={() => onFitFilterChange(fit)}
              className={`flex min-h-11 items-center gap-1.5 rounded-md px-2 text-start ${fitFilter === fit ? 'bg-[var(--color-bg-surface-2)] font-semibold text-[var(--color-text-primary)] ring-1 ring-[var(--color-border-default)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)]'} ${FOCUS_RING}`}>
              {fit === 'all' ? <span className="w-3 text-center" aria-hidden>•</span> : <FitSwatch fit={fit} />}
              {label}<span className="ms-auto tabular-nums text-[var(--color-text-secondary)]">{counts[fit]}</span>
            </button>
          ))}
        </fieldset>
        <p className="mt-2 text-[var(--color-text-secondary)]">التصفية تغيّر ما يظهر على الخريطة فقط؛ المنشآت المحددة تبقى ضمن طلبك. قناة التواصل تظهر في ملف المنشأة.</p>
        <ul className="mt-3 flex flex-col gap-2">
          <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="main" /></span>منشأة — نشاط رئيسي</li>
          <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="sub" /></span>منشأة — نشاط فرعي</li>
          <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="spec" /></span>منشأة — تخصصها</li>
          <li className={row}><span aria-hidden className="mx-auto size-3 rounded-full border-2 border-white bg-[var(--map-green)] shadow-[0_0_0_1px_var(--map-green)]" />تجمع تجاري · عدد المنشآت</li>
          <li className={row}><span aria-hidden className="h-1.5 w-6 rounded-full bg-[var(--map-green)] shadow-[0_0_6px_2px_color-mix(in_srgb,var(--map-green)_45%,transparent)]" />شارع كثيف بهذا النشاط</li>
          <li className={row}><span aria-hidden className="flex h-3 w-6 overflow-hidden rounded-[3px] border border-[var(--map-ink)]/40">{[8, 15, 24, 34].map((o) => <i key={o} className="h-full flex-1" style={{ background: `color-mix(in srgb, var(--map-green) ${o}%, white)` }} />)}</span>حي — الأغمق فيه منشآت أكثر</li>
        </ul>
      </div>
    </details>
  )
}
