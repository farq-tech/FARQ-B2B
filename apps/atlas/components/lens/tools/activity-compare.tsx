'use client'

import { useMemo, useState } from 'react'
import { Scale, X } from 'lucide-react'
import { NoResult } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { Explained } from '@/components/shared/explained'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import { StatTile } from '@/components/shared/stat'
import { Unavailable } from '@/components/shared/unavailable'
import { Understood, type Understanding } from '@/components/shared/understood'
import { Skeleton } from '@/components/ui/skeleton'
import { EXPLAIN } from '@/lib/explanations'
import { ltr, numberFormat, postMarket } from '@/lib/insights-api'
import type { MainActivity } from '@/lib/main-activities'
import { useStickyState, type StudiedActivity } from '@/lib/sticky-state'
import type { DistrictRow } from '../city-data'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'
import { comparePairs, sameActivity } from './tool-answers'
import { useAnswer } from './use-answer'
import { Choice } from './choice'

type Count = { district_ar: string; n: number }
type Rival = { status: 'loading' } | { status: 'error' } | { status: 'ready'; counts: Count[]; total: number | null; understood: Understanding }
type Order = 'first' | 'gap'
const SHORT_NAME = 12

/**
 * «قارن بنشاط آخر» inside «المنافسون»: a second activity's count in every district beside the studied one's, both
 * from the same district-counts reading, so a shop owner sees where one trade is present and the other is not
 * (a pharmacy with no clinic, a café with no bakery). The map stays painted with the studied activity.
 */
