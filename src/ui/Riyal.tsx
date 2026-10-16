import type { ReactNode } from 'react'
import { cx } from './cx'

/*
 * The Saudi riyal sign (SAMA, 2025; Unicode U+20C1). The app's fonts (Huwiya, Tajawal/Readex fallback) have no glyph
 * for U+20C1 yet, so the sign is drawn inline: the glyph outline of the open «Saudi Riyal Font»
 * (github.com/emran-alhaddad/Saudi-Riyal-Font, OFL-1.1), in currentColor, sized to the text.
 * Screen readers read «ريال سعودي». When the fonts gain U+20C1, swap the svg for the character.
 */
const PATH = 'M750,1119C730,1163,716,1211,711,1262L1136,1172C1156,1127,1169,1079,1174,1028Z'
  + 'M1136,901C1156,857,1169,809,1174,758L843,828L843,693L1136,631C1156,587,1169,538,1174,488L843,558L843,72C793,100,748,138,711,183L711,586L579,614L579,6C528,34,483,72,447,117L447,642L151,705C131,750,117,798,112,849L447,777L447,948L88,1024C68,1068,55,1117,50,1167L425,1088C456,1081,482,1063,499,1038L568,936C575,926,579,913,579,899L579,749L711,721L711,992Z'

export function RiyalSign({ className }: { className?: string }) {
  return (
    <svg role="img" aria-label="ريال سعودي" viewBox="0 0 1256 1270" fill="currentColor" className={cx('inline-block h-[0.82em] w-[0.82em] shrink-0 align-[-0.06em]', className)}>
      <path d={PATH} />
    </svg>
  )
}

export type VatBasis = 'incl' | 'excl'
export const VAT_NOTE: Record<VatBasis, string> = { incl: 'شامل الضريبة ١٥٪', excl: 'قبل الضريبة' }

/** «12,500.00» with the riyal sign after the number (Arabic order), digits kept left-to-right. */
export const formatSar = (v: number, decimals = 2) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/**
 * A price: number + riyal sign, and — when the basis is known — «شامل الضريبة ١٥٪» or «قبل الضريبة».
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
