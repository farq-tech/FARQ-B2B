'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import { planRoute, type Point, type RoutePart, type Stop } from '@/lib/route-plan'
import { cn } from '@/lib/utils'
import type { DistrictRow } from '../city-data'
import type { Overlay } from './overlay'
import { CATEGORICAL, PALETTE as TONE } from '@/lib/palette'
import { useStickyState, useStudiedMainId } from '@/lib/sticky-state'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'

type Territory = { territory: number; weight: number; districts: { district_ar: string; district_id: string | number }[] }
type Activity = { main_id: string; main_ar: string }
type Customer = Stop & { name: string; district_ar: string }
type PlanDay = { day: number; stops: string[]; count: number; meters_estimate: number; seconds_estimate: number }
type WeekPlan = { days: PlanDay[]; unplanned: string[]; detour: number; speed_kmh: number }

const WEEK_STOPS_MAX = 5000
/** The working week: Sunday to Thursday, with Saturday first when the rep works six days. */
const dayNames = (days: number) => (days === 6 ? ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'] : ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'].slice(0, days))
const km = (meters: number) => `${numberFormat.format(Math.round(meters / 100) / 10)} كم`

const PALETTE = CATEGORICAL
const DIM = TONE.pebble

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="mb-2 flex items-center gap-2 text-base font-bold">
        <span className={cn('flex size-6 items-center justify-center rounded-full text-sm', done ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{n}</span>
        {title}
      </p>
      {children}
    </div>
  )
}

