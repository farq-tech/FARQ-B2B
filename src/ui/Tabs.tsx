import { useRef, type KeyboardEvent } from 'react'
import { cx, FOCUS_RING } from './cx'

/*
 * Tab — Figma «Tab» (25:102). State: Default · Active (3px brand indicator).
 * Tabs is the accessible group: role=tablist, roving tabindex, arrow keys follow RTL
 * (ArrowLeft = next, ArrowRight = previous), Home/End jump.
 */
export function Tab({ label, active, onSelect, onKeyDown, id, controls, tabIndex }: { label: string; active?: boolean; onSelect?: () => void; onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void; id?: string; controls?: string; tabIndex?: number }) {
  return (
    <button type="button" role="tab" id={id} aria-selected={Boolean(active)} aria-controls={controls} tabIndex={tabIndex ?? (active ? 0 : -1)} onClick={onSelect} onKeyDown={onKeyDown}
      className={cx('group flex flex-col items-center gap-2 rounded-[var(--radius-sm)] pt-2.5', FOCUS_RING)}>
      <span className={cx('text-[16px] leading-[26px] whitespace-nowrap', active ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]')}>{label}</span>
      <span aria-hidden className="h-[3px] w-full rounded-[2px]" style={{ background: active ? 'var(--color-bg-brand)' : 'transparent' }} />
    </button>
  )
}

export function Tabs<K extends string>({ items, value, onChange, label, className }: { items: Array<{ key: K; label: string }>; value: K; onChange: (k: K) => void; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = items.findIndex((t) => t.key === value)
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const next = rtl ? 'ArrowLeft' : 'ArrowRight'
    const prev = rtl ? 'ArrowRight' : 'ArrowLeft'
    let j = -1
    if (e.key === next) j = (i + 1) % items.length
    else if (e.key === prev) j = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = items.length - 1
    if (j < 0) return
    e.preventDefault()
    onChange(items[j].key)
    requestAnimationFrame(() => (ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[j])?.focus())
  }
  return (
    <div ref={ref} role="tablist" aria-label={label} className={cx('flex items-center gap-5', className)}>
      {items.map((t) => <Tab key={t.key} label={t.label} active={t.key === value} onSelect={() => onChange(t.key)} onKeyDown={onKey} />)}
    </div>
  )
}