export function ActivityCompare({ city, rows, activities, first, firstCounts, firstTotal, onSelect, onHover }: {
  city: string
  rows: DistrictRow[]
  activities: MainActivity[]
  first: StudiedActivity
  firstCounts: Count[]
  firstTotal: number | null
  onSelect: (id: string) => void
  onHover?: (id: string | null) => void
}) {
  const [rival, setRival] = useStickyState<StudiedActivity | null>('competitors.rival', null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [order, setOrder] = useStickyState<Order>('competitors.rivalOrder', 'gap')
  // keyed by the second activity's q or main_id; an answer for an earlier city or activity never lands on the current one
  const asked = useAnswer(rival ? `${city}|${rival.q ?? ''}|${rival.main_id ?? ''}` : null, () =>
    postMarket<{ districts?: Count[]; total?: number; understood?: Understanding }>('district-counts', { city, ...(rival!.q ? { q: rival!.q } : { main_id: rival!.main_id }) }))
  const answer = useMemo<Rival | null>(() => (asked.status === 'idle' ? null
    : asked.status === 'loading' ? { status: 'loading' }
      : asked.status === 'error' || !asked.data ? { status: 'error' }
        : { status: 'ready', counts: asked.data.districts ?? [], total: typeof asked.data.total === 'number' ? asked.data.total : null, understood: asked.data.understood }),
  [asked.status, asked.data])

  const pairs = useMemo(() => (answer?.status === 'ready' ? comparePairs(rows, firstCounts, answer.counts, order) : []), [answer, firstCounts, rows, order])
  const [limit, showMore] = useShowMore(15, `${city}|${first.q ?? first.main_id}|${rival?.q ?? rival?.main_id}|${order}`)

  // the same activity as the studied one compares a list with itself (every gap 0): the picker says so instead
  const sameAs = (next: StudiedActivity) => sameActivity(next, first)
  const [same, setSame] = useState(false)
  const pick = (next: StudiedActivity) => {
    if (sameAs(next)) { setSame(true); return }
    setSame(false); setRival(next); setOpen(false); setQuery('')
  }

  if (!rival && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-base font-semibold hover:border-primary hover:text-primary">
        <Scale className="size-4" aria-hidden /> قارن «{first.label}» بنشاط آخر
      </button>
    )
  }

  if (!rival) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-base font-semibold">قارن «{first.label}» بـ</p>
          <button type="button" onClick={() => { setOpen(false); setSame(false) }} aria-label="إلغاء المقارنة" className="rounded-full p-1.5 hover:bg-muted"><X className="size-4" aria-hidden /></button>
        </div>
        <form role="search" className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (query.trim()) pick({ q: query.trim(), label: query.trim() }) }}>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setSame(false) }} aria-label="النشاط الثاني" enterKeyHint="search" autoFocus
            placeholder="اكتب النشاط الثاني: عيادة، مخبز…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
          <button type="submit" className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground">قارن</button>
        </form>
        <MainActivityPicker activities={activities} value="" placeholder="أو اختر نشاطاً رئيسياً"
          onChange={(id) => { const item = activities.find((activity) => activity.main_id === id); if (item) pick({ main_id: item.main_id, label: item.main_ar }) }} />
        {same && <p role="alert" className="text-sm text-destructive">هذا هو النشاط نفسه. اختر نشاطاً آخر لتقارن «{first.label}» به.</p>}
      </div>
    )
  }

  // the second activity kept from before became the studied one (picked above since): no comparison with itself
  if (sameAs(rival)) {
    return (
      <NoResult title={`«${rival.label}» هو النشاط المدروس الآن`} body="اختر نشاطاً ثانياً آخر لتقارنه به."
        action={<button type="button" onClick={() => { setRival(null); setOpen(true) }} className="text-sm font-semibold text-primary underline">اختر نشاطاً</button>} />
    )
  }

  // short names («صيدلية»، «عيادة») label each row's figures themselves; long ones are read once as «الأول» and «الثاني»
  const named = first.label.length <= SHORT_NAME && rival.label.length <= SHORT_NAME && first.label !== rival.label
  const firstWord = named ? first.label : 'الأول'
  const rivalWord = named ? rival.label : 'الثاني'
  const byDistrictMissing = (counts: Count[], cityTotal: number | null) => counts.length === 0 && (cityTotal ?? 0) > 0
  const missing = answer?.status !== 'ready' ? null
    : byDistrictMissing(firstCounts, firstTotal) ? first.label
      : byDistrictMissing(answer.counts, answer.total) ? rival.label : null
  const total = (value: number | null) => (value == null ? <Unavailable className="font-bold" /> : numberFormat.format(value))
  return (
    <section aria-label={`مقارنة «${first.label}» و«${rival.label}»`} className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <Explained title="مقارنة نشاطين" lines={EXPLAIN.activityCompare(first.label, rival.label)} className="text-base font-semibold">
          «{first.label}» و«{rival.label}»
        </Explained>
        <button type="button" onClick={() => setRival(null)} aria-label="أزل المقارنة" className="rounded-full p-1.5 hover:bg-muted"><X className="size-4" aria-hidden /></button>
      </div>
      {answer?.status === 'error' && <LoadError what={`منشآت «${rival.label}»`} onRetry={asked.retry} />}
      {answer?.status === 'loading' && (
        <>
          <div className="grid grid-cols-2 gap-2" aria-hidden>
            <Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" />
          </div>
          <ResultRowsSkeleton label={`جارٍ حساب «${rival.label}»`} rows={5} valueSub />
        </>
      )}
      {answer?.status === 'ready' && (
        <>
          {rival.q && <Understood value={answer.understood} />}
          <div className="grid grid-cols-2 gap-2">
            <StatTile label={`«${first.label}» في المدينة`}><p className="mt-0.5 text-xl font-bold tabular-nums">{total(firstTotal)}</p></StatTile>
            <StatTile label={`«${rival.label}» في المدينة`}><p className="mt-0.5 text-xl font-bold tabular-nums">{total(answer.total)}</p></StatTile>
          </div>
          {/* short labels, side by side from a small width up and stacked on a narrow phone, so long names never squeeze them */}
          <Choice label="ترتيب المقارنة" className="flex-col min-[380px]:flex-row" value={order} onChange={setOrder}
            options={[{ id: 'gap', label: 'حيث يزيد الأول على الثاني' }, { id: 'first', label: 'الأكثر من الأول' }]} />
          {/* the order buttons speak of «الأول» and «الثاني», so the key stays even when the rows carry the names */}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span><span className="font-semibold text-foreground">الأول</span>: {first.label}</span>
            <span><span className="font-semibold text-foreground">الثاني</span>: {rival.label}</span>
          </p>
          {missing ? (
            // a city count with no district behind it: every district would read 0, which is not what is there
            <p role="status" className="text-sm text-muted-foreground">أعداد «{missing}» حسب الحي غير متاحة الآن، فلا مقارنة بين الأحياء.</p>
          ) : pairs.length === 0 ? (
            <NoResult title="لا أحد من النشاطين في أحياء المدينة" body="جرّب نشاطاً ثانياً آخر." />
          ) : (
            <>
              <ol className="divide-y text-base lg:max-h-[40vh] lg:overflow-y-auto">
                {pairs.slice(0, limit).map((item) => (
                  <ResultRow key={item.row.id} onClick={() => onSelect(item.row.id)} onHover={(on) => onHover?.(on ? item.row.id : null)}
                    title={item.row.name}
                    // in «حيث يزيد الأول على الثاني» the list is ordered by this difference, so each row says it
                    sub={order === 'gap' ? `الفرق ${ltr(`${item.a - item.b > 0 ? '+' : item.a - item.b < 0 ? '−' : ''}${numberFormat.format(Math.abs(item.a - item.b))}`)}` : undefined}
                    // each row carries only its two figures, under the activities' own names when they are short
                    value={`${firstWord} ${numberFormat.format(item.a)}`}
                    valueSub={`${rivalWord} ${numberFormat.format(item.b)}`} />
                ))}
              </ol>
              <MoreRows shown={Math.min(limit, pairs.length)} total={pairs.length} noun="district" onMore={showMore} />
            </>
          )}
        </>
      )}
    </section>
  )
}
