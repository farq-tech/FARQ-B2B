import { useEffect, useRef } from 'react'
import { LiveEngine, type Tone } from './engine'
import './live-bg.css'

type Props = {
  tone?: Tone
  /** false = fill the nearest positioned parent instead of the viewport (dev page). */
  fixed?: boolean
  /** Dev only: force reduced motion regardless of the OS setting. */
  reducedMotion?: boolean
  onEngine?: (e: LiveEngine | null) => void
  /** Element whose children the network keeps clear of (default: the whole page). */
  scope?: Element | null
}

export default function LiveBackgroundCanvas({ tone = 'light', fixed = true, reducedMotion, onEngine, scope }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const bg = useRef<HTMLCanvasElement>(null)
  const fx = useRef<HTMLCanvasElement>(null)
  const engine = useRef<LiveEngine | null>(null)

  useEffect(() => {
    if (!host.current || !bg.current || !fx.current) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const e = new LiveEngine(host.current, bg.current, fx.current, { tone, reduced: reducedMotion ?? mq.matches, scope: scope ?? undefined })
    engine.current = e
    onEngine?.(e)
    // QA hook in dev builds only: window.__liveBg.app.stats() / .simulate(100)
    if (import.meta.env.DEV && fixed) ((window as unknown as { __liveBg?: Record<string, LiveEngine> }).__liveBg ??= {}).app = e
    const onMq = () => { if (reducedMotion === undefined) e.setReduced(mq.matches) }
    mq.addEventListener('change', onMq)
    if (fixed) document.documentElement.classList.add('has-live-bg')
    return () => {
      mq.removeEventListener('change', onMq)
      if (fixed) document.documentElement.classList.remove('has-live-bg')
      e.destroy(); engine.current = null; onEngine?.(null)
    }
    // tone/fixed rebuild the engine; reducedMotion is applied in place below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone, fixed, scope])

  useEffect(() => {
    const e = engine.current
    if (e) e.setReduced(reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [reducedMotion])

  return (
    <div ref={host} className={fixed ? 'live-bg' : 'live-bg live-bg--local'} data-tone={tone === 'light' ? undefined : tone} aria-hidden="true">
      <canvas ref={bg} />
      <canvas ref={fx} />
    </div>
  )
}
