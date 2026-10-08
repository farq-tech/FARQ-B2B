import { useId, type InputHTMLAttributes } from 'react'
import { cx } from './cx'

/*
 * Input — Figma «Input» (21:74). State: Default · Hover · Focus · Filled · Error · Disabled.
 * Hover/Focus/Filled come from the browser; Error and Disabled are props.
 */
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label: string
  helper?: string
  error?: string
  suffix?: string
}

export function Input({ label, helper, error, suffix, disabled, className, id, ...rest }: InputProps) {
  const auto = useId()
  const inputId = id || auto
  const noteId = `${inputId}-note`
  const note = error || helper
  return (
    <div className={cx('flex w-full flex-col items-stretch gap-2 text-start', disabled && 'opacity-50', className)}>
      <label htmlFor={inputId} className="text-[14px] leading-[22px] font-medium text-[var(--color-text-primary)]">{label}</label>
      <div className={cx(
        'flex items-center gap-2 rounded-[var(--radius-md)] border px-4 py-3 transition-colors',
        disabled ? 'bg-[var(--color-bg-surface-2)] border-[var(--color-border-default)]' : 'bg-[var(--color-bg-surface)]',
        !disabled && (error ? 'border-[var(--color-border-danger)] focus-within:outline-2 focus-within:outline-[var(--color-border-danger)] focus-within:-outline-offset-1' : 'border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] focus-within:border-transparent focus-within:outline-2 focus-within:outline-[var(--color-border-primary)] focus-within:-outline-offset-1'),
      )}>
        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          className="min-w-0 flex-1 bg-transparent text-[16px] leading-[26px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed"
          {...rest}
        />
        {suffix ? <span className="shrink-0 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{suffix}</span> : null}
      </div>
      {note ? <p id={noteId} className={cx('text-[12px] leading-[18px] font-medium', error ? 'text-[var(--color-text-danger)]' : 'text-[var(--color-text-secondary)]')}>{note}</p> : null}
    </div>
  )
}
