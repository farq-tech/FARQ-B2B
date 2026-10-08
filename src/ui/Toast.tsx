import { useEffect } from 'react'
import { cx, FOCUS_RING } from './cx'
import { Icon, type IconName } from './Icon'

/*
 * Toast — Figma «Toast» (24:173). Tone: Success · Warning · Error.
 * Appears at the top inline-end corner of the content (left in RTL), as in screen 03.
 * Success/Warning are polite live regions; Error is an alert. No library needed.
 */
export type ToastTone = 'Success' | 'Warning' | 'Error'
const ICON: Record<ToastTone, { name: IconName; color: string }> = {
  Success: { name: 'check-circle', color: 'var(--color-icon-success)' },
  Warning: { name: 'clock', color: 'var(--color-icon-warning)' },
  Error: { name: 'alert', color: 'var(--color-icon-danger)' },
}

type ToastProps = { tone?: ToastTone; title: string; body?: string; onClose?: () => void; /** ms; 0 = stays until closed */ duration?: number; floating?: boolean; className?: string }

export function Toast({ tone = 'Success', title, body, onClose, duration = 0, floating = true, className }: ToastProps) {
  useEffect(() => {
    if (!duration || !onClose) return
    const t = window.setTimeout(onClose, duration)
    return () => window.clearTimeout(t)
  }, [duration, onClose])
  const i = ICON[tone]
  return (
    <div role={tone === 'Error' ? 'alert' : 'status'} aria-live={tone === 'Error' ? 'assertive' : 'polite'}
      className={cx('ui-enter-end flex w-[380px] max-w-[calc(100vw-32px)] items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 text-start shadow-[var(--elevation-lg)]', floating && 'fixed end-8 top-[88px] z-50', className)}>
      <span style={{ color: i.color }}><Icon name={i.name} size={20} /></span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <p className="text-[16px] leading-[26px] font-medium text-[var(--color-text-primary)]">{title}</p>
        {body ? <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{body}</p> : null}
      </div>
      {onClose ? <button type="button" onClick={onClose} aria-label="إغلاق" className={cx('rounded-[var(--radius-sm)] text-[var(--color-icon-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}><Icon name="x" size={18} /></button> : null}
    </div>
  )
}
