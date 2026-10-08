import { cx } from './cx'

/*
 * Confidence — Figma «Confidence» (18:92). Level: High · Medium · Low.
 * Reading confidence of an extracted line: label + three rising bars.
 */
export type ConfidenceLevel = 'High' | 'Medium' | 'Low'
const LABEL: Record<ConfidenceLevel, string> = { High: 'ثقة عالية', Medium: 'ثقة متوسطة', Low: 'ثقة منخفضة — تأكد' }
const TEXT: Record<ConfidenceLevel, string> = { High: 'var(--color-text-success)', Medium: 'var(--color-text-warning)', Low: 'var(--color-text-danger)' }
const ON: Record<ConfidenceLevel, string> = { High: 'var(--color-icon-success)', Medium: 'var(--color-icon-warning)', Low: 'var(--color-icon-danger)' }
const LIT: Record<ConfidenceLevel, number> = { High: 3, Medium: 2, Low: 1 }

export function Confidence({ level, className }: { level: ConfidenceLevel; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <span aria-hidden className="flex items-end gap-0.5">
        {[6, 9, 12].map((h, i) => <span key={h} className="w-1 rounded-[1px]" style={{ height: h, background: i < LIT[level] ? ON[level] : 'var(--color-border-strong)' }} />)}
      </span>
      <span className="text-[12px] leading-[18px] font-medium whitespace-nowrap" style={{ color: TEXT[level] }}>{LABEL[level]}</span>
    </span>
  )
}
