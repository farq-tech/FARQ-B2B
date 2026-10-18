import type { InputHTMLAttributes } from 'react'
import { cx, FOCUS_RING } from './cx'

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & {
  label: string
  description?: string
}

/** Compact, keyboard accessible FARQ toggle. */
export function Switch({ label, description, className, checked, ...props }: SwitchProps) {
  return (
    <label className={cx('inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 px-3 py-1.5 text-[13px] font-medium shadow-sm backdrop-blur-md has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50', className)}>
      <input type="checkbox" role="switch" aria-label={label} aria-checked={checked} checked={checked} className={`peer sr-only ${FOCUS_RING}`} {...props} />
      <span aria-hidden className="relative h-5 w-9 shrink-0 rounded-full bg-[var(--color-border-strong)] transition-colors peer-checked:bg-[var(--color-bg-primary)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-border-primary)] after:absolute after:start-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4" />
      <span className="flex min-w-0 flex-col leading-[18px]">{label}{description ? <span className="text-[11px] font-normal text-[var(--color-text-secondary)]">{description}</span> : null}</span>
    </label>
  )
}
