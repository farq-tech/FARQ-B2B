import { useSyncExternalStore, type ReactNode } from 'react'
import { Icon } from '../../ui'
import { cx, FOCUS_RING } from '../../ui/cx'

/*
 * Mobile chrome for the request flow — Figma M01 (56:2) and M02 (56:60).
 * Desktop uses src/ui FlowHeader/FlowFooter (01 38:5 / 38:78); those are fixed at 48px gutters and
 * 96px steps, so under 768px the flow renders these instead (one tree at a time, not CSS-hidden twins).
 */

const MOBILE = '(max-width: 767px)'
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(MOBILE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE).matches, () => false)
}

/** Where the Lead mounts the live background (BG / RFQ Network). Empty here, behind everything. */
export function LiveBg() {
  return <div data-live-bg="light" aria-hidden className="pointer-events-none absolute inset-0 z-0" />
}

/** M01: close at the start, four progress bars. */
export function MobileStepsHeader({ steps, current, onClose }: { steps: string[]; current: number; onClose: () => void }) {
  return (
    <header className="relative z-10 flex h-14 items-center gap-4 px-4">
      <button type="button" onClick={onClose} aria-label="إغلاق الطلب" className={cx('flex size-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-icon-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}>
        <Icon name="x" size={20} />
      </button>
      <ol aria-label="خطوات الطلب" className="flex flex-1 items-center gap-2">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === current ? 'step' : undefined} className="flex-1">
            <span className="sr-only">{s}</span>
            <span aria-hidden className="block h-1 rounded-[2px]" style={{ background: i <= current ? 'var(--color-bg-brand)' : 'var(--color-border-default)' }} />
          </li>
        ))}
      </ol>
    </header>
  )
}

/** M02: back at the start, centred title. */
export function MobileTitleHeader({ title, onBack, step, total }: { title: string; onBack?: () => void; step: number; total: number }) {
  return (
    <header className="relative z-10 grid h-14 grid-cols-[40px_1fr_40px] items-center border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="رجوع" className={cx('flex size-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-icon-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}>
          <Icon name="chevron-back" size={20} />
        </button>
      ) : <span />}
      <p className="text-center font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">{title}</p>
      <span className="sr-only">الخطوة {step} من {total}</span>
    </header>
  )
}

/** M01/M02 footer: one full-width action; status read out politely for screen readers. */
export function MobileFooter({ status, children }: { status?: string; children: ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 pt-3 pb-6">
      {status ? <p className="text-center text-[12px] leading-[18px] text-[var(--color-text-secondary)]" aria-live="polite">{status}</p> : null}
      {children}
    </footer>
  )
}
