import { FitSwatch, LayerSwatch } from './glyphs'
import type { PinFit } from './model'

/*
 * Map shape = taxonomy layer; the small marker = the model's estimated supplier fit. The estimate is not verified.
 * Open on a desktop, folded on a phone.
 */
const row = 'flex items-center gap-2'
const FITS: { fit: PinFit; label: string }[] = [
  { fit: 'likely', label: 'مرجّحة' },
  { fit: 'maybe', label: 'محتملة' },
  { fit: 'low', label: 'منخفضة' },
  { fit: 'unknown', label: 'غير مفحوصة' },
]
export default function MapLegend({ mobile }: { mobile: boolean }) {
  return (
    <details open={!mobile} data-testid="map-legend" className="pointer-events-auto absolute start-3 bottom-3 z-10 max-w-[250px] rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 px-3 py-2 text-[12px] leading-[18px] shadow-[var(--farq-soft-shadow)]">
      <summary className="cursor-pointer list-none font-semibold">دليل الخريطة</summary>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        <li className="font-medium">العلامة الصغيرة: تقدير آلي للملاءمة، وليس تأكيداً</li>
        <li className="grid grid-cols-2 gap-x-3 gap-y-1">{FITS.map(({ fit, label }) => <span key={fit} className="flex items-center gap-1.5"><FitSwatch fit={fit} />{label}</span>)}</li>
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
