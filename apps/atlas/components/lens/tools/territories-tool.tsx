'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SignInLink } from '@/components/shared/sign-in-link'
import { NoResult } from '@/components/shared/empty-state'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { Skeleton, SkeletonRows, SkeletonStatus } from '@/components/ui/skeleton'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import { planRoute, type Point, type RoutePart, type Stop } from '@/lib/route-plan'
import { cn } from '@/lib/utils'
import type { DistrictRow } from '../city-data'
import type { Overlay } from './overlay'
import { trackDecisionMoment } from '@/lib/commercial-metrics'
import { CATEGORICAL, PALETTE as TONE } from '@/lib/palette'
import { useStickyState, useStudiedMainId } from '@/lib/sticky-state'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import { Chip } from '@/components/ui/chip'
import { useMainActivities } from '@/lib/main-activities'
import { duration, territoriesSummary, territoriesVerdict, weekFitHint, weekSummary } from './tool-answers'
import { Verdict } from './verdict'
import { useAnswer } from './use-answer'
import { territoryFacts } from './district-facts'
import { Choice, StillWorking } from './choice'

type Territory = { territory: number; weight: number; districts: { district_ar: string; district_id: string | number }[] }
type Customer = Stop & { name: string; district_ar: string }
type PlanDay = { day: number; stops: string[]; count: number; meters_estimate: number; seconds_estimate: number }
type WeekPlan = { days: PlanDay[]; unplanned: string[]; detour: number; speed_kmh: number }

const WEEK_STOPS_MAX = 5000
/** The working week: Sunday to Thursday, with Saturday first when the rep works six days. */
const dayNames = (days: number) => (days === 6 ? ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'] : ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'].slice(0, days))
const km = (meters: number) => `${numberFormat.format(Math.round(meters / 100) / 10)} كم`

const PALETTE = CATEGORICAL
const MIN_REPS = 2
const MAX_REPS = 50
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

/**
 * A whole number typed or stepped: the field is applied on Enter or leaving it (an empty field keeps the last value),
 * so typing «12» never asks for 1 on the way, and − / + step it on a phone without the number keyboard.
 */
function Stepper({ id, label, value, min, max, onChange, less, more }: {
  id: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void; less: string; more: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = (next: number) => {
    const clamped = Number.isFinite(next) ? Math.min(max, Math.max(min, Math.round(next))) : value
    onChange(clamped)
    setDraft(String(clamped))
  }
  const typed = () => commit(draft.trim() ? Number(draft) : NaN)
  return (
    <div className="flex items-center justify-between gap-3 text-base">
      <label htmlFor={id}>{label}</label>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => commit(value - 1)} disabled={value <= min} aria-label={less}
          className="size-11 rounded-lg border text-lg font-semibold hover:border-primary disabled:opacity-40">−</button>
        <input id={id} type="number" inputMode="numeric" min={min} max={max} value={draft}
          onChange={(e) => setDraft(e.target.value)} onBlur={typed} onKeyDown={(e) => { if (e.key === 'Enter') typed() }}
          className="h-11 w-16 rounded-lg border bg-background px-2 text-center text-base tabular-nums" />
        <button type="button" onClick={() => commit(value + 1)} disabled={value >= max} aria-label={more}
          className="size-11 rounded-lg border text-lg font-semibold hover:border-primary disabled:opacity-40">+</button>
      </div>
    </div>
  )
}

const STOPS_LISTED = 200

/** The stops in the order the route visits them, numbered, with each one's district; the rest stay on the map. */
function StopOrder({ order, byId }: { order: string[]; byId: Map<string, Customer> }) {
  return (
    <>
      <ol className="mt-2 space-y-1 text-base tabular-nums lg:max-h-64 lg:overflow-y-auto">
        {order.slice(0, STOPS_LISTED).map((id, index) => (
          <li key={id} className="flex gap-2"><span className="w-10 shrink-0 text-sm text-muted-foreground">{numberFormat.format(index + 1)}</span><span className="truncate">{byId.get(id)?.name || 'منشأة بلا اسم'}</span><span className="ms-auto shrink-0 text-sm text-muted-foreground">{byId.get(id)?.district_ar}</span></li>
        ))}
      </ol>
      {order.length > STOPS_LISTED && <p className="mt-1 text-sm text-muted-foreground">و{numberFormat.format(order.length - STOPS_LISTED)} محطة أخرى على الخريطة</p>}
    </>
  )
}

