'use client'

import { Fragment, useEffect, useState } from 'react'
import { useMainActivities } from '@/lib/main-activities'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { NoResult } from '@/components/shared/empty-state'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import type { Overlay } from './overlay'
import { PALETTE } from '@/lib/palette'
import { Icon3D } from '@/components/shared/icon-3d'
import { stickyHas, useStudiedActivity } from '@/lib/sticky-state'
import { Understood, type Understanding } from '@/components/shared/understood'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'

/** caveat: the service marks a district that is industrial by its atlas name, or labour housing (nine in ten residents
 * men, measured), and lists it after the residential ones; null or absent is an ordinary district. */
type Gap = { district_ar: string; population: number; businesses: number; expected_businesses: number; shortfall: number; male_pct?: number | null; caveat?: 'industrial' | 'workers' | null }
type Result = { residents_per_business: number | null; districts: Gap[]; understood?: Understanding }

const EXAMPLES = ['صيدلية', 'مغسلة ملابس', 'بقالة', 'مطعم', 'صالون حلاقة', 'مخبز']
const SURPLUS = PALETTE.pebble   // more businesses than the city rate carries
/** Short by at least one whole business, as the row reads it («ناقص 1» or more): a shortfall under half a business
 * would read «ناقص 0», so it counts as sufficient on the map and in the list alike. */
const isShort = (row: Gap) => Math.round(row.shortfall) > 0

