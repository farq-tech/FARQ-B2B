import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../../../ui/Icon'
import { cx } from '../../../ui/cx'

/*
 * Hero visual (owner brief §3): طلب الشركة ← فرق تسعير ← الموردون ← عروض الأسعار ← المقارنة, readable without the
 * small text. One loop of five stages (≈9 s); each stage lights up in turn and the previous ones stay lit.
 * An illustration (labelled): no real supplier, no real price. prefers-reduced-motion = the last stage, still.
 */

const SUPPLIERS: { icon: IconName; label: string; price: string }[] = [
  { icon: 'whatsapp', label: 'مورد 1', price: '7,850' },
  { icon: 'mail', label: 'مورد 2', price: '8,200' },
  { icon: 'phone', label: 'مورد 3', price: '7,200' },
  { icon: 'message', label: 'مورد 4', price: '9,100' },
]
const STAGE_MS = [1600, 1600, 2000, 2000, 2400]

export default function JourneySim({ className }: { className?: string }) {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const [stage, setStage] = useState(reduce ? 4 : 0)
  useEffect(() => {
    if (reduce) return
    let alive = true, t: number | undefined
    const next = (s: number) => { if (!alive) return; setStage(s); t = window.setTimeout(() => next((s + 1) % 5), STAGE_MS[s]) }
    next(0)
    const onVis = () => { if (document.hidden) window.clearTimeout(t); else next(0) }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; window.clearTimeout(t); document.removeEventListener('visibilitychange', onVis) }
  }, [reduce])

  const on = (s: number) => stage >= s
  const node = 'rounded-[var(--radius-lg)] border bg-[var(--color-bg-surface)] transition-[border-color,box-shadow,opacity,transform] duration-500 motion-reduce:transition-none'
  return (
    <figure aria-label="محاكاة توضيحية: الطلب يروح للموردين والعروض ترجع للمقارنة" style={{ background: 'var(--ld-gradient)' }} className={cx('relative isolate flex flex-col gap-[var(--space-12)] rounded-[var(--radius-xl)] border border-[var(--color-border-default)] p-[var(--space-16)] shadow-[var(--elevation-lg)] sm:p-[var(--space-24)]', className)}>
      {/* 1 · the company's request */}
      <div className={cx(node, 'flex items-center gap-[var(--space-12)] p-[var(--space-12)]', on(0) ? 'border-[var(--color-border-primary)] shadow-[var(--glow-primary)]' : 'border-[var(--color-border-default)]')}>
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)]"><Icon name="building" size={20} /></span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">طلب الشركة</span>
          <span className="truncate text-[15px] font-medium leading-[24px]">20 كرسي انتظار — عيادة بالرياض</span>
        </span>
      </div>
      <Connector lit={on(1)} />
      {/* 2 · Farq */}
      <div className={cx(node, 'mx-auto flex items-center gap-[var(--space-8)] px-[var(--space-16)] py-[var(--space-8)]', on(1) ? 'border-[var(--color-border-primary)] shadow-[var(--glow-primary)]' : 'border-[var(--color-border-default)] opacity-60')}>
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--color-bg-brand)] text-[var(--color-text-on-brand)]"><Icon name="bolt" size={16} /></span>
        <span className="text-[15px] font-semibold">فرق يتواصل مع الموردين</span>
      </div>
      <Connector lit={on(2)} />
      {/* 3 · suppliers, each reached in its own channel — 4 · their offers come back */}
      <ul className="grid grid-cols-4 gap-[var(--space-8)]">
        {SUPPLIERS.map((s, i) => (
          <li key={s.label} className={cx(node, 'flex flex-col items-center gap-[var(--space-4)] p-[var(--space-8)] text-center',
            on(2) ? 'border-[var(--color-border-strong)]' : 'border-[var(--color-border-default)] opacity-50',
            on(4) && i === 0 && 'border-[var(--color-border-primary)] shadow-[var(--glow-primary)]')}
            style={{ transitionDelay: on(2) && !on(3) ? `${i * 120}ms` : undefined }}>
            <span className={cx('inline-flex size-8 items-center justify-center rounded-full', on(2) ? 'bg-[var(--color-bg-primary-subtle)] text-[var(--color-icon-primary)]' : 'bg-[var(--color-bg-surface-2)] text-[var(--color-icon-secondary)]')}><Icon name={s.icon} size={16} /></span>
            <span className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{s.label}</span>
            <span className={cx('font-display text-[14px] font-semibold tabular-nums leading-[20px] transition-[opacity,transform] duration-500', on(3) ? 'opacity-100' : 'translate-y-1 opacity-0')}
              style={{ transitionDelay: on(3) && !on(4) ? `${i * 160}ms` : undefined }}>{s.price}</span>
          </li>
        ))}
      </ul>
      <Connector lit={on(4)} />
      {/* 5 · comparison */}
      <div className={cx(node, 'flex items-center justify-between gap-[var(--space-12)] p-[var(--space-12)]', on(4) ? 'border-[var(--color-border-primary)] shadow-[var(--glow-primary)]' : 'border-[var(--color-border-default)] opacity-60')}>
        <span className="flex flex-col">
          <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">الأنسب حسب المواصفات</span>
          <span className="text-[15px] font-semibold">مورد 1 · التوريد خلال 5 أيام</span>
        </span>
        <span className="flex flex-col items-end">
          <span className="font-display text-[22px] font-bold tabular-nums text-[var(--ld-accent-light)]">7,850 ر.س</span>
          <span className="text-[12px] text-[var(--color-text-secondary)]">شامل التوصيل</span>
        </span>
      </div>
      <figcaption className="text-center text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">مثال توضيحي</figcaption>
    </figure>
  )
}

function Connector({ lit }: { lit: boolean }) {
  return (
    <span aria-hidden="true" className="relative mx-auto block h-5 w-px overflow-hidden bg-[var(--color-border-default)]">
      <span className={cx('absolute inset-x-0 top-0 h-full origin-top bg-[var(--ld-accent)] transition-transform duration-500 motion-reduce:transition-none', lit ? 'scale-y-100' : 'scale-y-0')} />
    </span>
  )
}
