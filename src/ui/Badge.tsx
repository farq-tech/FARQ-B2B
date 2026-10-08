import { cx } from './cx'
import { Icon, type IconName } from './Icon'

/*
 * Badge — Figma «Badge» (18:41). Tone: Success · Warning · Danger · Info · Neutral.
 * Success = quote received, Warning = waiting/review, Danger = declined/unreachable,
 * Info = sent, Neutral = no reply. RTL: the dot sits on the start (right).
 */
export type BadgeTone = 'Success' | 'Warning' | 'Danger' | 'Info' | 'Neutral'

const TONE: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  Success: { bg: 'var(--color-bg-success)', fg: 'var(--color-text-success)', dot: 'var(--color-icon-success)' },
  Warning: { bg: 'var(--color-bg-warning)', fg: 'var(--color-text-warning)', dot: 'var(--color-icon-warning)' },
  Danger: { bg: 'var(--color-bg-danger)', fg: 'var(--color-text-danger)', dot: 'var(--color-icon-danger)' },
  Info: { bg: 'var(--color-bg-info)', fg: 'var(--color-text-info)', dot: 'var(--color-icon-info)' },
  Neutral: { bg: 'var(--color-bg-neutral)', fg: 'var(--color-text-neutral)', dot: 'var(--color-icon-secondary)' },
}

export function Badge({ tone = 'Neutral', label, showDot = true, className }: { tone?: BadgeTone; label: string; showDot?: boolean; className?: string }) {
  const t = TONE[tone]
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[14px] leading-[22px] font-medium whitespace-nowrap', className)} style={{ background: t.bg, color: t.fg }}>
      {showDot ? <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: t.dot }} /> : null}
      {label}
    </span>
  )
}

/* Evidence Badge — Figma (18:57). Why this supplier was matched. Show ONLY from a real API field. */
export type EvidenceLevel = 'Strong' | 'Medium' | 'Weak'
const EVIDENCE: Record<EvidenceLevel, { bg: string; fg: string; icon: IconName; label: string }> = {
  Strong: { bg: 'var(--color-bg-success)', fg: 'var(--color-text-success)', icon: 'check-circle', label: 'سبق سعّر نفس البند' },
  Medium: { bg: 'var(--color-bg-info)', fg: 'var(--color-text-info)', icon: 'layers', label: 'يبيع نفس الفئة' },
  Weak: { bg: 'var(--color-bg-neutral)', fg: 'var(--color-text-neutral)', icon: 'info', label: 'مطابقة تقديرية' },
}
export function EvidenceBadge({ level, label, className }: { level: EvidenceLevel; label?: string; className?: string }) {
  const e = EVIDENCE[level]
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] leading-[18px] font-medium whitespace-nowrap', className)} style={{ background: e.bg, color: e.fg }}>
      <Icon name={e.icon} size={14} />
      {label || e.label}
    </span>
  )
}

/*
 * Channel Badge — Figma (18:73). Channel: WhatsApp · Email · Unreachable.
 * «Haraj» is not in Figma; it is a real channel in the API, so it renders in the neutral style.
 */
export type Channel = 'WhatsApp' | 'Email' | 'Unreachable' | 'Haraj'
const CHANNEL: Record<Channel, { bg: string; fg: string; icon: IconName | null; label: string }> = {
  WhatsApp: { bg: 'var(--color-bg-success)', fg: 'var(--color-text-success)', icon: 'whatsapp', label: 'واتساب' },
  Email: { bg: 'var(--color-bg-info)', fg: 'var(--color-text-info)', icon: 'mail', label: 'إيميل' },
  Unreachable: { bg: 'var(--color-bg-neutral)', fg: 'var(--color-text-tertiary)', icon: 'x-circle', label: 'لا يمكن الإرسال' },
  Haraj: { bg: 'var(--color-bg-neutral)', fg: 'var(--color-text-secondary)', icon: null, label: 'حراج' },
}
export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const c = CHANNEL[channel]
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] leading-[18px] font-medium whitespace-nowrap', className)} style={{ background: c.bg, color: c.fg }}>
      {c.icon ? <Icon name={c.icon} size={14} /> : null}
      {c.label}
    </span>
  )
}

/** Maps the API's preferred-channel code to a Channel Badge value (null = no badge). */
export function channelFromApi(code: string | null | undefined): Channel | null {
  return code === 'WHATSAPP' ? 'WhatsApp' : code === 'EMAIL' ? 'Email' : code === 'HARAJ' ? 'Haraj' : null
}
