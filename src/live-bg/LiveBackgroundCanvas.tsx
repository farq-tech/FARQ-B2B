import { useEffect, useRef } from 'react'
import { LiveEngine, type Mode } from './engine'
import './live-bg.css'

type Props = {
  /** story (default): the full round. ambient: mesh + pulses only, lighter. */
  mode?: Mode
  /** false = fill the nearest positioned parent instead of the viewport (dev page). */
  fixed?: boolean
  /** Dev only: force reduced motion regardless of the OS setting. */
  reducedMotion?: boolean
  onEngine?: (e: LiveEngine | null) => void
  /** Element whose children the network keeps clear of (default: the whole page). */
  scope?: Element | null
}

/**
 * The one living-background layer, used unchanged on every screen and section. It has no tone: the background
 * under it (base + facets) comes from the nearest [data-tone] around it; paths, chips, Ahmad and colours are the same.
 */
export default function LiveBackgroundCanvas({ mode = 'story', fixed = true, reducedMotion, onEngine, scope }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const bg = useRef<HTMLCanvasElement>(null)
  const fx = useRef<HTMLCanvasElement>(null)
  const engine = useRef<LiveEngine | null>(null)

  useEffect(() => {
    if (!host.current || !bg.current || !fx.current) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const e = new LiveEngine(host.current, bg.current, fx.current, { mode, reduced: reducedMotion ?? mq.matches, scope: scope ?? undefined })
    engine.current = e
    onEngine?.(e)
    // QA hook in dev builds only: window.__liveBg.app.stats() / .simulate(100)
    if (import.meta.env.DEV) {
      const w = window as unknown as { __liveBg?: Record<string, unknown> }; w.__liveBg ??= {}
      if (fixed) w.__liveBg.app = e; else (w.__liveBg.slots as Set<LiveEngine> | undefined ?? (w.__liveBg.slots = new Set<LiveEngine>()) as Set<LiveEngine>).add(e)
    }
    const onMq = () => { if (reducedMotion === undefined) e.setReduced(mq.matches) }
    mq.addEventListener('change', onMq)
    if (fixed) document.documentElement.classList.add('has-live-bg')
    return () => {
      mq.removeEventListener('change', onMq)
      if (fixed) document.documentElement.classList.remove('has-live-bg')
      e.destroy(); engine.current = null; onEngine?.(null)
    }
    // mode/fixed/scope rebuild the engine; reducedMotion is applied in place below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fixed, scope])

  useEffect(() => {
    const e = engine.current
    if (e) e.setReduced(reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [reducedMotion])

  return (
    <div ref={host} className={mode === 'page' ? 'live-bg live-bg--page' : fixed ? 'live-bg' : 'live-bg live-bg--local'} aria-hidden="true">
      <canvas ref={bg} />
      <canvas ref={fx} />
    </div>
  )
}
