import type { ReactNode } from 'react'
import { cx, FOCUS_RING } from './cx'
import { Badge, type BadgeTone } from './Badge'

/*
 * List Row — Figma «Farq B2B / Row (from Foodie Views / Tables)» (18390:54), RTL.
 * Type: Entity (initial + title + caption + value) · Total (title + value) · Entity Badge (value is a status).
 * Min height 64, padding 24/12, 44px+ hit area when it is a button.
 */
type ListRowProps = {
  title: ReactNode
  caption?: ReactNode
  /** Letter for the round avatar (Entity / Entity Badge). Omit for no avatar. */
  initial?: string
  value?: ReactNode
  status?: { tone: BadgeTone; label: string }
  onClick?: () => void
  className?: string
  /** Extra content under the caption (e.g. a delivery timeline). */
  children?: ReactNode
}

export function ListRow({ title, caption, initial, value, status, onClick, className, children }: ListRowProps) {
  const body = (
    <>
      {initial ? <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-primary-subtle)] text-[16px] font-medium text-[var(--color-text-primary)]">{initial}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start">
        <span className="max-w-full text-[16px] leading-[26px] font-medium text-[var(--color-text-primary)]">{title}</span>
        {caption ? <span className="max-w-full text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{caption}</span> : null}
        {children}
      </span>
      {status ? <Badge tone={status.tone} label={status.label} showDot={false} /> : null}
      {value != null ? <span className="shrink-0 text-[16px] leading-[26px] font-medium text-[var(--color-text-primary)] tabular-nums">{value}</span> : null}
    </>
  )
  const cls = cx('flex min-h-16 w-full items-center gap-3 bg-[var(--color-bg-surface)] px-6 py-3', className)
  if (onClick) return <button type="button" onClick={onClick} className={cx(cls, 'text-start hover:bg-[var(--color-bg-primary-subtle)]', FOCUS_RING)}>{body}</button>
  return <div className={cls}>{body}</div>
}

/** Section heading above a group of rows (Figma «يحتاج قرارك (2)»). */
export function ListSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-semibold text-[var(--color-text-primary)]">{title}{count != null ? <> (<bdi dir="ltr">{count}</bdi>)</> : null}</h2>
      <div className="flex flex-col divide-y divide-[var(--color-border-default)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-default)]">{children}</div>
    </section>
  )
}
