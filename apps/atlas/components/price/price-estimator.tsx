'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Building2, Calculator, ClipboardList, ExternalLink, Loader2, MapPinned, Pencil, SearchX } from 'lucide-react'
import { CopyLinkButton } from '@/components/shared/copy-link'
import { districtMapHref, homesHref, loginHref } from '@/lib/handoff'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import { makeId } from '@/lib/format'
import type { PublicDirectoryEntity } from '@/lib/live-directory'
import { Icon3D } from '@/components/shared/icon-3d'
import { EmptyState } from '@/components/shared/empty-state'
import { ListingFace } from '@/components/shared/listing-face'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { LoadError } from '@/components/shared/load-error'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchSelect } from '@/components/shared/search-select'
import { Chip } from '@/components/ui/chip'
import { counted, numberFormat, postMarket, useCities } from '@/lib/insights-api'
import { shownPhotos, typeLabel } from '@/lib/real-estate'
import { EXPLAIN } from '@/lib/explanations'
import { Stat } from '@/components/shared/stat'
import { Unavailable } from '@/components/shared/unavailable'
import { Gallery } from '@/components/lens/listing-card'
import { cn } from '@/lib/utils'

const DEALS = [['rent_year', 'إيجار سنوي'], ['rent_month', 'إيجار شهري'], ['sale', 'بيع']] as const
const KINDS = ['apartment', 'floor', 'villa'] as const
const AGES = [['0', 'جديد'], ['1-2', 'سنة أو سنتان'], ['3-5', '3–5 سنوات'], ['6-10', '6–10 سنوات'], ['11+', '11 سنة فأكثر']] as const
const STREETS = [['1', 'شارع واحد'], ['2', 'زاوية على شارعين'], ['3+', '3 شوارع فأكثر']] as const
const WIDTHS = [['lt15', 'أقل من 15 م'], ['15-19', '15–19 م'], ['20-29', '20–29 م'], ['30+', '30 م فأكثر']] as const
const PERIOD: Record<string, string> = { rent_year: ' سنوياً', rent_month: ' شهرياً', sale: '' }
const REASONS: Record<string, string> = {
  no_listings: 'لا توجد عروض حالية من هذا النوع في المدينة لنقارن بها.',
  district_has_no_listings: 'لا توجد عروض حالية من هذا النوع في الحي ولا نعرف موقعه بين الأحياء بعد. جرّب حياً قريباً.',
  too_few_comparables: 'العروض المشابهة في الحي وما حوله أقل من 15، وهذا لا يكفي لسعر نثق به. جرّب مساحة أقرب للمعتاد أو نوعاً آخر.',
}

type Estimate = {
  available: boolean
  reason?: string
  comparables?: number
  /** with too_few_comparables: how many the service needs for a price */
  needed?: number
  scope?: { district_id: string; district_ar: string | null; comparables: number }[]
  per_sqm?: { low: number; mid: number; high: number }
  price?: { low: number; mid: number; high: number }
  comparables_per_sqm?: { low: number; mid: number; high: number }
  adjustments?: { factor: string; label: string; pct: number }[]
  examples?: { id: string; url: string | null; photo: string | null; district_ar: string | null; type: string; price_sar: number; area_sqm: number; beds?: number; age?: number }[]
  rules_source?: string
  listings_retrieved?: string
}

