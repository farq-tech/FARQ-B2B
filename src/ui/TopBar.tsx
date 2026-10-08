import type { ReactNode } from 'react'
import { cx, FOCUS_RING } from './cx'
import { Icon } from './Icon'
import { useIsMobile } from './useIsMobile'
import { MobileAppBar } from './MobileNav'

/*
 * Top Bar — Figma «Top Bar» (26:600). Breadcrumb on the start side, actions on the end.
 * Figma also shows search / notifications / theme buttons; they are passed in as
 * `actions` only when the feature exists (nothing decorative is rendered).
 */
export function TopBar({ parent, onParent, title, actions, className }: { parent?: string; onParent?: () => void; title: string; actions?: ReactNode; className?: string }) {
  // Phones: Figma «Mobile App Bar» — back to the parent, centred title.
  if (useIsMobile()) return <MobileAppBar title={title} onBack={onParent} />
  return (
    <header className={cx('flex h-[72px] items-center justify-between gap-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-8 py-4', className)}>
      <nav aria-label="مسار الصفحة" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-2">
          {parent ? (
            <li className="flex shrink-0 items-center gap-2">
              {onParent ? <button type="button" onClick={onParent} className={cx('rounded-[var(--radius-sm)] text-[14px] leading-[22px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}>{parent}</button> : <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{parent}</span>}
              <Icon name="chevron-forward" size={16} className="text-[var(--color-icon-secondary)]" />
            </li>
          ) : null}
          <li aria-current="page" className="min-w-0 truncate text-[16px] leading-[26px] font-medium text-[var(--color-text-primary)]">{title}</li>
        </ol>
      </nav>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  )
}

/** Top Bar «Search» field (320×40, surface-2). */
export function SearchField({ placeholder = 'ابحث في الطلبات والموردين', value, onChange }: { placeholder?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex h-10 w-[320px] items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] px-3 focus-within:outline-2 focus-within:outline-solid focus-within:outline-[var(--color-border-primary)]">
      <Icon name="search" size={18} className="text-[var(--color-icon-secondary)]" />
      <span className="sr-only">{placeholder}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[14px] leading-[22px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
    </label>
  )
}
