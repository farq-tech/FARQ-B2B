import { cx, FOCUS_RING } from './cx'
import { Icon, IconFrom, type IconSource } from './Icon'

/*
 * Chip — Figma «Chip» (21:99). State: Default · Hover · Selected · Disabled.
 * A toggle button: aria-pressed carries the Selected state to assistive tech.
 */
type ChipProps = { label: string; /** leading Farq icon (filters on خريطة الفرص) */ icon?: IconSource; selected?: boolean; disabled?: boolean; onClick?: () => void; onRemove?: () => void; className?: string }

export function Chip({ label, icon, selected, disabled, onClick, onRemove, className }: ChipProps) {
  return (
    <span className={cx('inline-flex items-center', className)}>
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[14px] leading-[22px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          selected
            ? 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-text-info)]'
            : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] enabled:hover:border-[var(--color-border-strong)] enabled:hover:bg-[var(--color-bg-surface-2)] enabled:hover:text-[var(--color-text-primary)] disabled:text-[var(--color-text-tertiary)]',
          FOCUS_RING,
        )}
      >
        {icon ? <IconFrom icon={icon} size={16} /> : null}
        {label}
        {selected ? <Icon name="check" size={16} /> : null}
      </button>
      {onRemove ? (
        <button type="button" aria-label={`إزالة ${label}`} onClick={onRemove} disabled={disabled} className={cx('-ms-1 inline-flex items-center rounded-full px-1 text-[var(--color-icon-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50', FOCUS_RING)}>
          <Icon name="x" size={14} />
        </button>
      ) : null}
    </span>
  )
}
