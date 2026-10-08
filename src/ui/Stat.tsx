import { cx } from './cx'

/*
 * Stat — Figma «Stat» (24:145). Tone: Neutral · Success · Warning · Danger.
 * The basis line always states how the number is derived.
 */
export type StatTone = 'Neutral' | 'Success' | 'Warning' | 'Danger'
const VALUE: Record<StatTone, string> = {
  Neutral: 'var(--color-text-primary)',
  Success: 'var(--color-text-success)',
  Warning: 'var(--color-text-warning)',
  Danger: 'var(--color-text-danger)',
}

export function Stat({ label, value, basis, tone = 'Neutral', className }: { label: string; value: number | string; basis: string; tone?: StatTone; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col items-start gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-5 py-4 text-start', className)}>
      <p className="w-full text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)]">{label}</p>
      <p className="font-[family-name:var(--font-display)] text-[28px] leading-[40px] font-semibold tabular-nums" style={{ color: VALUE[tone] }}>{value}</p>
      <p className="w-full text-[12px] leading-[18px] font-medium text-[var(--color-text-tertiary)]">{basis}</p>
    </div>
  )
}