function Question({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-base font-bold">{title}{hint && <span className="ms-2 text-xs font-normal text-muted-foreground">{hint}</span>}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

/** Comparables shown on a phone before «اعرض الكل». */
const PHONE_EXAMPLES = 4

const sar = (value: number) => `${numberFormat.format(value)} ريال`

type Answers = { city: string; district: string; deal: string; kind: string; area: string; age: string | null; streets: string | null; width: string | null; furnished: string | null }
const DEFAULT_ANSWERS: Answers = { city: 'Riyadh', district: '', deal: 'rent_year', kind: 'floor', area: '', age: null, streets: null, width: null, furnished: 'no' }
const oneOf = (value: string | null, ids: readonly (readonly [string, string])[] | readonly string[]) =>
  value != null && ids.some((id) => (typeof id === 'string' ? id : id[0]) === value) ? value : null

/** The answers a link carries, each kept only when it is one the page offers (city and district are checked once their lists load). */
function readAnswers(params: URLSearchParams | { get: (key: string) => string | null }): Answers {
  const area = (params.get('area') ?? '').replace(/[^0-9]/g, '').slice(0, 6)
  return {
    city: params.get('city')?.trim() || DEFAULT_ANSWERS.city,
    district: params.get('district')?.trim() ?? '',
    deal: oneOf(params.get('deal'), DEALS) ?? DEFAULT_ANSWERS.deal,
    kind: oneOf(params.get('type'), KINDS) ?? DEFAULT_ANSWERS.kind,
    area,
    age: oneOf(params.get('age'), AGES),
    streets: oneOf(params.get('streets'), STREETS),
    width: oneOf(params.get('width'), WIDTHS),
    furnished: oneOf(params.get('furnished'), ['no', 'yes']) ?? DEFAULT_ANSWERS.furnished,
  }
}

/** The answers as a query string, leaving out what is at its default so a plain visit keeps a plain address. */
function writeAnswers(answers: Answers): string {
  const query = new URLSearchParams()
  if (answers.city !== DEFAULT_ANSWERS.city) query.set('city', answers.city)
  if (answers.district) query.set('district', answers.district)
  if (answers.deal !== DEFAULT_ANSWERS.deal) query.set('deal', answers.deal)
  if (answers.kind !== DEFAULT_ANSWERS.kind) query.set('type', answers.kind)
  if (answers.area) query.set('area', answers.area)
  if (answers.age) query.set('age', answers.age)
  if (answers.streets) query.set('streets', answers.streets)
  if (answers.width) query.set('width', answers.width)
  if (answers.furnished && answers.furnished !== DEFAULT_ANSWERS.furnished) query.set('furnished', answers.furnished)
  return query.toString()
}

/**
 * «سعّر عقارك»: a few questions about a property, then its likely price from the current listings most like it (same
 * deal and type, close in size, in its district and, when that has too few, the nearest districts), moved by the
 * stable rules from the north-Riyadh model (age, streets, street width, furnishing). It shows the range, every
 * adjustment with its percentage, and the comparables themselves, so the number can be checked.
 */
export function PriceEstimator() {
  const cities = useCities()
  // the answers live in the address too (?city=…&district=…&area=…): an estimate can be reopened or shared as a link
  // inside Atlas and comes back with the same answers, and its price is worked out again from today's listings.
  // A value the page does not know is dropped, never guessed.
  const params = useSearchParams()
  const [initial] = useState(() => readAnswers(params))
  const [city, setCityState] = useState(initial.city)
  // null while loading, 'error' when the list did not arrive (then a retry, not a picker that reads «غير متاح»)
  const [districts, setDistricts] = useState<{ id: string; name: string }[] | 'error' | null>(null)
  const [districtsAttempt, setDistrictsAttempt] = useState(0)
  const [district, setDistrict] = useState(initial.district)
  // a new city starts with no district (the URL's district belongs to the city it came with)
  const setCity = (next: string) => { if (next !== city) { setCityState(next); setDistrict('') } }
  const [deal, setDeal] = useState(initial.deal)
  const [kind, setKind] = useState<string>(initial.kind)
  const [area, setArea] = useState(initial.area)
  const [age, setAge] = useState<string | null>(initial.age)
  const [streets, setStreets] = useState<string | null>(initial.streets)
  const [width, setWidth] = useState<string | null>(initial.width)
  const [furnished, setFurnished] = useState<string | null>(initial.furnished)
  const [result, setResult] = useState<Estimate | 'loading' | 'error' | null>(null)
  // the answers the shown price was worked out for: its heading names them, and a later change marks it out of date
  const [asked, setAsked] = useState<{ key: string; kind: string; area: number; city: string; district: string; districtName?: string; deal: string } | null>(null)
  const answer = useRef<HTMLElement>(null)
  const questions = useRef<HTMLElement>(null)
  // on a phone the answer sits under the questions: bring it into view once it arrives
  // (only there: on a wide screen it sits beside them, kept in view, and scrolling would pull the page away from the
  // question the person was on)
  useEffect(() => {
    if (!result || result === 'loading' || window.matchMedia('(min-width: 64rem)').matches) return
    answer.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }, [result])

  useEffect(() => {
    let live = true
    setDistricts(null)
    postMarket<{ districts?: { district_id: string; district_ar: string }[] }>('real-estate', { city })
      .then((data) => {
        if (!live) return
        const list = (data.districts ?? []).map((row) => ({ id: row.district_id, name: row.district_ar })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
        setDistricts(list)
        // a district from the address that this city does not have is dropped
        setDistrict((current) => (current && !list.some((item) => item.id === current) ? '' : current))
      })
      .catch(() => { if (live) setDistricts('error') })
    return () => { live = false }
  }, [city, districtsAttempt])
  const districtList = useMemo(() => (Array.isArray(districts) ? districts : []), [districts])
  const districtItems = useMemo(() => districtList.map((item) => ({ id: item.id, label: item.name })), [districtList])
  const cityItems = useMemo(() => cities.map((item) => ({ value: item.en, label: item.ar || item.en })), [cities])

  // the address follows the answers. Each priced answer is its own history entry (marked PRICED), so Back returns to
  // the price before: a change made on a priced entry starts a new entry, and further changes replace that one, so
  // «back» never undoes one chip at a time
  const pendingMark = useRef(false)
  useEffect(() => {
    const query = writeAnswers({ city, district, deal, kind, area, age, streets, width, furnished })
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname
    const mark = pendingMark.current
    pendingMark.current = false
    if (next === `${window.location.pathname}${window.location.search}`) { if (mark) markPriced(); return }
    const priced = Boolean((window.history.state as Record<string, unknown> | null)?.[PRICED])
    if (priced) window.history.pushState(mark ? { [PRICED]: true } : {}, '', next)
    else window.history.replaceState(mark ? { ...window.history.state, [PRICED]: true } : window.history.state, '', next)
  }, [city, district, deal, kind, area, age, streets, width, furnished])
  // Back or Forward onto another entry of this page: its answers, priced again from today's listings if it was priced
  const rerun = useRef(false)
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname !== '/price') return
      const back = readAnswers(new URLSearchParams(window.location.search))
      setCityState(back.city); setDistrict(back.district); setDeal(back.deal); setKind(back.kind); setArea(back.area)
      setAge(back.age); setStreets(back.streets); setWidth(back.width); setFurnished(back.furnished)
      if ((window.history.state as Record<string, unknown> | null)?.[PRICED]) rerun.current = true
      else { sequence.current++; setResult(null); setAsked(null) }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const areaNumber = Number(area.replace(/[^0-9]/g, ''))
  const ready = district && areaNumber >= 10
  const keyFor = (type: string) => JSON.stringify([city, district, deal, type, areaNumber, age, streets, width, furnished])
  const key = keyFor(kind)
  // each «احسب» numbers its request; an answer that comes back after a newer one was asked is dropped, so a slow
  // first estimate can never replace the price of the answers on screen
  const sequence = useRef(0)
  // `type` runs the same answers for another property type (the «جرّب» chips under an unavailable price)
  const run = (type = kind) => {
    if (!ready) return
    const ask = ++sequence.current
    // this entry now holds a price; with another type the address changes first, and the entry is marked then
    if (type === kind) markPriced()
    else pendingMark.current = true
    if (type !== kind) setKind(type)
    setAsked({ key: keyFor(type), kind: type, area: areaNumber, city, district, districtName: districtList.find((item) => item.id === district)?.name, deal })
    setResult('loading')
    postMarket<Estimate>('price-estimate', {
      city, district_id: district, deal, type, area_sqm: areaNumber,
      ...(age ? { age } : {}), ...(streets ? { streets } : {}), ...(width ? { street_width: width } : {}), ...(furnished ? { furnished } : {}),
    }).then((estimate) => { if (ask === sequence.current) setResult(estimate) })
      .catch(() => { if (ask === sequence.current) setResult('error') })
  }
  // a link that carries a district and an area prices itself once the district list confirms the district
  const autoRun = useRef(Boolean(initial.district && Number(initial.area) >= 10))
  useEffect(() => {
    if (!autoRun.current || !Array.isArray(districts)) return
    autoRun.current = false
    if (ready) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the list arrives
  }, [districts])
  // an entry Back landed on that held a price is priced again once its answers (and its city's districts) are in
  useEffect(() => {
    if (!rerun.current || !Array.isArray(districts)) return
    rerun.current = false
    if (ready) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the restored answers settle
  }, [key, districts])
  const stale = asked != null && asked.key !== key && result !== 'loading'
  // the districts the comparables came from, for «أحياء المقارنة»
  const scopeNames = result && typeof result === 'object' ? (result.scope ?? []).map((item) => item.district_ar).filter((name): name is string => Boolean(name)) : []

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:py-10">
      <section ref={questions} className="flex scroll-mt-20 flex-col gap-5 rounded-3xl border bg-card p-5 shadow-sm" aria-label="أسئلة التسعير">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Calculator className="size-6 text-primary" aria-hidden />سعّر عقارك</h1>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">أجب عن الأسئلة، ونعطيك السعر المتوقع من أقرب العروض الحالية المشابهة لعقارك، مع سبب كل فرق.</p>
          {/* the answers are in the address: the link reopens them and prices them again from today's listings */}
          <CopyLinkButton className="mt-3 h-9 bg-background shadow-none" description="يفتح التسعير بالإجابات نفسها، ويحسبه من عروض اليوم." />
        </header>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span id="price-city" className="text-sm font-semibold">المدينة</span>
            <Select items={cityItems} value={city} onValueChange={(next) => { if (next) setCity(next as string) }}>
              <SelectTrigger aria-labelledby="price-city" className="h-11 w-full bg-background text-base"><SelectValue /></SelectTrigger>
              <SelectContent>
                {cityItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {/* a city has up to 200 districts: a list that is typed into, not one to scroll */}
          <label className="flex flex-col gap-1 text-sm font-semibold">الحي
            <SearchSelect items={districtItems} value={district} onChange={setDistrict} disabled={!districtList.length} className="font-normal"
              placeholder={districts === null ? 'جارٍ التحميل…' : districts === 'error' ? 'تعذر التحميل' : districts.length ? 'اكتب أو اختر الحي' : 'غير متاح'} />
          </label>
        </div>
        {districts === 'error' && <LoadError what="أحياء المدينة" onRetry={() => setDistrictsAttempt((n) => n + 1)} />}
        <Question title="الصفقة">{DEALS.map(([id, label]) => <Chip key={id} active={deal === id} onClick={() => setDeal(id)}>{label}</Chip>)}</Question>
        <Question title="نوع العقار">
          {KINDS.map((id) => <Chip key={id} active={kind === id} onClick={() => setKind(id)}><Icon3D type={id} className="size-6" />{typeLabel(id)}</Chip>)}
        </Question>
        <label className="flex flex-col gap-1 text-base font-bold">المساحة
          <span className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
            <input inputMode="numeric" dir="ltr" placeholder="مثل 180" value={area} onChange={(e) => setArea(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && ready && result !== 'loading') run() }} enterKeyHint="go"
              className="h-11 w-full bg-transparent text-end text-base font-semibold tabular-nums outline-none placeholder:font-normal" />
            <span className="text-sm font-normal text-muted-foreground">م²</span>
          </span>
        </label>
        <Question title="عمر العقار">{AGES.map(([id, label]) => <Chip key={id} active={age === id} onClick={() => setAge(age === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="الشوارع" hint="عدد الشوارع أهم من جهة الواجهة">{STREETS.map(([id, label]) => <Chip key={id} active={streets === id} onClick={() => setStreets(streets === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="عرض الشارع">{WIDTHS.map(([id, label]) => <Chip key={id} active={width === id} onClick={() => setWidth(width === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="التأثيث">{[['no', 'غير مفروش'], ['yes', 'مفروش']].map(([id, label]) => <Chip key={id} active={furnished === id} onClick={() => setFurnished(id)}>{label}</Chip>)}</Question>
        <Button size="lg" onClick={() => run()} disabled={!ready || result === 'loading'} className="w-full">
          {result === 'loading' ? <Loader2 className="animate-spin" aria-hidden /> : <Calculator aria-hidden />} احسب السعر
        </Button>
        {!ready && (
          <p className="text-center text-xs text-muted-foreground">
            {/* a city with no listings has no district to pick: say so, instead of asking for one that cannot be chosen */}
            {Array.isArray(districts) && !districts.length ? 'التسعير غير متاح في هذه المدينة بعد: لا عروض حالية فيها نقارن بها. اختر مدينة أخرى.' : 'اختر الحي واكتب المساحة لتحسب السعر.'}
          </p>
        )}
      </section>

      <section ref={answer} aria-live="polite" aria-label="السعر المتوقع" className="flex scroll-mt-20 flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-2">
        {result === null && <EmptyState heading="h2" icon={Calculator} title="السعر يظهر هنا" body="نقارن عقارك بأقرب العروض الحالية في حيه وما حوله، ونعدّل للفروق التي ثبت أثرها في البيانات." />}
        {result === 'loading' && (
          <SkeletonStatus label="جارٍ حساب السعر" className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <div className="flex flex-col gap-2.5 rounded-3xl border bg-card p-5">
              <Skeleton className="h-5 w-32" />
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex justify-between gap-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-16" /></div>
              ))}
            </div>
          </SkeletonStatus>
        )}
        {result === 'error' && <LoadError what="السعر" onRetry={() => run()} />}
        {result && result !== 'loading' && result !== 'error' && !result.available && (
          <div className="flex flex-col gap-4">
            <EmptyState heading="h2" icon={SearchX} title="غير متاح" body={unavailableBody(result)}
              // the same answers for the other types, one tap each, instead of scrolling back up to change one chip
              action={asked && result.reason !== 'no_listings' ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {KINDS.filter((id) => id !== asked.kind).map((id) => (
                    <Chip key={id} onClick={() => run(id)} disabled={!ready}><Icon3D type={id} className="size-5" />جرّب {typeLabel(id)}</Chip>
                  ))}
                </div>
              ) : undefined} />
            {/* no price, but what was found is real: the districts tried, nearest first, with what each held, and the
                few listings themselves; never a range drawn from them */}
            {result.scope && result.scope.length > 0 && (
              <div className="rounded-3xl border bg-card p-5">
                <h2 className="text-base font-bold">الأحياء التي بحثنا فيها</h2>
                <ul className="mt-2 flex flex-col divide-y text-sm">
                  {result.scope.map((row, index) => (
                    <li key={row.district_id} className="flex items-center justify-between gap-2 py-1.5">
                      <span>{row.district_ar ?? 'حي غير مسمّى'}{index === 0 ? <span className="ms-1.5 text-xs text-muted-foreground">(حي عقارك)</span> : null}</span>
                      <span className="tabular-nums text-muted-foreground">{row.comparables ? counted(row.comparables, 'listing') : 'لا عروض مشابهة'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.examples && result.examples.length > 0 && <Comparables title="العروض المشابهة التي وجدناها" examples={result.examples} />}
            {asked && <NextLinks asked={asked} cityName={cityItems.find((item) => item.value === asked.city)?.label ?? asked.city} />}
          </div>
        )}
        {stale && result && result !== 'error' && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-warning/30 bg-warning/5 p-3 text-sm">
            <span>غيّرت الإجابات. السعر أدناه لعقارك كما كان، احسبه من جديد ليطابق إجاباتك.</span>
            <Button size="sm" variant="outline" onClick={() => run()} disabled={!ready}><Calculator aria-hidden />احسب من جديد</Button>
          </div>
        )}
        {result && result !== 'loading' && result !== 'error' && result.available && result.price && asked && (
          <div className={cn('flex flex-col gap-4 transition-opacity', stale && 'opacity-50')}>
            <div className="rounded-3xl border bg-card p-5 shadow-sm">
              <p className="text-sm text-muted-foreground">{typeLabel(asked.kind)} {numberFormat.format(asked.area)} م² في {asked.districtName ?? 'حي غير متاح'}</p>
              <p className="mt-1 text-4xl font-bold tabular-nums">{sar(result.price.mid)}<span className="text-lg font-semibold text-muted-foreground">{PERIOD[asked.deal]}</span></p>
              <p className="mt-1 text-base">
                المدى المتوقع: <span className="font-semibold tabular-nums">{numberFormat.format(result.price.low)} – {numberFormat.format(result.price.high)}</span> ريال
              </p>
              <div className="mt-3 h-2 rounded-full bg-gradient-to-l from-primary/80 via-primary/40 to-primary/10" aria-hidden />
              {/* the figures behind the price, each the shared Stat: a tap says how it was worked out (lib/explanations.ts),
                  a figure the answer lacks reads «غير متاح» */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Stat label="عروض مشابهة" value={result.comparables != null ? numberFormat.format(result.comparables) : null} explain={EXPLAIN.priceEstimate(result.comparables)} />
                <Stat label="أحياء المقارنة" value={scopeNames.length ? numberFormat.format(scopeNames.length) : null}
                  explain={scopeNames.length ? [...EXPLAIN.priceScope, scopeNames.join('، ')] : EXPLAIN.priceScope} />
                <Stat label="سعر المتر لعقارك" value={result.per_sqm ? sar(result.per_sqm.mid) : null} explain={EXPLAIN.pricePerSqm} />
              </div>
            </div>

            <div className="rounded-3xl border bg-card p-5">
              <h2 className="text-base font-bold">لماذا هذا السعر</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                <li className="flex justify-between gap-2"><span>وسيط سعر المتر في العروض المشابهة</span><span className="font-semibold tabular-nums">{result.comparables_per_sqm ? sar(result.comparables_per_sqm.mid) : <Unavailable />}</span></li>
                {result.adjustments?.length ? result.adjustments.map((a) => (
                  <li key={a.factor} className="flex justify-between gap-2"><span>{a.label}</span><span dir="ltr" className={cn('font-semibold tabular-nums', a.pct > 0 ? 'text-primary' : 'text-warning')}>{a.pct > 0 ? '+' : ''}{numberFormat.format(a.pct)}%</span></li>
                )) : <li className="text-muted-foreground">لا تعديل: عقارك مثل المعتاد في العروض المشابهة فيما نقيسه.</li>}
                <li className="flex justify-between gap-2 border-t pt-1.5"><span className="font-semibold">سعر المتر لعقارك</span><span className="font-bold tabular-nums">{result.per_sqm ? sar(result.per_sqm.mid) : <Unavailable />}</span></li>
              </ul>
            </div>

            {result.examples && result.examples.length > 0 && <Comparables title="أقرب العروض المشابهة" examples={result.examples} />}
            <NextLinks asked={asked} cityName={cityItems.find((item) => item.value === asked.city)?.label ?? asked.city} price={result.price.mid} />
            {/* on a phone the questions are a long scroll above: one tap back to change an answer */}
            <Button variant="outline" className="lg:hidden" onClick={() => questions.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}>
              <Pencil aria-hidden />عدّل الإجابات
            </Button>
          </div>
        )}
      </section>
    </main>
  )
}

/**
 * Where a priced property leads next: the current listings like it in its district (the same deal and type), and the
 * district itself on the map. Each opens on the answers already given, nothing typed again.
 */
const PLURAL: Record<string, string> = { apartment: 'الشقق', floor: 'الأدوار', villa: 'الفلل' }
/** The real-estate businesses of the directory (its «عقار» main activity), asked by its category id. */
const REAL_ESTATE = { main_id: 're', label: 'عقار' }
const DEAL_WORD: Record<string, string> = { rent_year: 'للإيجار السنوي', rent_month: 'للإيجار الشهري', sale: 'للبيع' }

/**
 * A priced property turned into a quote request to the district's real-estate businesses: the draft names the property
 * (type, deal, area, district) and Atlas's expected price, and opens in «الطلبات» for review. Nothing is sent: a quote
 * request is shared by the person after review (docs/atlas-product-foundation.md §1.5), and no contact is shown here.
 */
function OfficesRequest({ asked, cityName, price }: { asked: { city: string; district: string; districtName?: string; deal: string; kind: string; area: number }; cityName: string; price?: number }) {
  const router = useRouter()
  const { createDraft } = useAppStore()
  const [state, setState] = useState<'idle' | 'loading' | 'login' | 'empty' | 'error'>('idle')
  const name = asked.districtName ?? 'الحي'
  const start = async () => {
    if (!asked.districtName) return
    setState('loading')
    const response = await fetch('/api/market/entities', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city: asked.city, district: asked.districtName, main_id: REAL_ESTATE.main_id, q: REAL_ESTATE.label, objective: 'purchase', limit: 50, offset: 0 }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null) as { rows?: PublicDirectoryEntity[]; guest?: boolean } | null
    // a signed-out visitor sees the sign-in, never a preview turned into a request
    if (response?.status === 401 || body?.guest) { setState('login'); return }
    if (!response?.ok || !body) { setState('error'); return }
    const rows = body.rows ?? []
    if (!rows.length) { setState('empty'); return }
    const property = `${typeLabel(asked.kind)} ${DEAL_WORD[asked.deal] ?? ''} في ${name}`.replace(/\s+/g, ' ')
    const id = createDraft({
      type: 'rfq', businessIds: rows.map((row) => row.id), liveBusinesses: rows, cityId: asked.city.toLowerCase(), cityName,
      query: REAL_ESTATE.label, categoryHint: REAL_ESTATE.label, districtHint: name,
      title: `طلب عروض ${property}`,
      rfq: {
        lineItems: [{ id: makeId('l'), name: property, qty: 1, unit: 'عقار', spec: `${numberFormat.format(asked.area)} م²` }],
        deliveryCity: cityName,
        notes: price != null ? `السعر المتوقع في أطلس: ${numberFormat.format(price)} ريال${PERIOD[asked.deal] ?? ''}. أرسلوا عروضاً مشابهة إن وُجدت.` : 'أرسلوا عروضاً مشابهة إن وُجدت.',
      },
    })
    toast.success('جُهّز طلب العروض', { description: `${numberFormat.format(rows.length)} منشأة عقار في ${name}. راجعه قبل أي مشاركة، لا يُرسل شيء تلقائياً.` })
    router.push(`/requests/${id}`)
  }
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <button type="button" onClick={() => void start()} disabled={state === 'loading' || !asked.districtName}
        className="inline-flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-start text-sm font-semibold outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
        {state === 'loading' ? <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden /> : <ClipboardList className="size-5 shrink-0 text-primary" aria-hidden />}
        <span>اطلب عروضاً مشابهة من منشآت العقار في {name}</span>
      </button>
      {state === 'login' && <p className="text-sm">لتجهيز الطلب <a href={loginHref(`${window.location.pathname}${window.location.search}`)} className="font-semibold text-primary underline">سجّل الدخول</a>.</p>}
      {state === 'empty' && <p className="text-sm text-muted-foreground">لا منشآت عقار في {name} في الدليل.</p>}
      {state === 'error' && <p role="alert" className="flex items-center gap-2 text-sm text-muted-foreground">تعذّر التحميل.<Chip onClick={() => void start()}>أعد المحاولة</Chip></p>}
    </div>
  )
}

function NextLinks({ asked, cityName, price }: { asked: { city: string; district: string; districtName?: string; deal: string; kind: string; area: number }; cityName: string; price?: number }) {
  const name = asked.districtName ?? 'الحي'
  const listings = homesHref({ city: asked.city, kind: asked.deal === 'sale' ? 'sale' : 'rent', rentDeal: asked.deal === 'sale' ? 'rent_year' : asked.deal, types: [asked.kind], districts: [asked.district] })
  const map = districtMapHref(asked.city, asked.district)
  const link = 'inline-flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm font-semibold outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <nav aria-label="بعد التسعير" className="grid gap-2 sm:grid-cols-2">
      <Link href={listings} className={link}><Building2 className="size-5 shrink-0 text-primary" aria-hidden /><span>{PLURAL[asked.kind] ?? 'العروض'} {asked.deal === 'sale' ? 'للبيع' : 'للإيجار'} الآن في {name}</span></Link>
      {map && <Link href={map} className={link}><MapPinned className="size-5 shrink-0 text-primary" aria-hidden /><span>تعرّف على {name} على الخريطة</span></Link>}
      <OfficesRequest asked={asked} cityName={cityName} price={price} />
    </nav>
  )
}

/** The history state of an entry whose answers were priced (Back to it prices them again). */
const PRICED = 'atlasPriced'
const markPriced = () => window.history.replaceState({ ...window.history.state, [PRICED]: true }, '', window.location.href)

type Example = NonNullable<Estimate['examples']>[number]

/** The comparable listings as photo tiles: the first four on a phone, the rest one tap away. */
function Comparables({ title, examples }: { title: string; examples: Example[] }) {
  const [allExamples, setAllExamples] = useState(false)
  return (
    <div className="rounded-3xl border bg-card p-5">
      <h2 className="text-base font-bold">{title}</h2>
      {/* on a phone the first four (two rows), the rest one tap away, instead of four rows of squares under the price */}
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {examples.map((item, index) => (
          <li key={item.id} className={cn(!allExamples && index >= PHONE_EXAMPLES && 'max-sm:hidden')}>
            {/* the photo (or, without one, the type's face) and its figures; the ad one tap away under them */}
            <div className="flex flex-col gap-1">
              {/* the same photo slot as a results card: the ad's photo as published (a tap opens it full size),
                  and the type's face when there is none or it fails to load */}
              <div className="overflow-hidden rounded-xl">
                <Gallery photos={shownPhotos({ photo: item.photo, photos: [] })} className="aspect-square"
                  fallback={<ListingFace size="tile" type={item.type} className="aspect-square" />} />
              </div>
              <span className="text-sm font-bold tabular-nums">{sar(item.price_sar)}</span>
              <span className="text-xs text-muted-foreground">{[`${numberFormat.format(item.area_sqm)} م²`, item.beds ? counted(item.beds, 'room') : null, item.district_ar].filter(Boolean).join(' · ')}</span>
              {item.url
                ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 rounded text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-9"><ExternalLink className="size-3" aria-hidden />شاهد الإعلان<span className="sr-only">، يفتح في نافذة جديدة</span></a>
                : <span className="text-xs text-muted-foreground">الإعلان غير متاح</span>}
            </div>
          </li>
        ))}
      </ul>
      {!allExamples && examples.length > PHONE_EXAMPLES && (
        <Button variant="ghost" size="sm" className="mt-2 w-full sm:hidden" onClick={() => setAllExamples(true)}>
          اعرض الكل ({numberFormat.format(examples.length)})
        </Button>
      )}
    </div>
  )
}

/** Why there is no price, in the person's terms: the count found against the count needed when the answer has them. */
function unavailableBody(result: Estimate): string {
  if (result.reason === 'too_few_comparables' && result.comparables != null && result.needed != null) {
    return `العروض المشابهة في الحي وما حوله ${numberFormat.format(result.comparables)}، ونحتاج ${numberFormat.format(result.needed)} على الأقل لسعر نثق به. جرّب مساحة أقرب للمعتاد أو نوعاً آخر.`
  }
  return REASONS[result.reason ?? ''] ?? 'تعذر حساب سعر نثق به لهذا العقار.'
}
