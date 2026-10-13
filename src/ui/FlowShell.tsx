import type { ReactNode } from 'react'
import { cx, FOCUS_RING } from './cx'
import { Icon } from './Icon'
import Brand from '../b2b/Brand'
import { useIsMobile } from './useIsMobile'
import { MobileAppBar } from './MobileNav'

/*
 * Flow header + footer for the new-request wizard — Figma 01/02 «Flow header» (38:5)
 * and «Footer actions» (38:78). Steps fill from the start (right) in RTL.
 */
export function FlowHeader({ steps, current, onClose, mobileTitle, onBack }: { steps: string[]; current: number; onClose: () => void; mobileTitle?: string; onBack?: () => void }) {
  const mobile = useIsMobile()
  // Phones (Figma M01/M02): first step = progress bars + close; later steps = app bar with back.
  if (mobile && mobileTitle) return <MobileAppBar titleAsText title={mobileTitle} onBack={onBack} />
  if (mobile) {
    return (
      <header className="flex h-[54px] items-center justify-between px-4">
        <button type="button" onClick={onClose} aria-label="إغلاق الطلب" className={cx('flex size-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-icon-secondary)]', FOCUS_RING)}><Icon name="x" size={22} /></button>
        <ol aria-label={`الخطوة ${current + 1} من ${steps.length}: ${steps[current]}`} className="flex gap-1">
          {steps.map((s, i) => <li key={s} aria-hidden className="h-1 w-10 rounded-[2px]" style={{ background: i <= current ? 'var(--color-bg-brand)' : 'var(--color-border-default)' }} />)}
        </ol>
      </header>
    )
  }
  return (
    <header className="flex h-20 items-center justify-between gap-4 px-12">
      <Brand />
      <ol aria-label="خطوات الطلب" className="flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === current ? 'step' : undefined} className="flex w-24 flex-col items-start gap-1.5">
            <span aria-hidden className="h-1 w-full rounded-[2px]" style={{ background: i <= current ? 'var(--color-bg-brand)' : 'var(--color-border-default)' }} />
            <span className="text-[12px] leading-[18px] font-medium" style={{ color: i <= current ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{s}</span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={onClose} aria-label="إغلاق الطلب" className={cx('flex size-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-icon-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}>
        <Icon name="x" size={20} />
      </button>
    </header>
  )
}

export function FlowFooter({ back, status, next }: { back?: ReactNode; status?: ReactNode; next?: ReactNode }) {
  if (useIsMobile()) {
    return (
      <footer className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 pt-3 pb-4">
        {status ? <p className="text-center text-[12px] leading-[18px] text-[var(--color-text-secondary)]" aria-live="polite">{status}</p> : null}
        <div className="[&>button]:w-full">{next}</div>
      </footer>
    )
  }
  return (
    <footer className="sticky bottom-0 z-10 flex h-[88px] items-center justify-between gap-4 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-12">
      <div className="min-w-24">{back}</div>
      <p className="text-center text-[14px] leading-[22px] text-[var(--color-text-secondary)]" aria-live="polite">{status}</p>
      <div className="flex min-w-24 justify-end">{next}</div>
    </footer>
  )
}
