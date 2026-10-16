import { Icon, useNow } from '../../ui'
import { cityCoords, ksaClock, nextAllowedSend, PRAYER_AR, quietWindowAt, RIYADH, suggestedSendWindow, type LatLon } from '../../lib/saudi'

/*
 * The Saudi rhythm beside the send step: a quiet note during a prayer window (sends wait there: server.py holds
 * /send-farq until 25 minutes after the prayer, and on Friday 11:30–13:30), «وضع رمضان» with the after-taraweeh
 * window in Ramadan, otherwise the usual best window. Prayer times use the chosen city (Riyadh until one is chosen).
 */
export function sendPlace(city: string | null | undefined): LatLon {
  return cityCoords(city) || RIYADH
}

export default function SendTiming({ city, onDark = false, className = '' }: { city?: string | null; onDark?: boolean; className?: string }) {
  const now = useNow(30_000)
  const where = sendPlace(city)
  const w = quietWindowAt(now, where)
  const win = suggestedSendWindow(now)
  const muted = onDark ? 'text-[var(--color-text-on-inverse-secondary)]' : 'text-[var(--color-text-secondary)]'
  return (
    <div className={`flex flex-col gap-1 text-[12px] leading-[18px] ${className}`} data-testid="send-timing">
      {w ? (
        <p role="status" className={`flex items-start gap-1.5 font-medium ${onDark ? 'text-[var(--color-text-on-inverse)]' : 'text-[var(--color-text-primary)]'}`}>
          <Icon name="clock" size={14} className="mt-0.5 shrink-0" />
          <span>الردود قد تتأخر وقت الصلاة. الإرسال ينتظر صلاة {PRAYER_AR[w.prayer]}، ويفتح الساعة <bdi>{ksaClock(nextAllowedSend(now, where))}</bdi>.</span>
        </p>
      ) : null}
      <p className={`flex flex-wrap items-center gap-1.5 ${muted}`}>
        {win.ramadan ? <span className={`rounded-full px-2 font-medium ${onDark ? 'bg-[var(--color-bg-surface)]/15 text-[var(--color-text-on-inverse)]' : 'bg-[var(--color-bg-surface-2)] text-[var(--color-text-primary)]'}`}>وضع رمضان</span> : null}
        <span>{win.label}</span>
      </p>
    </div>
  )
}
