import { useEffect, useRef, useState } from 'react'
import { COUNTERS, type Counters as CounterValues } from './model'

/*
 * Live counters strip above the map (owner 2026-10-16): numbers count up / down to the visible cohort,
 * ease-out over ≤ 700 ms, instant under reduced motion. «المنشآت» is the dark lead tile.
 */
const fmt = (v: number) => Math.round(v).toLocaleString('en-US')
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function Rolling({ value }: { value: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const frame = useRef(0)
  useEffect(() => {
    const start = from.current
    if (start === value) return
    if (reduced()) { from.current = value; setShown(value); return }
    const t0 = performance.now(), dur = 700
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3)
      const v = start + (value - start) * e
      from.current = v
      setShown(v)
      if (k < 1) frame.current = requestAnimationFrame(step)
      else from.current = value
    }
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [value])
  return <>{fmt(shown)}</>
}

export default function Counters({ values, compact = false }: { values: CounterValues; compact?: boolean }) {
  return (
    <section aria-label="عدادات الخريطة" className={compact ? '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1' : 'grid grid-cols-8 gap-2'}>
      {COUNTERS.map((c) => (
        <div key={c.key} data-counter={c.key}
          className={`relative flex shrink-0 flex-col rounded-[12px] border ${compact ? 'px-3' : 'px-2.5'} py-1.5 ${compact ? 'min-w-[76px]' : 'min-w-0'} ${c.lead ? 'border-[var(--map-ink)] bg-[var(--map-ink)] text-white' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)]'}`}>
          <span className={`font-[family-name:var(--font-display)] ${compact ? 'text-[17px] leading-[24px]' : 'text-[20px] leading-[28px]'} font-semibold tabular-nums`} aria-hidden>
            <Rolling value={values[c.key]} />
          </span>
          <span className={`${compact ? 'text-[12px] leading-[18px]' : 'text-[11px] leading-[16px]'} ${c.lead ? 'text-white/80' : 'text-[var(--color-text-secondary)]'}`}>
            <span className="sr-only">{fmt(values[c.key])} </span>{c.label}
          </span>
        </div>
      ))}
    </section>
  )
}
