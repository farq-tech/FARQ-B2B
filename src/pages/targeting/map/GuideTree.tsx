import { useRef, useState } from 'react'
import { Button, Icon } from '../../../ui'
import { FOCUS_RING } from '../../../ui/cx'
import { recordMapInteraction } from '../../../lib/mapAnalytics'
import { formatNumber } from '../../../lib/formatNumber'
import { MapIcon } from './glyphs'
import { mainIcon, specialtyIcon, subIcon, type Focus, type GuideMain } from './model'
import { MAINS, SUBS } from './taxonomy.data'

/*
 * «الدليل»: main ▸ sub ▸ specialty with counts from the chosen-district cohort (owner 2026-10-16).
 * A tap filters the map to that level and switches the map to its layer; a second tap clears it.
 */
const fmt = (n: number) => formatNumber(n)
const normalizeSearchText = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ؤ/g, 'و')
  .replace(/ئ/g, 'ي')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .toLocaleLowerCase('ar')

const focusFirstGuideOption = (input: HTMLInputElement) => {
  input.closest<HTMLElement>('[data-map-guide-root]')
    ?.querySelector<HTMLButtonElement>('[aria-pressed]')
    ?.focus()
}

export default function GuideTree({ guide, focus, onFocus, empty, mobile = false }: { guide: GuideMain[]; focus: Focus; onFocus: (f: Focus) => void; empty: string; mobile?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggleOpen = (k: string, force?: boolean) => setOpen((s) => { const x = new Set(s); if (force ?? !x.has(k)) x.add(k); else x.delete(k); return x })
  const [q, setQ] = useState('')
  const searchUsed = useRef(false)
  const updateSearch = (value: string) => {
    if (value.trim() && !searchUsed.current) {
      searchUsed.current = true
      recordMapInteraction('map_guide_search_used')
    }
    setQ(value)
  }
  if (!guide.length && !mobile) return <p className="px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{empty}</p>
  const normalizedQuery = normalizeSearchText(q.trim())
  const hit = (t: string) => !normalizedQuery || normalizeSearchText(t).includes(normalizedQuery)
  const pick = (f: NonNullable<Focus>) => {
    const clear = Boolean(focus && focus.level === f.level && focus.id === f.id && (f.level !== 'spec' || focus.level === 'spec' && focus.sub_id === f.sub_id))
    const selectionEvent = f.level === 'main'
      ? 'map_guide_main_select'
      : f.level === 'sub' ? 'map_guide_sub_select' : 'map_guide_spec_select'
    recordMapInteraction(clear ? 'map_guide_focus_clear' : selectionEvent)
    onFocus(clear ? null : f)
  }
  const on = (level: NonNullable<Focus>['level'], id: string, subId?: string) => Boolean(focus && focus.level === level && focus.id === id && (level !== 'spec' || focus.level === 'spec' && focus.sub_id === subId))
  const focusLabel = focus?.level === 'main'
    ? guide.find((m) => m.id === focus.id)?.ar
    : focus?.level === 'sub'
      ? guide.flatMap((m) => m.subs).find((s) => s.id === focus.id)?.ar
      : focus?.level === 'spec' ? `${focus.id}${focus.sub_id ? ` · ${guide.flatMap((m) => m.subs).find((s) => s.id === focus.sub_id)?.ar || ''}` : ''}` : null
  const rowCls = (active: boolean) => `fi-host flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-start text-[14px] leading-[22px] hover:bg-[var(--color-bg-surface-2)] ${active ? 'bg-[var(--color-bg-surface-2)] ring-1 ring-[var(--map-ink)]' : ''} ${FOCUS_RING}`

  if (mobile) {
    const activeMainId = focus?.level === 'main' ? focus.id
      : focus?.level === 'sub' ? focus.id.split('.')[0]
      : focus?.level === 'spec' ? (focus.sub_id || '').split('.')[0] : ''
    const activeMain = activeMainId
      ? guide.find((item) => item.id === activeMainId) || { id: activeMainId, ar: MAINS[activeMainId]?.[0] || activeMainId, n: 0, subs: [] }
      : null
    const knownSubs = activeMain ? Object.entries(SUBS)
      .filter(([id]) => id.startsWith(`${activeMain.id}.`) && id !== `${activeMain.id}.?`)
      .map(([id, [ar]]) => ({ id, ar, data: activeMain.subs.find((item) => item.id === id) }))
      .filter((item) => hit(item.ar) || item.data?.specs.some((spec) => hit(spec.name))) : []
    const activeSubId = focus?.level === 'sub' ? focus.id : focus?.level === 'spec' ? focus.sub_id || '' : ''
    const activeSub = activeMain?.subs.find((item) => item.id === activeSubId)
    const specialties = activeSub?.specs.filter((item) => hit(item.name)) || []
    const mainCatalog = guide.length ? guide : Object.entries(MAINS).map(([id, [ar]]) => ({ id, ar, n: 0, subs: [] }))
    const mainOptions = mainCatalog.filter((item) => hit(item.ar) || item.subs.some((sub) => hit(sub.ar) || sub.specs.some((spec) => hit(spec.name))))
    const compactRow = (label: string, count: number | undefined, selected: boolean, onClick: () => void, icon?: string) => (
      <Button key={label} type="button" variant="Secondary" size="S" aria-pressed={selected} onClick={onClick}
        className={`w-full min-w-0 justify-between gap-2 text-start ${selected ? '!border-[var(--map-green)] !bg-[var(--color-bg-primary-subtle)] !text-[var(--color-text-primary)]' : ''}`}>
        <span className="flex min-w-0 items-center gap-2">
          {icon ? <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-surface-2)] text-[var(--color-text-secondary)]"><MapIcon name={icon} size={12} /></span> : null}
          <span className="truncate">{label}</span>
        </span>
        {count == null ? null : <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-text-secondary)]">{fmt(count)}</span>}
      </Button>
    )
    const backFocus: Focus = focus?.level === 'spec'
      ? { level: 'sub', id: activeSubId }
      : focus?.level === 'sub' ? { level: 'main', id: activeMainId } : null

    return (
      <div data-map-guide-root className="flex flex-col gap-2 px-3 py-2">
        <div className="flex min-h-8 items-center justify-between gap-2 px-1">
          <h2 className="m-0 truncate text-[13px] font-semibold leading-[20px]">{focus?.level === 'spec' ? 'التخصصات' : focus?.level === 'sub' ? 'تخصصات النشاط الفرعي' : activeMain ? `أنشطة ${activeMain.ar}` : 'التصنيفات الرئيسية'}</h2>
          {focus ? <Button variant="Ghost" size="S" onClick={() => {
            if (backFocus) pick(backFocus)
            else { recordMapInteraction('map_guide_focus_clear'); onFocus(null) }
          }} className="shrink-0 !h-8 !px-2 text-[12px]">{backFocus ? 'رجوع' : 'كل التصنيفات'}</Button> : null}
        </div>
        <label className="px-1">
          <span className="sr-only">ابحث في الدليل</span>
          <input type="search" value={q} onChange={(e) => updateSearch(e.target.value)} onKeyDown={(event) => {
            if (event.key === 'Escape' && q) { event.preventDefault(); updateSearch('') }
            if (event.key === 'ArrowDown') { event.preventDefault(); focusFirstGuideOption(event.currentTarget) }
          }} placeholder={focus?.level === 'spec' || focus?.level === 'sub' ? 'ابحث عن تخصص' : 'ابحث عن تصنيف أو نشاط'}
            className={`h-8 w-full rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 text-[12px] ${FOCUS_RING}`} />
        </label>
        {q.trim() ? <p role="status" aria-live="polite" className="m-0 px-2 text-[11px] leading-[16px] text-[var(--color-text-secondary)]">تظهر الأنشطة والتخصصات المطابقة لعبارة البحث، ويمكنك التنقل إلى أول نتيجة بالسهم لأسفل.</p> : null}
        {focusLabel ? <p className="m-0 truncate px-2 text-[11px] leading-[16px] text-[var(--color-text-secondary)]">المحدد على الخريطة: <strong>{focusLabel}</strong></p> : null}
        <div className="flex max-h-[30dvh] flex-col gap-1 overflow-y-auto overscroll-contain px-1 pb-1" aria-label={focus ? 'خيارات التصنيف المحدد' : 'التصنيفات الرئيسية'}>
          {!focus ? mainOptions.map((item) => compactRow(item.ar, undefined, false, () => pick({ level: 'main', id: item.id }), mainIcon(item.id))) : null}
          {focus?.level === 'main' && activeMain ? knownSubs.map((item) => compactRow(item.ar, item.data?.n, false, () => pick({ level: 'sub', id: item.id }), subIcon(item.id))) : null}
          {(focus?.level === 'sub' || focus?.level === 'spec') ? specialties.map((item) => compactRow(item.name, item.n, focus?.level === 'spec' && focus.id === item.name, () => pick({ level: 'spec', id: item.name, sub_id: activeSubId }), specialtyIcon(item.name, activeSubId))) : null}
          {focus?.level === 'sub' && !specialties.length ? <p className="m-0 px-2 py-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">لا تظهر تخصصات مسجّلة لهذا النشاط الفرعي ضمن المنشآت المحمّلة. اختره لتصفية الخريطة حسب النشاط الفرعي.</p> : null}
          {focus?.level === 'spec' && !specialties.length ? <p className="m-0 px-2 py-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">لا توجد تخصصات مطابقة للبحث.</p> : null}
          {!focus && !mainOptions.length ? <p className="m-0 px-2 py-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{empty}</p> : null}
          {focus?.level === 'main' && !knownSubs.length ? <p className="m-0 px-2 py-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">لا توجد أنشطة فرعية مطابقة لهذا البحث.</p> : null}
        </div>
        <p className="m-0 px-2 text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">الاختيار يحدّث الخريطة. أعداد الفروع والتخصصات من المنشآت المحمّلة.</p>
      </div>
    )
  }

  return (
    <div data-map-guide-root className="flex flex-col gap-2 px-3 py-3">
      <div className="px-2">
        <h2 className="m-0 text-[14px] font-semibold leading-[22px]">تصفّح الأنشطة</h2>
        <p className="m-0 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">السهم يفتح الفروع. اضغط اسم النشاط لتصفية الخريطة والقائمة، والعدد يوضح المنشآت المطابقة.</p>
      </div>
      <label className="px-2">
        <span className="sr-only">ابحث في الدليل</span>
        <input type="search" value={q} onChange={(e) => updateSearch(e.target.value)} onKeyDown={(event) => {
          if (event.key === 'Escape' && q) { event.preventDefault(); updateSearch('') }
          if (event.key === 'ArrowDown') { event.preventDefault(); focusFirstGuideOption(event.currentTarget) }
        }} placeholder="ابحث عن نشاط أو تخصص"
          className={`w-full rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-[14px] ${FOCUS_RING}`} />
      </label>
      {q.trim() ? <p role="status" aria-live="polite" className="px-2 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">تظهر الأنشطة والتخصصات المطابقة لعبارة البحث، ويمكنك التنقل إلى أول نتيجة بالسهم لأسفل.</p> : null}
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
