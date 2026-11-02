'use client'

import { useEffect, useMemo, useState } from 'react'
import { Scale, SearchX, X } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
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
import { cn } from '@/lib/utils'
import type { DistrictRow } from '../city-data'
import { MoreRows, ResultRow, ResultRowsSkeleton, useShowMore } from '../result-row'
import { comparePairs } from './tool-answers'

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
  const [answer, setAnswer] = useState<Rival | null>(null)
  const [order, setOrder] = useStickyState<Order>('competitors.rivalOrder', 'gap')

  useEffect(() => {
    if (!rival) { setAnswer(null); return }
    // an answer for an earlier city or activity never lands on the current one
    let live = true
    setAnswer({ status: 'loading' })
    postMarket<{ districts?: Count[]; total?: number; understood?: Understanding }>('district-counts', { city, ...(rival.q ? { q: rival.q } : { main_id: rival.main_id }) })
      .then((data) => { if (live) setAnswer({ status: 'ready', counts: data.districts ?? [], total: typeof data.total === 'number' ? data.total : null, understood: data.understood }) })
      .catch(() => { if (live) setAnswer({ status: 'error' }) })
    return () => { live = false }
  }, [city, rival])

  const pairs = useMemo(() => (answer?.status === 'ready' ? comparePairs(rows, firstCounts, answer.counts, order) : []), [answer, firstCounts, rows, order])
  const [limit, showMore] = useShowMore(15, `${city}|${first.q ?? first.main_id}|${rival?.q ?? rival?.main_id}|${order}`)

  const pick = (next: StudiedActivity) => { setRival(next); setOpen(false); setQuery('') }

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
          <button type="button" onClick={() => setOpen(false)} aria-label="إلغاء المقارنة" className="rounded-full p-1.5 hover:bg-muted"><X className="size-4" aria-hidden /></button>
        </div>
        <form role="search" className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (query.trim()) pick({ q: query.trim(), label: query.trim() }) }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="النشاط الثاني" enterKeyHint="search" autoFocus
            placeholder="اكتب النشاط الثاني: عيادة، مخبز…" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" />
          <button type="submit" className="h-11 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground">قارن</button>
        </form>
        <MainActivityPicker activities={activities} value="" placeholder="أو اختر نشاطاً رئيسياً"
          onChange={(id) => { const item = activities.find((activity) => activity.main_id === id); if (item) pick({ main_id: item.main_id, label: item.main_ar }) }} />
      </div>
    )
  }

  // short names («صيدلية»، «عيادة») label each row's figures themselves; long ones are read once as «الأول» and «الثاني»
  const named = first.label.length <= SHORT_NAME && rival.label.length <= SHORT_NAME && first.label !== rival.label
  const firstWord = named ? first.label : 'الأول'
  const rivalWord = named ? rival.label : 'الثاني'
  const total = (value: number | null) => (value == null ? <Unavailable className="font-bold" /> : numberFormat.format(value))
  return (
    <section aria-label={`مقارنة «${first.label}» و«${rival.label}»`} className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <Explained title="مقارنة نشاطين" lines={EXPLAIN.activityCompare(first.label, rival.label)} className="text-base font-semibold">
          «{first.label}» و«{rival.label}»
        </Explained>
        <button type="button" onClick={() => setRival(null)} aria-label="أزل المقارنة" className="rounded-full p-1.5 hover:bg-muted"><X className="size-4" aria-hidden /></button>
      </div>
      {answer?.status === 'error' && <p role="alert" className="text-sm text-destructive">تعذر حساب «{rival.label}».</p>}
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
          <div className="flex flex-col gap-1.5 min-[380px]:flex-row" role="group" aria-label="ترتيب المقارنة">
            {([['gap', 'حيث يزيد الأول على الثاني'], ['first', 'الأكثر من الأول']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setOrder(id)} aria-pressed={order === id}
                className={cn('flex-1 rounded-lg border px-2 py-2 text-sm', order === id ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>{label}</button>
            ))}
          </div>
          {/* the order buttons speak of «الأول» and «الثاني», so the key stays even when the rows carry the names */}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span><span className="font-semibold text-foreground">الأول</span>: {first.label}</span>
            <span><span className="font-semibold text-foreground">الثاني</span>: {rival.label}</span>
          </p>
          {pairs.length === 0 ? (
            <EmptyState compact icon={SearchX} title="لا أحد من النشاطين في أحياء المدينة" body="جرّب نشاطاً ثانياً آخر." />
          ) : (
            <>
              <ol className="max-h-[40vh] divide-y overflow-y-auto text-base">
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