const duration = (seconds: number) => {
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${numberFormat.format(minutes)} دقيقة` : `${numberFormat.format(Math.floor(minutes / 60))} ساعة ${numberFormat.format(minutes % 60)} دقيقة`
}

/**
 * «تقسيم المندوبين» as a full journey: the customers' activity, the number of reps, one rep's area, its
 * customers on the map, a start point, and the visit route on the roads, drawn part by part as it is solved.
 */
export function TerritoriesTool({ city, rows, onOverlay }: { city: string; rows: DistrictRow[]; onOverlay: (overlay: Overlay) => void }) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [mainId, setMainId] = useStudiedMainId(activities)
  const [count, setCount] = useStickyState('territories.count', 5)
  const [weight, setWeight] = useStickyState<'population' | 'businesses'>('territories.weight', 'businesses')
  const [groups, setGroups] = useState<Territory[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [rep, setRep] = useState<number | null>(null)
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [customerError, setCustomerError] = useState<{ text: string; login: boolean } | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [picking, setPicking] = useState(false)
  const [parts, setParts] = useState<RoutePart[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [routeError, setRouteError] = useState('')
  const [days, setDays] = useStickyState('territories.days', 5)
  const [perDay, setPerDay] = useStickyState('territories.perDay', 20)
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [planStatus, setPlanStatus] = useState<'idle' | 'loading' | 'error' | 'too-many'>('idle')
  const [day, setDay] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    postMarket<{ summary?: { main_activities?: Activity[] } }>('market-summary', { city })
      .then((payload) => setActivities(payload.summary?.main_activities ?? []))
      .catch(() => setActivities([]))
  }, [city])

  // step 1-2: the territories, rebuilt whenever the activity, count or balance changes
  useEffect(() => {
    let active = true
    setStatus('loading'); setRep(null)
    postMarket<{ territories: Territory[] }>('territories', { city, count, weight, ...(mainId ? { main_id: mainId } : {}) })
      .then((data) => { if (active) { setGroups(data.territories); setStatus('idle') } })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [city, count, weight, mainId])

  // step 3: one rep's customers
  useEffect(() => {
    abort.current?.abort()
    setCustomers(null); setCustomerError(null); setParts([]); setProgress(null); setRouteError(''); setPlan(null); setDay(null)
    if (rep == null || !groups?.[rep]) return
    let active = true
    fetch('/api/market/stops', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city, districts: groups[rep].districts.map((district) => district.district_ar), ...(mainId ? { main_id: mainId } : {}) }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!active) return
      if (!response.ok) { setCustomerError({ text: payload?.error || 'تعذر تحميل منشآت المنطقة.', login: response.status === 401 }); return }
      setCustomers(payload.points ?? [])
    }).catch(() => { if (active) setCustomerError({ text: 'تعذر تحميل منشآت المنطقة.', login: false }) })
    return () => { active = false }
  }, [rep, groups, city, mainId])

  // the rep's week: rebuilt when the customers, the start point or the week's shape change
  useEffect(() => {
    setPlan(null); setDay(null)
    abort.current?.abort(); setParts([]); setProgress(null); setRouteError('')   // a route from the old plan or start is stale
    if (!customers?.length) { setPlanStatus('idle'); return }
    if (customers.length > WEEK_STOPS_MAX) { setPlanStatus('too-many'); return }
    let active = true
    setPlanStatus('loading')
    postMarket<WeekPlan>('weekly-plan', {
      stops: customers.map(({ id, lon, lat }) => ({ id, lon, lat })), days, max_per_day: perDay, ...(start ? { start } : {}),
    }).then((data) => { if (active) { setPlan(data); setPlanStatus('idle') } })
      .catch(() => { if (active) setPlanStatus('error') })
    return () => { active = false }
  }, [customers, start, days, perDay])

  const pickStart = useCallback((point: Point) => { setStart(point); setPicking(false) }, [])

  // everything on the map comes from this one place
  useEffect(() => {
    const ids = new Map(rows.map((row) => [row.name, row.id]))
    const colors = new Map<string, string>()
    groups?.forEach((group, index) => group.districts.forEach((district) => {
      const id = ids.get(district.district_ar) ?? String(district.district_id)
      colors.set(id, rep == null || rep === index ? PALETTE[index % PALETTE.length] : DIM)
    }))
    const dayOf = new Map<string, number>()
    plan?.days.forEach((planned, index) => planned.stops.forEach((id) => dayOf.set(id, index)))
    const painted = plan && customers
      ? customers.map((customer) => {
        const index = dayOf.get(customer.id)
        return { ...customer, color: index == null || (day != null && day !== index) ? DIM : PALETTE[index % PALETTE.length] }
      })
      : customers
    onOverlay({
      colors: groups ? colors : null,
      points: painted,
      start,
      lines: parts.filter((part) => part?.line).map((part) => part.line as GeoJSON.LineString),
      onPick: picking ? pickStart : null,
    })
  }, [groups, rows, rep, customers, plan, day, start, parts, picking, pickStart, onOverlay])

  async function route(only?: Stop[]) {
    const from = start ?? only?.[0]
    const through = only ? (start ? only : only.slice(1)) : customers
    if (!from || !through?.length) return
    if (!only) setDay(null)
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setParts([]); setRouteError(''); setProgress({ done: 0, total: 1 })
    try {
      await planRoute(from, through, (part, done, total) => {
        setParts((current) => { const next = [...current]; next[part.index] = part; return next })
        setProgress({ done, total })
      }, controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted) setRouteError(failure instanceof Error ? failure.message : 'تعذر حساب المسار.')
    }
  }

  const solved = parts.filter(Boolean)
  const meters = solved.reduce((total, part) => total + part.meters, 0)
  const seconds = solved.reduce((total, part) => total + part.seconds, 0)
  const order = useMemo(() => solved.flatMap((part) => part.order), [solved])
  const byId = useMemo(() => new Map((customers ?? []).map((customer) => [customer.id, customer])), [customers])
  const showDay = (index: number) => {
    if (!plan || !customers) return
    setDay(index)
    const byStop = new Map(customers.map((customer) => [customer.id, customer]))
    void route(plan.days[index].stops.map((id) => byStop.get(id)).filter((stop): stop is Customer => Boolean(stop)))
  }
  const names = dayNames(days)
  const finished = progress != null && progress.done === progress.total && solved.length > 0

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">تقسيم المندوبين</h2>

      <Step n={1} title="نشاط عملائك" done={Boolean(mainId)}>
        <MainActivityPicker activities={activities} value={mainId} onChange={setMainId} placeholder="نشاط عملائك" allLabel="كل المنشآت" />
      </Step>

      <Step n={2} title="المندوبون" done={Boolean(groups)}>
        <label className="flex items-center justify-between gap-3 text-base">العدد
          <input type="number" min={2} max={50} value={count} onChange={(e) => setCount(Math.min(50, Math.max(2, Number(e.target.value) || 2)))} className="h-11 w-24 rounded-lg border bg-background px-3 text-base" />
        </label>
        <div className="mt-2 flex gap-1.5">
          {(['businesses', 'population'] as const).map((value) => (
            <button key={value} onClick={() => setWeight(value)} aria-pressed={weight === value}
              className={cn('flex-1 rounded-lg border py-2 text-sm', weight === value ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
              توازن {value === 'population' ? 'بالسكان' : mainId ? 'بعملاء النشاط' : 'بالمنشآت'}
            </button>
          ))}
        </div>
        {status === 'loading' && <Loader2 className="mt-2 size-5 animate-spin text-primary" aria-label="جارٍ التقسيم" />}
        {status === 'error' && <p role="alert" className="mt-2 text-base text-destructive">تعذر التقسيم.</p>}
        {groups && status !== 'loading' && (
          <ol className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
            {groups.map((group, index) => (
              <li key={group.territory}>
                <button onClick={() => setRep(index)} className={cn('flex w-full items-center gap-2 rounded-lg border p-2 text-start text-base', rep === index ? 'border-primary' : 'hover:border-primary')}>
                  <span className="size-3.5 shrink-0 rounded-sm" style={{ background: PALETTE[index % PALETTE.length] }} aria-hidden />
                  <span className="font-bold">المندوب {numberFormat.format(index + 1)}</span>
                  <span className="truncate text-sm text-muted-foreground">{counted(group.districts.length, 'district')}</span>
                  <Explained title={`حصة المندوب ${numberFormat.format(index + 1)}`} lines={EXPLAIN.territory(weight)} className="ms-auto shrink-0 font-semibold">
                    {weight === 'population' ? `${numberFormat.format(Math.round(group.weight))} ساكن` : counted(Math.round(group.weight), 'business')}
                  </Explained>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Step>

      {rep != null && (
        <Step n={3} title={`عملاء المندوب ${numberFormat.format(rep + 1)}`} done={Boolean(customers?.length)}>
          {!customers && !customerError && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ التحميل" />}
          {customerError && (
            <p role="alert" className="text-base text-destructive">
              {customerError.text} {customerError.login && <Link href="/login?next=%2Fmap%3Ftool%3Dterritories" className="font-semibold text-primary underline">تسجيل الدخول</Link>}
            </p>
          )}
          {customers && (
            <p className="text-base">
              <strong>{numberFormat.format(customers.length)}</strong> منشأة على الخريطة
            </p>
          )}
        </Step>
      )}

      {customers && customers.length > 0 && (
        <Step n={4} title="نقطة البداية" done={Boolean(start)}>
          <button onClick={() => setPicking(true)} className={cn('h-11 w-full rounded-lg border text-base', picking ? 'border-primary text-primary' : 'hover:border-primary')}>
            {picking ? 'اضغط موقع المستودع على الخريطة' : start ? 'غيّر نقطة البداية' : 'حدّد نقطة البداية على الخريطة'}
          </button>
        </Step>
      )}

      {customers && customers.length > 0 && (
        <Step n={5} title="خطة الأسبوع" done={Boolean(plan)}>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">أيام العمل
              <input type="number" min={1} max={6} value={days} onChange={(e) => setDays(Math.min(6, Math.max(1, Math.round(Number(e.target.value)) || 1)))} className="h-11 rounded-lg border bg-background px-3 text-base" />
            </label>
            <label className="flex flex-col gap-1 text-sm">زيارات اليوم حتى
              <input type="number" min={1} max={100} value={perDay} onChange={(e) => setPerDay(Math.min(100, Math.max(1, Math.round(Number(e.target.value)) || 1)))} className="h-11 rounded-lg border bg-background px-3 text-base" />
            </label>
          </div>
          {planStatus === 'loading' && <Loader2 className="mt-2 size-5 animate-spin text-primary" aria-label="جارٍ تقسيم الأسبوع" />}
          {planStatus === 'error' && <p role="alert" className="mt-2 text-base text-destructive">تعذر تقسيم الأسبوع.</p>}
          {planStatus === 'too-many' && <p role="alert" className="mt-2 text-base text-destructive">المنشآت أكثر من {numberFormat.format(WEEK_STOPS_MAX)}. اختر نشاطاً أدق أو مندوبين أكثر.</p>}
          {plan && planStatus === 'idle' && (
            <>
              <ol className="mt-2 space-y-1.5">
                {plan.days.map((planned, index) => {
                  const road = day === index && finished ? { meters, seconds } : null
                  return (
                    <li key={planned.day}>
                      <button onClick={() => showDay(index)} aria-pressed={day === index}
                        className={cn('flex w-full items-center gap-2 rounded-lg border p-2 text-start text-base', day === index ? 'border-primary' : 'hover:border-primary')}>
                        <span className="size-3.5 shrink-0 rounded-full" style={{ background: PALETTE[index % PALETTE.length] }} aria-hidden />
                        <span className="font-bold">{names[index] ?? `اليوم ${numberFormat.format(planned.day)}`}</span>
                        <span className="text-sm text-muted-foreground">{numberFormat.format(planned.count)} زيارة</span>
                        <span className="ms-auto shrink-0 text-sm">
                          {day === index && !finished && !routeError
                            ? <Loader2 className="size-4 animate-spin text-primary" aria-label="جارٍ حساب مسار اليوم" />
                            : road
                            ? <>على الطرق: {km(road.meters)} · {duration(road.seconds)}</>
                            : <Explained title={`خطة ${names[index] ?? 'اليوم'}`} lines={EXPLAIN.weeklyPlan(plan.detour, plan.speed_kmh)}>تقدير: {km(planned.meters_estimate)} · {duration(planned.seconds_estimate)}</Explained>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {day != null && routeError && <p role="alert" className="mt-2 text-base text-destructive">{routeError}</p>}
              {plan.unplanned.length > 0 && (
                <p className="mt-2 text-base"><strong>{numberFormat.format(plan.unplanned.length)}</strong> منشأة لا تتسع لها خطة هذا الأسبوع</p>
              )}
            </>
          )}
        </Step>
      )}

      {customers && customers.length > 0 && start && (
        <Step n={6} title="مسار الزيارة" done={finished && day == null}>
          <button onClick={() => route()} disabled={day == null && progress != null && !finished && !routeError} className="h-11 w-full rounded-lg bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60">
            {day == null && progress && !finished && !routeError ? `جارٍ الحساب: ${numberFormat.format(progress.done)} من ${numberFormat.format(progress.total)}` : finished && day == null ? 'أعد حساب المسار' : `احسب المسار لـ ${numberFormat.format(customers.length)} محطة`}
          </button>
          {day == null && progress && !finished && !routeError && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></div>
          )}
          {day == null && routeError && <p role="alert" className="mt-2 text-base text-destructive">{routeError}</p>}
          {day == null && solved.length > 0 && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm text-muted-foreground">المحطات</p><p className="text-lg font-bold">{numberFormat.format(order.length)}</p></div>
                <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm text-muted-foreground">المسافة</p><p className="text-lg font-bold">{numberFormat.format(Math.round(meters / 1000))} كم</p></div>
                <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm text-muted-foreground">زمن القيادة</p><p className="text-base font-bold">{duration(seconds)}</p></div>
              </div>
              <ol className="mt-3 max-h-64 space-y-1 overflow-y-auto text-base">
                {order.slice(0, 200).map((id, index) => (
                  <li key={id} className="flex gap-2"><span className="w-10 text-sm text-muted-foreground">{numberFormat.format(index + 1)}</span><span className="truncate">{byId.get(id)?.name}</span><span className="ms-auto shrink-0 text-sm text-muted-foreground">{byId.get(id)?.district_ar}</span></li>
                ))}
              </ol>
              {order.length > 200 && <p className="mt-1 text-sm text-muted-foreground">و{numberFormat.format(order.length - 200)} محطة أخرى على الخريطة</p>}
            </>
          )}
        </Step>
      )}
    </section>
  )
}
