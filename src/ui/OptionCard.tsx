import { cx, FOCUS_RING } from './cx'
import { Icon } from './Icon'
import booklet from '../assets/spot/booklet.svg'
import list from '../assets/spot/list.svg'
import photo from '../assets/spot/photo.svg'

/*
 * Option card — Figma 01 «Option / …» (38:38) with a «Spot» illustration (32:436).
 * A radio in a radiogroup: Selected = 2px border/primary + glow + check badge at the end corner.
 */
export type SpotName = 'كراسة' | 'قائمة' | 'صورة'
const SPOT: Record<SpotName, string> = { 'كراسة': booklet, 'قائمة': list, 'صورة': photo }

/** layout «row»: Figma M01 phone option (358×88, spot at the start). */
export function OptionCard({ spot, title, hint, selected, onSelect, layout = 'tile' }: { spot: SpotName; title: string; hint: string; selected: boolean; onSelect: () => void; layout?: 'tile' | 'row' }) {
  if (layout === 'row') {
    return (
      <button type="button" role="radio" aria-checked={selected} aria-label={`${title} — ${hint}`} onClick={onSelect}
        className={cx('flex min-h-[88px] w-full items-center gap-4 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-4 text-start',
          selected ? 'border-2 border-[var(--color-border-primary)] shadow-[var(--glow-primary)]' : 'border border-[var(--color-border-default)]', FOCUS_RING)}>
        <img src={SPOT[spot]} alt="" width={48} height={48} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium text-[var(--color-text-primary)]">{title}</span>
          <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{hint}</span>
        </span>
      </button>
    )
  }
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={`${title} — ${hint}`} onClick={onSelect}
      className={cx('relative flex h-[200px] w-[240px] flex-col items-center justify-center gap-3 rounded-[var(--radius-xl)] bg-[var(--color-bg-surface)] transition-shadow',
        selected ? 'border-2 border-[var(--color-border-primary)] shadow-[var(--glow-primary)]' : 'border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]', FOCUS_RING)}>
      <img src={SPOT[spot]} alt="" width={64} height={64} />
      <span className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium text-[var(--color-text-primary)]">{title}</span>
      <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{hint}</span>
      {selected ? <span aria-hidden className="absolute end-4 top-4 flex size-6 items-center justify-center rounded-full bg-[var(--color-bg-inverse)] text-[var(--color-text-on-inverse)]"><Icon name="check" size={14} /></span> : null}
    </button>
  )
}
