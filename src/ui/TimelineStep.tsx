import { cx } from './cx'
import { Icon } from './Icon'

/*
 * Timeline Step — Figma «Timeline Step» (24:128). Status: Done · Active · Pending · Failed.
 * The rail sits on the start (right) side. The Active node pulses once when the status
 * changes (keyed remount), never in a loop.
 */
export type TimelineStatus = 'Done' | 'Active' | 'Pending' | 'Failed'
const STATUS_LABEL: Record<TimelineStatus, string> = { Done: 'تمت', Active: 'جارية', Pending: 'لم تبدأ', Failed: 'تعثّرت' }

export function TimelineStep({ title, detail, status = 'Done', showConnector = true, className }: { title: string; detail: string; status?: TimelineStatus; showConnector?: boolean; className?: string }) {
  return (
    <li className={cx('flex h-[72px] w-full items-start gap-3', className)} aria-current={status === 'Active' ? 'step' : undefined}>
      <div className="flex shrink-0 flex-col items-center gap-1">
        {status === 'Done' && <span className="flex size-7 items-center justify-center rounded-full bg-[var(--color-bg-success)] text-[var(--color-icon-success)]"><Icon name="check" size={16} /></span>}
        {status === 'Active' && <span key="active" className="ui-pulse-once flex size-7 items-center justify-center rounded-full border-2 border-[var(--color-border-primary)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-icon-primary)]"><Icon name="clock" size={16} /></span>}
        {status === 'Pending' && <span className="flex size-7 items-center justify-center rounded-full bg-[var(--color-bg-surface-2)]"><span className="size-2 rounded-full bg-[var(--color-border-strong)]" /></span>}
        {status === 'Failed' && <span className="flex size-7 items-center justify-center rounded-full bg-[var(--color-bg-danger)] text-[var(--color-icon-danger)]"><Icon name="x" size={16} /></span>}
        {showConnector ? <span aria-hidden className="h-9 w-0.5" style={{ background: status === 'Done' ? 'var(--color-border-success)' : 'var(--color-border-default)' }} /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 text-start">
        <p className="text-[16px] leading-[26px] font-medium" style={{ color: status === 'Pending' ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}>
          {title}<span className="sr-only"> — {STATUS_LABEL[status]}</span>
        </p>
        <p className="text-[14px] leading-[22px]" style={{ color: status === 'Failed' ? 'var(--color-text-danger)' : 'var(--color-text-secondary)' }}>{detail}</p>
      </div>
    </li>
  )
}