/** «أين ينقص نشاطي؟»: districts with fewer businesses of an activity than their people carry at the city's rate. */
export function GapsTool({ city, rows, onOverlay, onSelect, selected = [], onHover }: {
  city: string
  rows: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
  /** The districts picked on the map or anywhere else: their rows are marked. */
  selected?: string[]
  /** The row under the pointer or keyboard focus, so the map can outline its district. */
  onHover?: (id: string | null) => void
}) {
  const activities = useMainActivities(city)
  // the activity is shared with the other steps, so «المنافسون» opens on the one picked here
  const [studied, setStudied] = useStudiedActivity()
  // nothing is worked out until an activity is chosen (here, in another step or by a shared link): the tool used to
  // run its default activity on arrival, alongside the page's first heavy requests, and timed out into «تعذر الحساب»
  const chosen = stickyHas('activity')
  const [query, setQuery] = useState(chosen ? studied.q ?? '' : '')
  // an activity set from elsewhere (a shared link, another step) shows in the box too
  useEffect(() => { if (stickyHas('activity')) setQuery(studied.q ?? '') }, [studied.q])
  const [result, setResult] = useState<Result | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)

  // the map is painted with the chosen activity; any other activity replaces it
  useEffect(() => {
    if (!chosen) { setResult(null); setStatus('idle'); return }
    let live = true
    // the previous activity's answer goes at once, so the map never paints it under the new activity's name
    setResult(null)
    setStatus('loading')
    const body: Record<string, unknown> = { city, min_population: 5000, limit: 200, ...(studied.q ? { q: studied.q } : { main_id: studied.main_id }) }
    // a shared link runs this while the page's first heavy requests still hold the service, and the proxy gives up
    // after 12 seconds: one quiet second try after a pause, then the error with «أعد المحاولة»
    let pause: ReturnType<typeof setTimeout> | undefined
    const load = () => postMarket<Result>('market-gaps', body)
    load()
      .catch(() => new Promise<Result>((resolve, reject) => { pause = setTimeout(() => { if (live) load().then(resolve, reject) }, 2000) }))
      .then((data) => { if (live) { setResult(data); setStatus('idle') } })
      .catch(() => { if (live) setStatus('error') })
    return () => { live = false; clearTimeout(pause) }
  }, [city, studied, chosen, attempt])

  const label = studied.label
  useEffect(() => {
    if (!result) { onOverlay({}); return }
    const ids = new Map(rows.map((row) => [row.name, row.id]))
    const short = result.districts.filter((row) => isShort(row))
    const largest = Math.max(1, ...short.map((row) => row.shortfall))
    const colors = new Map<string, string>()
    for (const row of result.districts) {
      const id = ids.get(row.district_ar)
      if (!id) continue
      colors.set(id, isShort(row) ? SHADES[Math.min(4, Math.floor((5 * row.shortfall) / (largest + 1e-9)))] : SURPLUS)
    }
    // the API returns the districts largest shortfall first, so the first short one is the top of the list; the
    // figure is isolated left to right so its «+» stays in front of it inside the Arabic line
    const top = short[0]
    const summary = result.residents_per_business == null ? null
      : top ? `${counted(short.length, 'district')} فيها نقص · الأعلى: ${top.district_ar} \u2066+${numberFormat.format(Math.round(top.shortfall))}\u2069` : 'لا نقص في أي حي'
    onOverlay({ summary, lead: top ? ids.get(top.district_ar) ?? null : null, colors, legend: { title: `نقص «${label}» في الأحياء`, from: 'نقص قليل', to: 'نقص كبير', shades: SHADES, extra: { color: SURPLUS, label: 'مكتفٍ' } } })
  }, [result, rows, onOverlay, label])

  const study = (text: string) => { if (text) setStudied({ q: text, label: text }) }

  const ids = new Map(rows.map((row) => [row.name, row.id]))
  // the service lists industrial and labour-housing districts after the residential ones; kept in that order
  const gaps = result?.districts.filter((row) => isShort(row)) ?? []
  const firstCaveat = gaps.findIndex((row) => row.caveat)
  // the bar only scales each row's shortfall, as the API returned it, against the largest in the list
  const widest = Math.max(0, ...gaps.map((row) => row.shortfall))
  const [limit, showMore] = useShowMore(20, `${city}|${label}`)

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">أين ينقص نشاطي؟</h2>
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') study(query.trim()) }}
          placeholder="اكتب نشاطك: صيدلية، مغسلة ملابس…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
        <button onClick={() => study(query.trim())} disabled={status === 'loading'} className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
          {status === 'loading' ? 'جارٍ الحساب' : 'احسب'}
        </button>
      </div>
      <MainActivityPicker activities={activities} value={studied.main_id ?? ''} placeholder="أو اختر نشاطاً رئيسياً"
        onChange={(id) => { const item = activities.find((a) => a.main_id === id); if (item) { setQuery(''); setStudied({ main_id: item.main_id, label: item.main_ar }) } }} />
      <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button key={example} onClick={() => { setQuery(example); study(example) }} className="inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm hover:border-primary hover:text-primary"><Icon3D activity={example} />{example}</button>
          ))}
        </div>
      {!chosen && status === 'idle' && <p className="text-base text-muted-foreground">اختر نشاطك لتظهر الأحياء الناقصة.</p>}
      {status === 'error' && (
        <LoadError what="النقص" title="تعذر حساب النقص الآن." detail="الخدمة مشغولة أو انقطع الاتصال. أعد المحاولة بعد لحظات."
          onRetry={() => setAttempt((value) => value + 1)} />
      )}
      {/* the shape of the answer while it is worked out: district rows, each with its bar line */}
      {status === 'loading' && <ResultRowsSkeleton rows={5} sub label="جارٍ حساب النقص" />}
      {status !== 'loading' && chosen && studied.q && result && <Understood value={result.understood} />}
      {status !== 'loading' && result && result.residents_per_business == null && <NoResult title={`لا توجد منشآت «${label}» في أحياء معروفة السكان`} body="جرّب اسماً آخر للنشاط، أو اختر نشاطاً رئيسياً." />}
      {status !== 'loading' && result && result.residents_per_business != null && (
        <>
          {/* two facts, each kept whole: on a phone the one line used to break inside «فيها نقص» */}
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-base">
            <span className="whitespace-nowrap">معدل المدينة: منشأة لكل <strong className="tabular-nums">{numberFormat.format(result.residents_per_business)}</strong> ساكن</span>
            <span className="whitespace-nowrap text-muted-foreground">{counted(gaps.length, 'district')} فيها نقص</span>
          </p>
          <ol className="max-h-[45vh] divide-y overflow-y-auto text-base" aria-label="الأحياء الأكثر نقصاً">
            {gaps.slice(0, limit).map((row, index) => {
              const id = ids.get(row.district_ar)
              const need = Math.round(row.expected_businesses)
              const tag = row.caveat === 'industrial' ? 'منطقة صناعية'
                : row.caveat === 'workers' ? (row.male_pct != null ? `${numberFormat.format(Math.round(row.male_pct))}% من سكانه رجال` : 'سكن عمال غالباً') : null
              return (
                <Fragment key={row.district_ar}>
                  {index === firstCaveat && (
                    <li className="pt-4 pb-1 text-sm text-muted-foreground">
                      <span className="block font-semibold text-foreground">مناطق صناعية أو سكن عمال</span>
                      اسمها يدل على منطقة صناعية، أو 90% فأكثر من سكانها رجال كما في سكن العمال، فنقصها بعدد السكان لا يعني طلب أسر مقيمة. لذلك تأتي بعد الأحياء السكنية.
                    </li>
                  )}
                  <ResultRow title={tag ? <>{row.district_ar} <span className="ms-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{tag}</span></> : row.district_ar}
                    active={id != null && selected.includes(id)}
                    onClick={id ? () => onSelect(id) : undefined} onHover={(on) => onHover?.(on && id ? id : null)}
                    sub={(
                      // one plain line: present · needed at the city rate · missing; the bar scales the missing count
                      // against the list's largest
                      <span className="flex flex-col gap-1">
                        <span className="tabular-nums">
                          {numberFormat.format(row.businesses)} موجودة · يحتاج {numberFormat.format(need)} · <strong className="font-semibold text-primary">ناقص {numberFormat.format(need - row.businesses)}</strong>
                        </span>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className="block h-full rounded-full bg-primary/70" style={{ width: `${widest > 0 ? (100 * row.shortfall) / widest : 0}%` }} />
                        </span>
                      </span>
                    )}
                    aside={(
                      <Explained title={`كيف حُسب «يحتاج» في ${row.district_ar}`} lines={EXPLAIN.gap(row.population, row.expected_businesses, row.businesses, result.residents_per_business as number)} className="p-2">
                        <span className="sr-only">كيف حُسب</span>
                      </Explained>
                    )} />
                </Fragment>
              )
            })}
          </ol>
          <MoreRows shown={Math.min(limit, gaps.length)} total={gaps.length} noun="district" onMore={showMore} />
        </>
      )}
    </section>
  )
}
