import { useRef, useState } from 'react'
import { Icon } from '../../../ui'
import { FOCUS_RING } from '../../../ui/cx'
import { recordMapInteraction } from '../../../lib/mapAnalytics'
import { FitSwatch, LayerSwatch } from './glyphs'
import type { PinFit } from './model'

/*
 * Map shape = taxonomy layer; the small marker = the model's estimated supplier fit. The estimate is not verified.
 * Open on a desktop, folded on a phone.
 */
const row = 'flex items-center gap-2'
const FITS: { fit: PinFit | 'all'; label: string }[] = [
  { fit: 'all', label: 'الكل' },
  { fit: 'likely', label: 'مرجّحة' },
  { fit: 'maybe', label: 'محتملة' },
  { fit: 'low', label: 'منخفضة' },
  { fit: 'unknown', label: 'بدون تقدير نموذجي' },
]
const LEGEND_HIDDEN_KEY = 'farq-opportunity-map-legend-hidden-v2'

function readHiddenPreference() {
  try {
    // Keep the map clear by default. Once the user dismisses the legend, remember that choice.
    return window.localStorage.getItem(LEGEND_HIDDEN_KEY) !== '0'
  } catch {
    return true
  }
}

export default function MapLegend({ fitFilter, onFitFilterChange, counts }: {
  fitFilter: PinFit | 'all'
  onFitFilterChange: (fit: PinFit | 'all') => void
  counts: Record<PinFit | 'all', number>
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(readHiddenPreference)
  const show = () => {
    setHidden(false)
    try { window.localStorage.setItem(LEGEND_HIDDEN_KEY, '0') } catch { /* storage can be unavailable */ }
    recordMapInteraction('map_legend_show')
  }
  const hide = () => {
    if (details.current) details.current.open = false
    setOpen(false)
    setHidden(true)
    try { window.localStorage.setItem(LEGEND_HIDDEN_KEY, '1') } catch { /* storage can be unavailable */ }
    recordMapInteraction('map_legend_hide')
  }
  if (hidden) return (
    <button type="button" aria-label="إظهار دليل الخريطة" title="إظهار دليل الخريطة"
      onClick={show}
      className={`pointer-events-auto absolute start-3 bottom-3 z-10 flex size-9 items-center justify-center rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 shadow-[var(--farq-soft-shadow)] backdrop-blur-md ${FOCUS_RING}`}>
      <Icon name="info" size={17} />
    </button>
  )
  return (
    <details ref={details} data-testid="map-legend" onToggle={(event) => setOpen(event.currentTarget.open)} className="pointer-events-auto absolute start-3 bottom-3 z-10 max-h-[min(48dvh,360px)] max-w-[250px] overflow-y-auto overscroll-contain rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/90 px-3 py-2 text-[12px] leading-[18px] shadow-[var(--farq-soft-shadow)] backdrop-blur-md md:max-h-[min(65dvh,560px)]">
      <summary className="sticky top-0 z-10 -mx-3 -mt-2 cursor-pointer list-none bg-[var(--color-bg-surface)]/95 px-3 pb-1 pt-2 pe-16 font-semibold backdrop-blur-md">دليل الخريطة</summary>
      {open ? <button type="button" aria-label="إخفاء دليل الخريطة وإخلاء مساحة الخريطة" title="إخفاء الدليل"
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); hide() }}
        className={`sticky top-1 z-20 ms-auto -mt-8 mb-1 inline-flex min-h-8 items-center gap-1 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2.5 text-[12px] font-semibold text-[var(--color-text-primary)] shadow-sm hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}>
        <Icon name="x" size={14} />إخفاء
      </button> : null}
      <ul className="mt-1.5 flex flex-col gap-1.5">
        <li className="font-medium">العلامة الصغيرة: تقدير آلي للملاءمة، وليس تأكيداً</li>
        <li className="text-[var(--color-text-secondary)]">التقدير النموذجي متاح لـ {counts.likely + counts.maybe + counts.low} من {counts.all} منشأة محمّلة. قد تعرض المنشأة سبب مطابقة قائماً على نشاطها حتى دون تقدير نموذجي.</li>
        <li>
          <fieldset className="m-0 grid min-w-0 grid-cols-2 gap-1 border-0 p-0">
            <legend className="sr-only">تصفية المنشآت حسب تقدير الملاءمة</legend>
            {FITS.map(({ fit, label }) => (
              <button key={fit} type="button" aria-pressed={fitFilter === fit}
                onClick={(event) => { event.stopPropagation(); onFitFilterChange(fit) }}
                className={`flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-start ${fitFilter === fit ? 'bg-[var(--color-bg-surface-2)] font-semibold text-[var(--color-text-primary)] ring-1 ring-[var(--color-border-default)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)]'}`}>
                {fit === 'all' ? <span className="w-3 text-center" aria-hidden>•</span> : <FitSwatch fit={fit} />}{label} <span className="ms-auto tabular-nums text-[var(--color-text-secondary)]">{counts[fit]}</span>
              </button>
            ))}
          </fieldset>
        </li>
        <li className="text-[var(--color-text-secondary)]">التصفية تغيّر ما يظهر فقط؛ المنشآت المحددة تبقى ضمن طلبك.</li>
        <li className="text-[var(--color-text-secondary)]">قناة التواصل تظهر في ملف المنشأة.</li>
        <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="main" /></span>منشأة — نشاط رئيسي</li>
        <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="sub" /></span>منشأة — نشاط فرعي</li>
        <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="spec" /></span>منشأة — تخصصها</li>
        <li className={row}><span aria-hidden className="mx-auto size-3 rounded-full border-2 border-white bg-[var(--map-green)] shadow-[0_0_0_1px_var(--map-green)]" />تجمع تجاري · عدد المنشآت</li>
        <li className={row}><span aria-hidden className="h-1.5 w-6 rounded-full bg-[var(--map-green)] shadow-[0_0_6px_2px_color-mix(in_srgb,var(--map-green)_45%,transparent)]" />شارع كثيف بهذا النشاط</li>
        <li className={row}><span aria-hidden className="flex h-3 w-6 overflow-hidden rounded-[3px] border border-[var(--map-ink)]/40">{[8, 15, 24, 34].map((o) => <i key={o} className="h-full flex-1" style={{ background: `color-mix(in srgb, var(--map-green) ${o}%, white)` }} />)}</span>حي — الأغمق فيه منشآت أكثر</li>
      </ul>
    </details>
  )
}