/**
 * «المناطق والمسار» as a full journey: the customers' activity, the number of reps, one rep's area, its
 * customers on the map, a start point, and the visit route on the roads, drawn part by part as it is solved.
 */
export function TerritoriesTool({ city, rows, onOverlay }: { city: string; rows: DistrictRow[]; onOverlay: (overlay: Overlay) => void }) {
  const activities = useMainActivities(city)
  const [mainId, setMainId] = useStudiedMainId(activities)
  const [count, setCount] = useStickyState('territories.count', 5)
  const [weight, setWeight] = useStickyState<'population' | 'businesses'>('territories.weight', 'businesses')
  const [rep, setRep] = useState<number | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [picking, setPicking] = useState(false)
  const [parts, setParts] = useState<RoutePart[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [routeError, setRouteError] = useState('')
  const [days, setDays] = useStickyState('territories.days', 5)
  const [perDay, setPerDay] = useStickyState('territories.perDay', 20)
  const [day, setDay] = useState<number | null>(null)
  // a day routed without a start point sets out from its first stop, which the solved parts then leave out of their order
  const [origin, setOrigin] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  // step 1-2: the territories, rebuilt whenever the activity, count or balance changes; the last split goes at once,
  // so the map never colours the old reps under the new count's skeleton
  const groupsKey = `${city}|${count}|${weight}|${mainId}`
  // the city is split once the distributor has said whose customers it is: an activity, or «كل المنشآت» on purpose.
  // Splitting every business by default handed each rep some 150,000 businesses nobody serves
  const [scope, setScope] = useStickyState<'all' | 'activity'>('territories.scope', 'activity')
  const told = Boolean(mainId) || scope === 'all'
  const pickCustomers = (id: string) => { setMainId(id); setScope(id ? 'activity' : 'all') }
  const split = useAnswer(told ? groupsKey : null, () => postMarket<{ territories: Territory[] }>('territories', { city, count, weight, ...(mainId ? { main_id: mainId } : {}) }))
  // one array per answer: the map's overlay effect follows it, so a new empty array on every render would loop
  const groups = useMemo(() => (split.status === 'ready' ? split.data?.territories ?? [] : null), [split.status, split.data])
  const status = split.status === 'loading' ? 'loading' : split.status === 'error' ? 'error' : 'idle'
  useEffect(() => { setRep(null) }, [groupsKey])
  // the distributor's decision moments (foundation §7): the city split into balanced territories (how many reps), and
  // below, a route solved (how many stops); sizes only, never places
  const splitCount = groups?.length ?? 0
  useEffect(() => { if (splitCount > 0) trackDecisionMoment('territories_balanced', { lens: 'distributors', city, count: splitCount }) }, [groupsKey, splitCount, city])

  // step 3: one rep's customers, keyed by the split and the rep
  const stopsKey = rep != null && groups?.[rep] ? `${groupsKey}|${rep}` : null
  const stops = useAnswer<Customer[]>(stopsKey, async () => {
    const response = await fetch('/api/market/stops', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city, districts: groups![rep!].districts.map((district) => district.district_ar), ...(mainId ? { main_id: mainId } : {}) }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw { text: payload?.error || 'تعذر تحميل منشآت المنطقة.', login: response.status === 401 }
    return payload?.points ?? []
  })
  const customers = stops.data
  const customerError = stops.status === 'error'
    ? (typeof stops.error === 'object' && stops.error && 'text' in stops.error ? stops.error as { text: string; login: boolean } : { text: 'تعذر تحميل منشآت المنطقة.', login: false })
    : null

  // the rep's week: rebuilt when the customers, the start point or the week's shape change
  const tooMany = (customers?.length ?? 0) > WEEK_STOPS_MAX
  const planKey = stopsKey && customers?.length && !tooMany ? `${stopsKey}|${start ? `${start.lon},${start.lat}` : ''}|${days}|${perDay}` : null
  const week = useAnswer(planKey, () => postMarket<WeekPlan>('weekly-plan', {
    stops: customers!.map(({ id, lon, lat }) => ({ id, lon, lat })), days, max_per_day: perDay, ...(start ? { start } : {}),
  }))
  const plan = week.data
  const planStatus: 'idle' | 'loading' | 'error' | 'too-many' = tooMany ? 'too-many' : week.status === 'loading' ? 'loading' : week.status === 'error' ? 'error' : 'idle'
  // a route from the old rep, plan or start is stale
  useEffect(() => {
    abort.current?.abort(); setParts([]); setProgress(null); setRouteError(''); setDay(null)
  }, [stopsKey, planKey])

  const pickStart = useCallback((point: Point) => { setStart(point); setPicking(false) }, [])


  async function route(only?: Stop[]) {
    const from = start ?? only?.[0]
    const through = only ? (start ? only : only.slice(1)) : customers
    if (!from || !through?.length) return
    if (!only) setDay(null)
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setParts([]); setRouteError(''); setProgress({ done: 0, total: 1 }); setOrigin(start ? null : only?.[0]?.id ?? null)
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
  const order = useMemo(() => [...(origin ? [origin] : []), ...solved.flatMap((part) => part.order)], [solved, origin])
  const byId = useMemo(() => new Map((customers ?? []).map((customer) => [customer.id, customer])), [customers])
  const showDay = (index: number) => {
    if (!plan || !customers) return
    setDay(index)
    const byStop = new Map(customers.map((customer) => [customer.id, customer]))
    void route(plan.days[index].stops.map((id) => byStop.get(id)).filter((stop): stop is Customer => Boolean(stop)))
  }
  const names = dayNames(days)
  const finished = progress != null && progress.done === progress.total && solved.length > 0
  useEffect(() => { if (finished) trackDecisionMoment('route_planned', { lens: 'distributors', city, count: order.length }) },
    // once per solved route: its stops counted, not its places
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finished, order.length])

  // the step's answer in one line for the peeking sheet: the route once solved, else the rep's customers, else the split
  const visits = plan ? plan.days.reduce((sum, planned) => sum + planned.count, 0) : 0
  const summary = finished ? `${day != null ? `مسار ${names[day] ?? 'اليوم'}` : 'المسار'}: ${numberFormat.format(order.length)} محطة · ${km(meters)} · ${duration(seconds)}`
    : plan && planStatus === 'idle' ? weekSummary(visits, plan.days.length)
    : rep != null && customers ? `المندوب ${numberFormat.format(rep + 1)}: ${numberFormat.format(customers.length)} منشأة على الخريطة`
      : territoriesSummary(status, groups?.length ?? null, weight)

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
      // the card on a clicked district: the rep whose territory holds it, and that territory's share
      facts: groups?.length ? territoryFacts(groups, ids, weight) : null,
      points: painted,
      start,
      lines: parts.filter((part) => part?.line).map((part) => part.line as GeoJSON.LineString),
      onPick: picking ? pickStart : null,
      summary,
      // the split's own state for the peeking sheet; its slow line is said in the step itself (StillWorking below)
      ...(!groups && split.status !== 'idle' && split.status !== 'ready' ? { state: split.status === 'loading' ? 'loading' as const : 'error' as const, retry: split.retry } : {}),
    })
    // split.retry is stable; its status is what the overlay says
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, rows, rep, customers, plan, day, start, parts, picking, pickStart, onOverlay, summary, weight, split.status])

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">المناطق والمسار</h2>

      <Step n={1} title="نشاط عملائك" done={Boolean(mainId)}>
        <MainActivityPicker activities={activities} value={mainId} onChange={pickCustomers} placeholder="نشاط عملائك" allLabel="كل المنشآت" />
        {!told && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">اختر نشاط عملائك فتُقسَّم المدينة على عملائك أنت، لا على كل منشآتها.</span>
            <Chip onClick={() => setScope('all')}>قسّم على كل المنشآت</Chip>
          </div>
        )}
      </Step>

      <Step n={2} title="المندوبون" done={Boolean(groups?.length)}>
        <Stepper id="territories-count" label="العدد" value={count} min={MIN_REPS} max={MAX_REPS} onChange={setCount} less="مندوب أقل" more="مندوب أكثر" />
        <Choice label="معيار التوازن" value={weight} onChange={setWeight} className="mt-2"
          options={[{ id: 'businesses', label: `توازن ${mainId ? 'بعملاء النشاط' : 'بالمنشآت'}` }, { id: 'population', label: 'توازن بالسكان' }]} />
        {status === 'loading' && <SkeletonRows label="جارٍ التقسيم" rows={Math.min(count, 6)} boxed leading="swatch" trailing className="mt-2" />}
        {status === 'loading' && split.slow && <div className="mt-2"><StillWorking>تقسيم المدينة كلها على المندوبين يأخذ وقتاً أطول.</StillWorking></div>}
        {status === 'error' && <LoadError what="المناطق" title="تعذر تقسيم المناطق." onRetry={split.retry} className="mt-2" />}
        {groups && status !== 'loading' && groups.length === 0 && (
          <NoResult title="لا مناطق لهذا الاختيار" body={mainId ? 'لا منشآت من هذا النشاط في أحياء المدينة. اختر «كل المنشآت» أو نشاطاً آخر.' : 'أحياء المدينة بلا منشآت معروفة الموقع بعد.'} className="mt-2" />
        )}
        {/* how even the split is, before the reps' rows: a spread over a quarter is said, with what evens it */}
        {groups && status !== 'loading' && groups.length > 0 && <Verdict verdict={territoriesVerdict(groups.map((group) => ({ weight: group.weight, districts: group.districts.length })), weight)} className="mt-2" />}
        {groups && status !== 'loading' && groups.length > 0 && (
          <ol className="mt-2 space-y-1.5 lg:max-h-56 lg:overflow-y-auto">
            {groups.map((group, index) => (
              // the share opens its own explanation card, so it sits beside the row's button, never inside it
              <li key={group.territory} aria-current={rep === index ? 'true' : undefined}
                className={cn('flex items-center gap-2 rounded-lg border pe-2 text-base tabular-nums', rep === index ? 'border-primary' : 'hover:border-primary')}>
                <button type="button" onClick={() => setRep(index)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                  <span className="size-3.5 shrink-0 rounded-sm" style={{ background: PALETTE[index % PALETTE.length] }} aria-hidden />
                  <span className="font-bold">المندوب {numberFormat.format(index + 1)}</span>
                  <span className="truncate text-sm text-muted-foreground">{counted(group.districts.length, 'district')}</span>
                </button>
                <Explained title={`حصة المندوب ${numberFormat.format(index + 1)}`} lines={EXPLAIN.territory(weight)} className="shrink-0 font-semibold">
                  {weight === 'population' ? `${numberFormat.format(Math.round(group.weight))} ساكن` : counted(Math.round(group.weight), 'business')}
                </Explained>
              </li>
            ))}
          </ol>
        )}
      </Step>

      {rep != null && (
        <Step n={3} title={`عملاء المندوب ${numberFormat.format(rep + 1)}`} done={Boolean(customers?.length)}>
          {!customers && !customerError && <SkeletonStatus label="جارٍ تحميل منشآت المنطقة"><Skeleton className="h-6 w-44" /></SkeletonStatus>}
          {!customers && !customerError && stops.slow && <div className="mt-2"><StillWorking>منطقة واسعة فيها منشآت كثيرة.</StillWorking></div>}
          {customerError && (
            <LoadError what="منشآت المنطقة" detail={customerError.text} onRetry={stops.retry}
              action={customerError.login ? <SignInLink className="text-sm font-semibold text-primary underline">تسجيل الدخول</SignInLink> : undefined} />
          )}
          {customers && customers.length === 0 && (
            <NoResult title={`لا منشأة ${mainId ? 'من هذا النشاط ' : ''}في منطقة المندوب ${numberFormat.format(rep + 1)}`}
              body={mainId ? 'اختر «كل المنشآت» أو نشاطاً آخر، أو مندوباً آخر.' : 'اختر مندوباً آخر.'} />
          )}
          {customers && customers.length > 0 && (
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
          <div className="flex flex-col gap-2">
            <Stepper id="territories-days" label="أيام العمل" value={days} min={1} max={6} onChange={setDays} less="يوم أقل" more="يوم أكثر" />
            <Stepper id="territories-per-day" label="زيارات اليوم حتى" value={perDay} min={1} max={100} onChange={setPerDay} less="زيارة أقل" more="زيارة أكثر" />
          </div>
          {planStatus === 'loading' && <SkeletonRows label="جارٍ تقسيم الأسبوع" rows={days} boxed leading="swatch" sub trailing className="mt-2" />}
          {planStatus === 'loading' && week.slow && <div className="mt-2"><StillWorking>توزيع الزيارات على أيام الأسبوع يأخذ وقتاً أطول مع منشآت كثيرة.</StillWorking></div>}
          {planStatus === 'error' && <LoadError what="خطة الأسبوع" title="تعذر تقسيم الأسبوع." onRetry={week.retry} className="mt-2" />}
          {/* a limit, not a failure: the shared «no result» shape with the two changes that fit the week */}
          {planStatus === 'too-many' && <NoResult title={`المنشآت أكثر من ${numberFormat.format(WEEK_STOPS_MAX)} لخطة أسبوع واحد`} body="اختر نشاطاً أدق، أو زد عدد المندوبين لتصغر كل منطقة." className="mt-2" />}
          {plan && planStatus === 'idle' && (
            <>
              <ol className="mt-2 space-y-1.5">
                {plan.days.map((planned, index) => {
                  const road = day === index && finished ? { meters, seconds } : null
                  return (
                    // the estimate opens its own explanation card, so it sits beside the day's button, never inside it
                    <li key={planned.day} aria-current={day === index ? 'true' : undefined}
                      className={cn('flex items-center gap-2 rounded-lg border pe-2 text-base tabular-nums', day === index ? 'border-primary' : 'hover:border-primary')}>
                      <button type="button" onClick={() => showDay(index)} aria-pressed={day === index}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                        <span className="size-3.5 shrink-0 rounded-full" style={{ background: PALETTE[index % PALETTE.length] }} aria-hidden />
                        <span className="font-bold">{names[index] ?? `اليوم ${numberFormat.format(planned.day)}`}</span>
                        <span className="text-sm text-muted-foreground">{numberFormat.format(planned.count)} زيارة</span>
                      </button>
                      <span className="shrink-0 text-sm">
                        {day === index && !finished && !routeError
                          ? <span role="status" aria-busy="true"><span className="sr-only">جارٍ حساب مسار اليوم</span><Skeleton className="h-4 w-28" aria-hidden /></span>
                          : road
                          ? <>على الطرق: {km(road.meters)} · {duration(road.seconds)}</>
                          : <Explained title={`خطة ${names[index] ?? 'اليوم'}`} lines={EXPLAIN.weeklyPlan(plan.detour, plan.speed_kmh)}>تقدير: {km(planned.meters_estimate)} · {duration(planned.seconds_estimate)}</Explained>}
                      </span>
                    </li>
                  )
                })}
              </ol>
              {day != null && routeError && <LoadError what="المسار" title="تعذر حساب مسار اليوم." detail={routeError} onRetry={() => showDay(day)} className="mt-2" />}
              {/* the day's visits in the order the route takes them: with the full route hidden, this is the rep's list */}
              {day != null && finished && (
                <div className="mt-3">
                  <p className="text-sm font-semibold">ترتيب زيارات {names[day] ?? 'اليوم'}</p>
                  <StopOrder order={order} byId={byId} />
                </div>
              )}
              {plan.unplanned.length > 0 && (
                <div className="mt-2 text-base">
                  <p><strong>{numberFormat.format(plan.unplanned.length)}</strong> منشأة لا تتسع لها خطة هذا الأسبوع</p>
                  {/* the one number to change so every customer fits, instead of guessing */}
                  {customers && <p className="text-sm text-muted-foreground">{weekFitHint(customers.length, plan.unplanned.length, days, perDay)}</p>}
                </div>
              )}
            </>
          )}
        </Step>
      )}

      {/* owner decision (2026-11-02): the week plan replaces the one long route, so step 6 shows only when no plan can be made */}
      {customers && customers.length > 0 && start && !plan && planStatus !== 'loading' && (
        <Step n={6} title="مسار الزيارة" done={finished && day == null}>
          <button onClick={() => route()} disabled={day == null && progress != null && !finished && !routeError} className="h-11 w-full rounded-lg bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60">
            {day == null && progress && !finished && !routeError ? `جارٍ الحساب: ${numberFormat.format(progress.done)} من ${numberFormat.format(progress.total)}` : finished && day == null ? 'أعد حساب المسار' : `احسب المسار لـ ${numberFormat.format(customers.length)} محطة`}
          </button>
          {day == null && progress && !finished && !routeError && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></div>
          )}
          {day == null && routeError && <LoadError what="المسار" title="تعذر حساب المسار." detail={routeError} onRetry={() => route()} className="mt-2" />}
          {day == null && solved.length > 0 && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center tabular-nums">
                <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm text-muted-foreground">المحطات</p><p className="text-lg font-bold">{numberFormat.format(order.length)}</p></div>
                <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm text-muted-foreground">المسافة</p><p className="text-lg font-bold">{km(meters)}</p></div>
                <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm text-muted-foreground">زمن القيادة</p><p className="text-base font-bold">{duration(seconds)}</p></div>
              </div>
              <StopOrder order={order} byId={byId} />
            </>
          )}
        </Step>
      )}
    </section>
  )
}
