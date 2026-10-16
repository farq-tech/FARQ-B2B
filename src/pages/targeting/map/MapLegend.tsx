import { LayerSwatch } from './glyphs'

/*
 * One small legend on the map (owner 2026-10-16): pin = محل (by layer colour), glowing line = شارع كثيف,
 * tinted area = حي (darker = more places). Open on a desktop, folded on a phone.
 */
const row = 'flex items-center gap-2'
export default function MapLegend({ mobile }: { mobile: boolean }) {
  return (
    <details open={!mobile} data-testid="map-legend" className="pointer-events-auto absolute start-3 bottom-3 z-10 max-w-[200px] rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 px-3 py-2 text-[12px] leading-[18px] shadow-[var(--farq-soft-shadow)]">
      <summary className="cursor-pointer list-none font-semibold">دليل الخريطة</summary>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="main" /></span>محل — نشاط رئيسي</li>
        <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="sub" /></span>محل — نشاط فرعي</li>
        <li className={row}><span className="flex w-6 justify-center"><LayerSwatch layer="spec" /></span>محل — تخصصه</li>
        <li className={row}><span aria-hidden className="h-1.5 w-6 rounded-full bg-[var(--map-green)] shadow-[0_0_6px_2px_color-mix(in_srgb,var(--map-green)_45%,transparent)]" />شارع كثيف بهذا النشاط</li>
        <li className={row}><span aria-hidden className="flex h-3 w-6 overflow-hidden rounded-[3px] border border-[var(--map-ink)]/40">{[8, 15, 24, 34].map((o) => <i key={o} className="h-full flex-1" style={{ background: `color-mix(in srgb, var(--map-green) ${o}%, white)` }} />)}</span>حي — الأغمق فيه محلات أكثر</li>
      </ul>
    </details>
  )
}
