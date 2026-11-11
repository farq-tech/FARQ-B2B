'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket, useMainActivities } from '@/lib/insights-api'
import { planRoute, type Point, type RoutePart, type Stop } from '@/lib/route-plan'
import { cn } from '@/lib/utils'
import type { Overlay } from './overlay'
import { CATEGORICAL, PALETTE as TONE } from '@/lib/palette'
import { useStickyState, useStudiedMainId } from '@/lib/sticky-state'
import { MainActivityPicker } from '@/components/shared/main-activity-picker'
import { parseTerritoryCoverage, type TerritoryCoverage } from '@/lib/territory-coverage'
import { balanceTerritoriesByDriveTime, parseDiagonalDriveTimes, parseTerritoryCentres, type TerritoryCentre } from '@/lib/territory-drive-time'

type Territory = { territory: number; weight: number; districts: { district_ar: string; district_id: string | number }[] }
type Customer = Stop & { name: string; district_ar: string; district_id?: string | null }
const PALETTE = CATEGORICAL
const DIM = TONE.pebble

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="mb-2 flex items-center gap-2 text-base font-bold">
        <span className={cn('flex size-6 items-center justify-center rounded-full text-sm', done ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{numberFormat.format(n)}</span>
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

/** Valhalla matrices are capped at 25×25; diagonal cells encode consecutive legs in the district-centre sweep. */
async function measuredDriveLegs(centres: TerritoryCentre[], signal: AbortSignal): Promise<number[]> {
  const batches: { sources: TerritoryCentre[]; targets: TerritoryCentre[] }[] = []
  for (let start = 0; start < centres.length - 1; start += 24) {
    batches.push({ sources: centres.slice(start, start + 24), targets: centres.slice(start + 1, start + 25) })
  }
  const parts = await Promise.all(batches.map(async ({ sources, targets }) => {
    const response = await fetch('/api/routing/sources_to_targets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: sources.map(({ lat, lon }) => ({ lat, lon })), targets: targets.map(({ lat, lon }) => ({ lat, lon })), costing: 'auto' }),
      signal,
    })
    const payload = await response.json().catch(() => null)
    if (response.status === 401) throw new Error('سجّل الدخول لموازنة المناطق بزمن القيادة.')
    if (!response.ok || !payload) throw new Error('تعذر قياس زمن الطريق بين نقاط الأحياء الداخلية الممثلة.')
    return parseDiagonalDriveTimes(payload, sources.length)
  }))
  return parts.flat()
}

/**
 * «تقسيم المندوبين» as a full journey: the customers' activity, the number of reps, one rep's area, its
 * customers on the map, a start point, and the visit route on the roads, drawn part by part as it is solved.
 */
export function TerritoriesTool({ city, onOverlay }: { city: string; onOverlay: (overlay: Overlay) => void }) {
  const { activities, status: activityStatus, retry: retryActivities } = useMainActivities(city)
  const [mainId, setMainId] = useStudiedMainId(activities)
  const [count, setCount] = useStickyState('territories.count', 5)
  const [weight, setWeight] = useStickyState<'population' | 'businesses' | 'drive_time'>('territories.weight', 'businesses')
  const [groups, setGroups] = useState<Territory[] | null>(null)
  const [coverage, setCoverage] = useState<TerritoryCoverage | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [territoryError, setTerritoryError] = useState('')
  const [territoryLogin, setTerritoryLogin] = useState(false)
  const [rep, setRep] = useState<number | null>(null)
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [customerError, setCustomerError] = useState<{ text: string; login: boolean } | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [picking, setPicking] = useState(false)
  const [parts, setParts] = useState<RoutePart[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [routeError, setRouteError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const stopsAbort = useRef<AbortController | null>(null)
  const [territoryRetry, setTerritoryRetry] = useState(0)
  const [stopsRetry, setStopsRetry] = useState(0)

  // step 1-2: the territories, rebuilt whenever the activity, count or balance changes
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setStatus('loading'); setTerritoryError(''); setTerritoryLogin(false); setRep(null); setGroups(null); setCoverage(null); setStart(null)
    const load = async () => {
      try {
        if (weight === 'drive_time') {
          const raw = await postMarket<unknown>('territory-centres', { city }, controller.signal)
          const data = parseTerritoryCentres(raw)
          const legs = await measuredDriveLegs(data.centres, controller.signal)
          const measured = balanceTerritoriesByDriveTime(data.centres, legs, count)
          if (!measured.length) throw new Error('تعذر إنشاء مناطق: لا توجد أزمنة طريق موجبة قابلة للقياس بين نقاط الأحياء الداخلية الممثلة.')
          if (!active) return
          setGroups(measured)
          setCoverage({ unweighted_districts: data.unweightedDistricts, unlocated_businesses: null })
        } else {
          const data = await postMarket<{ territories: Territory[]; unweighted_districts?: number | null; unlocated_businesses?: number | null }>(
            'territories', { city, count, weight, ...(mainId ? { main_id: mainId } : {}) }, controller.signal)
          if (!Array.isArray(data.territories)) throw new Error('Missing territories')
          if (!active) return
          setGroups(data.territories)
          setCoverage(parseTerritoryCoverage(data))
        }
        if (active) setStatus('idle')
      } catch (failure) {
        if (!active || controller.signal.aborted) return
        controller.abort()
        const message = failure instanceof Error ? failure.message : 'تعذر التقسيم.'
        setTerritoryLogin(message === 'سجّل الدخول لموازنة المناطق بزمن القيادة.')
        setTerritoryError(message)
        setStatus('error')
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [city, count, weight, mainId, territoryRetry])

  // step 3: one rep's customers
  useEffect(() => {
    abort.current?.abort()
    stopsAbort.current?.abort()
    setCustomers(null); setCustomerError(null); setParts([]); setProgress(null); setRouteError('')
    if (rep == null || !groups?.[rep]) return
    let active = true
    const controller = new AbortController()
    stopsAbort.current = controller
    fetch('/api/market/stops', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city, district_ids: groups[rep].districts.map((district) => String(district.district_id)), ...(mainId ? { main_id: mainId } : {}) }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!active) return
      if (response.status === 409 && payload?.error) { setCustomerError({ text: payload.error, login: false }); return }
      if (!response.ok) { setCustomerError({ text: payload?.error || 'تعذر تحميل منشآت المنطقة.', login: response.status === 401 }); return }
      if (!Array.isArray(payload?.points)) throw new Error('Missing customer points')
      setCustomers(payload.points)
    }).catch(() => { if (active && !controller.signal.aborted) setCustomerError({ text: 'تعذر تحميل منشآت المنطقة.', login: false }) })
    return () => { active = false; controller.abort() }
  }, [rep, groups, city, mainId, stopsRetry])

  const pickStart = useCallback((point: Point) => { setStart(point); setPicking(false) }, [])

  // everything on the map comes from this one place
  useEffect(() => {
    const colors = new Map<string, string>()
    groups?.forEach((group, index) => group.districts.forEach((district) => {
      colors.set(String(district.district_id), rep == null || rep === index ? PALETTE[index % PALETTE.length] : DIM)
    }))
    onOverlay({
      colors: groups ? colors : null,
      points: customers,
      start,
      lines: parts.filter((part) => part?.line).map((part) => part.line as GeoJSON.LineString),
      onPick: picking ? pickStart : null,
    })
  }, [groups, rep, customers, start, parts, picking, pickStart, onOverlay])

  async function route() {
    if (!start || !customers?.length) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setParts([]); setRouteError(''); setProgress({ done: 0, total: 1 })
    try {
      await planRoute(start, customers, (part, done, total) => {
        if (controller.signal.aborted) return
        setParts((current) => { const next = [...current]; next[part.index] = part; return next })
        setProgress({ done, total })
      }, controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted) {
        // Other route windows may still be in flight after one fails. Stop them before
        // clearing partial results so they cannot repaint a failed route afterward.
        controller.abort()
        setParts([])
        setRouteError(failure instanceof Error ? failure.message : 'تعذر حساب المسار.')
      }
    }
  }

  const solved = parts.filter(Boolean)
  const meters = solved.reduce((total, part) => total + part.meters, 0)
  const seconds = solved.reduce((total, part) => total + part.seconds, 0)
  const order = useMemo(() => solved.flatMap((part) => part.order), [solved])
  const byId = useMemo(() => new Map((customers ?? []).map((customer) => [customer.id, customer])), [customers])
  const finished = progress != null && progress.done === progress.total && solved.length > 0

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">تقسيم المندوبين</h2>

      <Step n={1} title="نشاط عملائك" done={Boolean(mainId)}>
        <MainActivityPicker activities={activities} value={mainId} onChange={setMainId} placeholder="نشاط عملائك" allLabel="كل المنشآت" status={activityStatus} onRetry={retryActivities} />
      </Step>

      <Step n={2} title="المندوبون" done={Boolean(groups)}>
        <label className="flex items-center justify-between gap-3 text-base">العدد
          <input type="number" min={2} max={50} value={count} onChange={(e) => setCount(Math.min(50, Math.max(2, Number(e.target.value) || 2)))} className="h-11 w-24 rounded-lg border bg-background px-3 text-base" />
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['businesses', 'population', 'drive_time'] as const).map((value) => (
            <button key={value} onClick={() => setWeight(value)} aria-pressed={weight === value}
              className={cn('min-h-11 min-w-0 flex-1 rounded-lg border px-1.5 py-2 text-sm', weight === value ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
              {value === 'drive_time' ? 'زمن القيادة' : `توازن ${value === 'population' ? 'بالسكان' : mainId ? 'بعملاء النشاط' : 'بالمنشآت'}`}
            </button>
          ))}
        </div>
        {status === 'loading' && <Loader2 className="mt-2 size-5 animate-spin text-primary" aria-label="جارٍ التقسيم" />}
        {status === 'error' && (
          <p role="alert" className="mt-2 text-base text-destructive">
            {territoryLogin
              ? <>{territoryError} <Link href="/login?next=%2Fmap%3Ftool%3Dterritories" className="font-semibold underline">تسجيل الدخول</Link></>
              : <>{territoryError || 'تعذر التقسيم.'} <button onClick={() => setTerritoryRetry((version) => version + 1)} className="font-semibold underline">أعد المحاولة</button></>}
          </p>
        )}
        {groups && status !== 'loading' && (
          <>
            {groups.length > 0 ? <ol className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
              {groups.map((group, index) => (
                <li key={group.territory}>
                  <button onClick={() => setRep(index)} className={cn('flex min-h-11 w-full items-center gap-2 rounded-lg border p-2 text-start text-base', rep === index ? 'border-primary' : 'hover:border-primary')}>
                    <span className="size-3.5 shrink-0 rounded-sm" style={{ background: PALETTE[index % PALETTE.length] }} aria-hidden />
                    <span className="font-bold">المندوب {numberFormat.format(index + 1)}</span>
                    <span className="truncate text-sm text-muted-foreground">{counted(group.districts.length, 'district')}</span>
                    <Explained title={`حصة المندوب ${numberFormat.format(index + 1)}`} lines={EXPLAIN.territory(weight)} className="ms-auto shrink-0 font-semibold">
                      {weight === 'population' ? `${numberFormat.format(Math.round(group.weight))} ساكن` : weight === 'drive_time' ? duration(group.weight) : counted(Math.round(group.weight), 'business')}
                    </Explained>
                  </button>
                </li>
              ))}
            </ol> : <p role="status" className="mt-2 text-sm text-muted-foreground">لا تتوفر قيم موجبة كافية لإنشاء مناطق بهذا المقياس. جرّب {weight === 'drive_time' ? 'بالسكان أو المنشآت' : `الموازنة ${weight === 'population' ? 'بالمنشآت' : 'بالسكان'}`}.</p>}
            {weight === 'drive_time' && <p className="mt-2 text-sm text-muted-foreground">الوقت هو مجموع أزمنة الطريق المقاسة بين نقاط داخلية ممثلة للأحياء المتجاورة في مسار التغطية. لا يشمل نقطة انطلاق المندوب أو زيارات العملاء داخل الحي أو الزحام اللحظي؛ احسب مسار الزيارة بعد اختيار المندوب.</p>}
            {weight === 'population' && coverage?.unweighted_districts == null && <p className="mt-2 text-sm text-muted-foreground">تغطية قياس السكان غير متاحة؛ لا يمكن تأكيد أن كل الأحياء دخلت الموازنة.</p>}
            {weight === 'population' && coverage?.unweighted_districts != null && coverage.unweighted_districts > 0 && <p className="mt-2 text-sm text-muted-foreground">{numberFormat.format(coverage.unweighted_districts)} حياً بلا قياس سكاني لم يدخل التقسيم.</p>}
            {weight === 'drive_time' && coverage?.unweighted_districts != null && coverage.unweighted_districts > 0 && <p className="mt-2 text-sm text-muted-foreground">{numberFormat.format(coverage.unweighted_districts)} حياً بلا مركز صالح أو زمن طريق، لم يدخل موازنة القيادة.</p>}
            {weight === 'businesses' && coverage?.unlocated_businesses == null && <p className="mt-2 text-sm text-muted-foreground">تغطية مواقع المنشآت غير متاحة؛ لا يمكن تأكيد أن كل منشآت الدليل دخلت الموازنة.</p>}
            {weight === 'businesses' && coverage?.unlocated_businesses != null && coverage.unlocated_businesses > 0 && <p className="mt-2 text-sm text-muted-foreground">{numberFormat.format(coverage.unlocated_businesses)} منشأة من دليل المدينة بلا حي معروف، فلم تدخل موازنة المناطق.</p>}
          </>
        )}
      </Step>

      {rep != null && (
        <Step n={3} title={`عملاء المندوب ${numberFormat.format(rep + 1)}`} done={Boolean(customers?.length)}>
          {!customers && !customerError && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ التحميل" />}
          {customerError && (
            <p role="alert" className="text-base text-destructive">
              {customerError.text} {customerError.login ? <Link href="/login?next=%2Fmap%3Ftool%3Dterritories" className="font-semibold text-primary underline">تسجيل الدخول</Link> : <button onClick={() => setStopsRetry((version) => version + 1)} className="font-semibold underline">أعد المحاولة</button>}
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

      {customers && customers.length > 0 && start && (
        <Step n={5} title="مسار الزيارة" done={finished}>
          <button onClick={route} disabled={progress != null && !finished && !routeError} className="h-11 w-full rounded-lg bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60">
            {progress && !finished && !routeError ? `جارٍ الحساب: ${numberFormat.format(progress.done)} من ${numberFormat.format(progress.total)}` : finished ? 'أعد حساب المسار' : `احسب المسار لـ ${numberFormat.format(customers.length)} محطة`}
          </button>
          {progress && !finished && !routeError && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></div>
          )}
          {routeError && <p role="alert" className="mt-2 text-base text-destructive">{routeError}</p>}
          {finished && (
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
