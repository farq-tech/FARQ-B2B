import { useEffect, useState } from 'react'
import { cx, FOCUS_RING } from './cx'
import { Badge } from './Badge'
import { Icon } from './Icon'
import { gregorianLabel, hijriLabel, greeting, occasionOn, isSaudiEstablishment, type LocalEvidence } from '../lib/saudi'

/* Small Saudi touches shared by the screens: dual dates, the «منشأة سعودية» badge, greeting, occasions banner. */

/** Gregorian date with the Hijri date beside it (Umm al-Qura). `stack` puts the Hijri date on its own line. */
export function DualDate({ value, stack = false, className }: { value: Date | string | number | null | undefined; stack?: boolean; className?: string }) {
  if (value == null || value === '') return null
  const g = gregorianLabel(value)
  if (!g) return null
  return (
    <span className={cx(stack ? 'inline-flex flex-col' : 'inline', className)}>
      <span>{g}</span>
      <span className="text-[var(--color-text-tertiary)]">{stack ? '' : ' · '}{hijriLabel(value)}</span>
    </span>
  )
}

/** «منشأة سعودية» — only when the record carries a CR, a Saudi trade licence or a registry source. */
export function SaudiEstablishmentBadge({ evidence, className }: { evidence: LocalEvidence | null | undefined; className?: string }) {
  if (!isSaudiEstablishment(evidence)) return null
  return <Badge tone="Neutral" showDot={false} label="منشأة سعودية" className={cx('text-[12px] leading-[18px]', className)} />
}

/** The current Saudi time of day, re-read every minute. */
export function useNow(stepMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), stepMs); return () => window.clearInterval(t) }, [stepMs])
  return now
}

/** «صباح الخير» / «مساء النور», with the name when there is one. */
export function Greeting({ name, className }: { name?: string | null; className?: string }) {
  const now = useNow()
  return <p className={cx('text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)]', className)}>{greeting(now)}{name ? `، ${name}` : ''}</p>
}

/** Dismissed occasion, in memory for this tab only (nothing on the device): it may show again on the next visit. */
let dismissedOccasion: string | null = null
/** A quiet, dismissible greeting on Eid al-Fitr, Eid al-Adha, National Day and Founding Day. No flag, emblem or imagery. */
export function OccasionBanner({ at, className }: { at?: Date; className?: string }) {
  const now = useNow()
  const occasion = occasionOn(at || now)
  const [dismissed, setDismissed] = useState<string | null>(() => dismissedOccasion)
  if (!occasion || dismissed === occasion.id) return null
  const close = () => { setDismissed(occasion.id); dismissedOccasion = occasion.id }
  return (
    <aside aria-label={occasion.title} className={cx('flex items-center justify-between gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-2 text-[14px] leading-[22px]', className)}>
      <p className="min-w-0"><span className="font-semibold">{occasion.title}</span> <span className="text-[var(--color-text-secondary)]">{occasion.text}</span></p>
      <button type="button" aria-label="إخفاء التهنئة" onClick={close} className={cx('shrink-0 rounded-full p-1 text-[var(--color-icon-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}><Icon name="x" size={16} /></button>
    </aside>
  )
}
