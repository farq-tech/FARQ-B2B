import type { ReactNode } from 'react'
import { cx } from './cx'
import { Badge } from './Badge'
import { Icon, type IconName } from './Icon'

/*
 * Quote Card — Figma «Quote Card» (25:209). State: Default · New · Best.
 * New slides in from inline-end with one green pulse (400ms, ease-out-expo), never loops.
 * Facts are only what the offer actually says (no invented warranty/delivery lines).
 */
export type QuoteCardState = 'Default' | 'New' | 'Best'
export type QuoteFact = { icon: IconName; label: string }

const BOX: Record<QuoteCardState, string> = {
  Default: 'bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] shadow-[var(--elevation-sm)]',
  New: 'ui-enter-end bg-[var(--color-bg-surface)] border-[1.5px] border-[var(--color-border-success)] shadow-[var(--glow-success)]',
  Best: 'bg-[var(--color-bg-success)] border-[1.5px] border-[var(--color-border-success)] shadow-[var(--elevation-sm)]',
}

type QuoteCardProps = {
  state?: QuoteCardState
  supplier: string
  meta: string
  /** The price: pass <Money> for number + riyal sign (+ VAT basis when known). */
  amount: ReactNode
  amountNote?: string
  /** Default-state badge text, e.g. «12 من 14 بند». New/Best use Figma's fixed labels. */
  coverageLabel?: string | null
  facts?: QuoteFact[]
  className?: string
}

export function QuoteCard({ state = 'Default', supplier, meta, amount, amountNote, coverageLabel, facts = [], className }: QuoteCardProps) {
  return (
    <article className={cx('flex w-full flex-col items-start gap-4 rounded-[var(--radius-lg)] p-5 text-start', BOX[state], className)} aria-label={`عرض ${supplier}`}>
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col items-start gap-1">
          <p className="max-w-full truncate text-[16px] leading-[26px] font-medium text-[var(--color-text-primary)]">{supplier}</p>
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{meta}</p>
        </div>
        {state === 'Best' ? <Badge tone="Success" label="الأفضل" /> : state === 'New' ? <Badge tone="Info" label="جديد" /> : coverageLabel ? <Badge tone="Neutral" label={coverageLabel} /> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <div className="font-[family-name:var(--font-display)] text-[28px] leading-[40px] font-semibold tabular-nums whitespace-nowrap text-[var(--color-text-primary)]">{amount}</div>
        {amountNote ? <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{amountNote}</p> : null}
      </div>
      {facts.length ? (
        <ul className="flex flex-wrap items-center gap-4 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
          {facts.map((f) => <li key={f.label} className="inline-flex items-center gap-1"><Icon name={f.icon} size={16} />{f.label}</li>)}
        </ul>
      ) : null}
    </article>
  )
}
