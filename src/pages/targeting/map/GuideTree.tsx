import { useState } from 'react'
import { Icon } from '../../../ui'
import { FOCUS_RING } from '../../../ui/cx'
import { recordMapInteraction } from '../../../lib/mapAnalytics'
import { MapIcon } from './glyphs'
import { mainIcon, specialtyIcon, subIcon, type Focus, type GuideMain } from './model'

/*
 * «الدليل»: main ▸ sub ▸ specialty with counts from the chosen-district cohort (owner 2026-10-16).
 * A tap filters the map to that level and switches the map to its layer; a second tap clears it.
 */
const fmt = (n: number) => n.toLocaleString('ar-SA')

export default function GuideTree({ guide, focus, onFocus, empty }: { guide: GuideMain[]; focus: Focus; onFocus: (f: Focus) => void; empty: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggleOpen = (k: string, force?: boolean) => setOpen((s) => { const x = new Set(s); if (force ?? !x.has(k)) x.add(k); else x.delete(k); return x })
  const [q, setQ] = useState('')
  if (!guide.length) return <p className="px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{empty}</p>
  const hit = (t: string) => !q.trim() || t.includes(q.trim())
  const pick = (f: NonNullable<Focus>) => {
    const clear = Boolean(focus && focus.level === f.level && focus.id === f.id && (f.level !== 'spec' || focus.level === 'spec' && focus.sub_id === f.sub_id))
    recordMapInteraction(clear ? 'map_guide_focus_clear' : 'map_guide_focus_select')
    onFocus(clear ? null : f)
  }
  const on = (level: NonNullable<Focus>['level'], id: string, subId?: string) => Boolean(focus && focus.level === level && focus.id === id && (level !== 'spec' || focus.level === 'spec' && focus.sub_id === subId))
  const focusLabel = focus?.level === 'main'
    ? guide.find((m) => m.id === focus.id)?.ar
    : focus?.level === 'sub'
      ? guide.flatMap((m) => m.subs).find((s) => s.id === focus.id)?.ar
      : focus?.level === 'spec' ? `${focus.id}${focus.sub_id ? ` · ${guide.flatMap((m) => m.subs).find((s) => s.id === focus.sub_id)?.ar || ''}` : ''}` : null
  const rowCls = (active: boolean) => `fi-host flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-start text-[14px] leading-[22px] hover:bg-[var(--color-bg-surface-2)] ${active ? 'bg-[var(--color-bg-surface-2)] ring-1 ring-[var(--map-ink)]' : ''} ${FOCUS_RING}`

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="px-2">
        <h2 className="m-0 text-[14px] font-semibold leading-[22px]">تصفّح الأنشطة</h2>
        <p className="m-0 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">السهم يفتح الفروع. اضغط اسم النشاط لتصفية الخريطة والقائمة، والعدد يوضح المنشآت المطابقة.</p>
      </div>
      <label className="px-2">
        <span className="sr-only">ابحث في الدليل</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن نشاط أو تخصص"
          className={`w-full rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-[14px] ${FOCUS_RING}`} />
      </label>
      {focus && focusLabel ? (
        <div className="mx-2 flex items-center gap-2 rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[12px] leading-[18px]">
          <span className="min-w-0 flex-1 truncate">التصفية الحالية: <strong>{focusLabel}</strong></span>
          <button type="button" onClick={() => onFocus(null)} className={`shrink-0 font-medium text-[var(--color-text-info)] underline ${FOCUS_RING}`}>مسحها</button>
        </div>
      ) : null}
      <ul aria-label="الدليل" className="flex flex-col">
        {guide.map((m) => {
          const subs = m.subs.filter((s) => hit(m.ar) || hit(s.ar) || s.specs.some((x) => hit(x.name)))
          if (!subs.length) return null
          const mo = open.has(m.id) || Boolean(q.trim())
          return (
            <li key={m.id}>
              <div className="flex items-center">
                <button type="button" aria-expanded={mo} aria-label={`فروع ${m.ar}`} onClick={() => toggleOpen(m.id)} className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-icon-secondary)] ${FOCUS_RING}`}>
                  <Icon name="chevron-down" size={14} className={mo ? '' : 'rotate-90'} />
                </button>
                <button type="button" aria-pressed={on('main', m.id)} onClick={() => { pick({ level: 'main', id: m.id }); toggleOpen(m.id, true) }} className={rowCls(on('main', m.id))}>
                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--map-ink)] text-white"><MapIcon name={mainIcon(m.id)} size={15} /></span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{m.ar}</span>
                  <span className="text-[12px] tabular-nums text-[var(--color-text-secondary)]">{fmt(m.n)}</span>
                </button>
              </div>
              {mo ? (
                <ul className="ms-8 border-s border-[var(--color-border-default)] ps-1">
                  {subs.map((s) => {
                    const so = open.has(s.id) || (Boolean(q.trim()) && !hit(s.ar))
                    const specs = s.specs.filter((x) => hit(m.ar) || hit(s.ar) || hit(x.name))
                    return (
                      <li key={s.id}>
                        <div className="flex items-center">
                          {specs.length ? (
                            <button type="button" aria-expanded={so} aria-label={`تخصصات ${s.ar}`} onClick={() => toggleOpen(s.id)} className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--color-icon-secondary)] ${FOCUS_RING}`}>
                              <Icon name="chevron-down" size={12} className={so ? '' : 'rotate-90'} />
                            </button>
                          ) : <span className="size-7 shrink-0" />}
                          <button type="button" aria-pressed={on('sub', s.id)} onClick={() => { pick({ level: 'sub', id: s.id }); toggleOpen(s.id, true) }} className={rowCls(on('sub', s.id))}>
                            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--map-green)] text-white"><MapIcon name={subIcon(s.id)} size={13} /></span>
                            <span className="min-w-0 flex-1 truncate">{s.ar}</span>
                            <span className="text-[12px] tabular-nums text-[var(--color-text-secondary)]">{fmt(s.n)}</span>
                          </button>
                        </div>
                        {so && specs.length ? (
                          <ul className="ms-7">
                            {specs.map((x) => (
                              <li key={x.name}>
                                <button type="button" aria-pressed={on('spec', x.name, s.id)} onClick={() => pick({ level: 'spec', id: x.name, sub_id: s.id })} className={rowCls(on('spec', x.name, s.id))}>
                                  <span aria-hidden data-specialty-icon={specialtyIcon(x.name, s.id)} className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--map-navy)] text-white">
                                    <MapIcon name={specialtyIcon(x.name, s.id)} size={12} />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-[13px]">{x.name}</span>
                                  <span className="text-[12px] tabular-nums text-[var(--color-text-secondary)]">{fmt(x.n)}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
