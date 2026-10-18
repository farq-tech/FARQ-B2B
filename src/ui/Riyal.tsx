import type { ReactNode } from 'react'
import { cx } from './cx'

/*
 * The riyal sign has ONE implementation: the official SAMA shape in ./icons/RiyalSign (U+20C1, drawn inline because the
 * app's fonts have no glyph for it yet). This module re-exports it so `RiyalSign` from './Riyal' and from './icons' are
 * the same component — every screen shows the identical sign. Money / VatTag / formatSar build on it.
 */
import { RiyalSign } from './icons/RiyalSign'
export { RiyalSign }

export type VatBasis = 'incl' | 'excl'
export const VAT_NOTE: Record<VatBasis, string> = { incl: 'شامل الضريبة 15%', excl: 'قبل الضريبة' }

/** «12,500.00» with the riyal sign after the number (Arabic order), digits kept left-to-right. */
export const formatSar = (v: number, decimals = 2) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/**
 * A price: number + riyal sign, and — when the basis is known — «شامل الضريبة 15%» or «قبل الضريبة».
 * `vat` null = the source does not say (nothing is claimed).
 */
export function Money({ amount, vat, decimals = 2, className, noteClassName, children }: { amount: number | string; vat?: VatBasis | null; decimals?: number; className?: string; noteClassName?: string; children?: ReactNode }) {
  const text = typeof amount === 'number' ? formatSar(amount, decimals) : amount
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-1.5', className)}>
      <bdi dir="ltr" className="inline-flex items-baseline gap-1 tabular-nums whitespace-nowrap"><span>{text}</span><RiyalSign /></bdi>
      {vat ? <VatTag basis={vat} className={noteClassName} /> : null}
      {children}
    </span>
  )
}

export function VatTag({ basis, className }: { basis: VatBasis; className?: string }) {
  return <span className={cx('text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]', className)}>{VAT_NOTE[basis]}</span>
}
