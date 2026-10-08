import { cx } from './cx'
import { Icon } from './Icon'

/*
 * Price Cell — Figma «Price Cell» (24:91). State: Best · Normal · Higher · Not comparable · Pending.
 * Delta is always vs. the best comparable offer. Not comparable = excluded from best-price math.
 */
export type PriceCellState = 'Best' | 'Normal' | 'Higher' | 'Not comparable' | 'Pending'

const BOX: Record<PriceCellState, string> = {
  Best: 'bg-[var(--color-bg-success)] border-[var(--color-border-success)]',
  Normal: 'bg-[var(--color-bg-surface)] border-[var(--color-border-default)]',
  Higher: 'bg-[var(--color-bg-surface)] border-[var(--color-border-default)]',
  'Not comparable': 'bg-[var(--color-bg-neutral)] border-[var(--color-border-default)]',
  Pending: 'bg-[var(--color-bg-surface)] border-[var(--color-border-default)]',
}
const DELTA: Record<PriceCellState, string> = {
  Best: 'var(--color-text-success)',
  Normal: 'var(--color-text-warning)',
  Higher: 'var(--color-text-danger)',
  'Not comparable': 'var(--color-text-secondary)',
  Pending: 'var(--color-text-tertiary)',
}

/** `fluid`: fills its container (phone cards) instead of the 176px table cell. */
export function PriceCell({ state, price, delta, fluid, className }: { state: PriceCellState; price?: string | null; delta: string; fluid?: boolean; className?: string }) {
  return (
    <div className={cx('flex flex-col items-start gap-1 rounded-[var(--radius-md)] border px-4 py-3 text-start', fluid ? 'w-full min-w-0' : 'w-[176px]', BOX[state], className)}>
      {state === 'Pending' ? (
        <>
          <p className="text-[14px] leading-[22px] font-medium text-[var(--color-text-tertiary)]">{delta}</p>
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-tertiary)]">—</p>
        </>
      ) : (
        <>
          <p className="font-[family-name:var(--font-display)] text-[16px] leading-[24px] font-semibold tabular-nums whitespace-nowrap" style={{ color: state === 'Not comparable' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)' }}>{price}</p>
          <div className="flex w-full items-center gap-1">
            <p className="min-w-0 flex-1 text-[12px] leading-[18px] font-medium" style={{ color: DELTA[state] }}>{delta}</p>
            {state === 'Best' ? <Icon name="check-circle" size={14} style={{ color: 'var(--color-icon-success)' }} /> : state === 'Not comparable' ? <Icon name="alert" size={14} style={{ color: 'var(--color-icon-secondary)' }} /> : null}
          </div>
        </>
      )}
    </div>
  )
}
