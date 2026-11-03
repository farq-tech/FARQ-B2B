'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Calculator, ExternalLink, Loader2, Pencil, SearchX } from 'lucide-react'
import { Icon3D } from '@/components/shared/icon-3d'
import { EmptyState } from '@/components/shared/empty-state'
import { Explained } from '@/components/shared/explained'
import { ListingFace } from '@/components/shared/listing-face'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { LoadError } from '@/components/shared/load-error'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchSelect } from '@/components/shared/search-select'
import { Chip } from '@/components/ui/chip'
import { counted, numberFormat, postMarket, useCities } from '@/lib/insights-api'
import { SHOW_LISTING_PHOTOS, typeLabel } from '@/lib/real-estate'
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

/**
 * «سعّر عقارك»: a few questions about a property, then its likely price from the current listings most like it (same
 * deal and type, close in size, in its district and, when that has too few, the nearest districts), moved by the
 * stable rules from the north-Riyadh model (age, streets, street width, furnishing). It shows the range, every
 * adjustment with its percentage, and the comparables themselves, so the number can be checked.
 */
export function PriceEstimator() {
  const cities = useCities()
  const [city, setCity] = useState('Riyadh')
  // null while loading, 'error' when the list did not arrive (then a retry, not a picker that reads «غير متاح»)
  const [districts, setDistricts] = useState<{ id: string; name: string }[] | 'error' | null>(null)
  const [districtsAttempt, setDistrictsAttempt] = useState(0)
  const [district, setDistrict] = useState('')
  const [deal, setDeal] = useState('rent_year')
  const [kind, setKind] = useState<string>('floor')
  const [area, setArea] = useState('')
  const [age, setAge] = useState<string | null>(null)
  const [streets, setStreets] = useState<string | null>(null)
  const [width, setWidth] = useState<string | null>(null)
  const [furnished, setFurnished] = useState<string | null>('no')
  const [result, setResult] = useState<Estimate | 'loading' | 'error' | null>(null)
  // the answers the shown price was worked out for: its heading names them, and a later change marks it out of date
  const [asked, setAsked] = useState<{ key: string; kind: string; area: number; districtName?: string; deal: string } | null>(null)
  const answer = useRef<HTMLElement>(null)
  const questions = useRef<HTMLElement>(null)
  const [allExamples, setAllExamples] = useState(false)
  // a comparable whose photo fails to load shows its type's face instead of a broken image
  const [brokenPhotos, setBrokenPhotos] = useState<Set<string>>(new Set())
  // on a phone the answer sits under the questions: bring it into view once it arrives
  // (only there: on a wide screen it sits beside them, kept in view, and scrolling would pull the page away from the
  // question the person was on)
  useEffect(() => {
    if (!result || result === 'loading' || window.matchMedia('(min-width: 64rem)').matches) return
    answer.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }, [result])

  useEffect(() => {
    let live = true
    setDistricts(null); setDistrict('')
    postMarket<{ districts?: { district_id: string; district_ar: string }[] }>('real-estate', { city })
      .then((data) => { if (live) setDistricts((data.districts ?? []).map((row) => ({ id: row.district_id, name: row.district_ar })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))) })
      .catch(() => { if (live) setDistricts('error') })
    return () => { live = false }
  }, [city, districtsAttempt])
  const districtList = useMemo(() => (Array.isArray(districts) ? districts : []), [districts])
  const districtItems = useMemo(() => districtList.map((item) => ({ id: item.id, label: item.name })), [districtList])
  const cityItems = useMemo(() => cities.map((item) => ({ value: item.en, label: item.ar || item.en })), [cities])

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
    if (type !== kind) setKind(type)
    setAsked({ key: keyFor(type), kind: type, area: areaNumber, districtName: districtList.find((item) => item.id === district)?.name, deal })
    setResult('loading')
    setAllExamples(false)
    postMarket<Estimate>('price-estimate', {
      city, district_id: district, deal, type, area_sqm: areaNumber,
      ...(age ? { age } : {}), ...(streets ? { streets } : {}), ...(width ? { street_width: width } : {}), ...(furnished ? { furnished } : {}),
    }).then((estimate) => { if (ask === sequence.current) setResult(estimate) })
      .catch(() => { if (ask === sequence.current) setResult('error') })
  }
  const stale = asked != null && asked.key !== key && result !== 'loading'

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:py-10">
      <section ref={questions} className="flex scroll-mt-20 flex-col gap-5 rounded-3xl border bg-card p-5 shadow-sm" aria-label="أسئلة التسعير">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Calculator className="size-6 text-primary" aria-hidden />سعّر عقارك</h1>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">أجب عن الأسئلة، ونعطيك السعر المتوقع من أقرب العروض الحالية المشابهة لعقارك، مع سبب كل فرق.</p>
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
          <EmptyState heading="h2" icon={SearchX} title="غير متاح" body={REASONS[result.reason ?? ''] ?? 'تعذر حساب سعر نثق به لهذا العقار.'}
            // the same answers for the other types, one tap each, instead of scrolling back up to change one chip
            action={asked && result.reason !== 'no_listings' ? (
              <div className="flex flex-wrap justify-center gap-2">
                {KINDS.filter((id) => id !== asked.kind).map((id) => (
                  <Chip key={id} onClick={() => run(id)} disabled={!ready}><Icon3D type={id} className="size-5" />جرّب {typeLabel(id)}</Chip>
                ))}
              </div>
            ) : undefined} />
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
              <p className="mt-3 text-sm text-muted-foreground">
                <Explained title="كيف حسبناه" lines={[
                  result.comparables != null
                    ? `من ${numberFormat.format(result.comparables)} عرضاً حالياً من النوع نفسه وبمساحة قريبة (من 70% إلى 140% من مساحتك).`
                    : 'من العروض الحالية من النوع نفسه وبمساحة قريبة (من 70% إلى 140% من مساحتك).',
                  'المدى هو الربع الأدنى والأعلى من سعر المتر في هذه العروض، والوسط وسيطها، مضروبة في مساحتك.',
                  'ثم نعدّل للفروق التي ثبت أثرها في نموذج عروض شمال الرياض: العمر، وعدد الشوارع، وعرض الشارع، والتأثيث. حقول مثل المكيفات والحوش وغرفة العاملة لا تدخل لأن الإعلانات لا تذكرها بانتظام.',
                  'أسعار معروضة لا عقود، والعقود عادة أقل بنحو 5–10%.',
                ]} className="text-sm">
                  {result.comparables != null ? `من ${numberFormat.format(result.comparables)} عرضاً مشابهاً` : 'من العروض المشابهة'}{result.scope?.some((s) => s.district_ar) ? ` في ${result.scope.map((s) => s.district_ar).filter(Boolean).join('، ')}` : ''}
                </Explained>
              </p>
            </div>

            <div className="rounded-3xl border bg-card p-5">
              <h2 className="text-base font-bold">لماذا هذا السعر</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                <li className="flex justify-between gap-2"><span>وسيط سعر المتر في العروض المشابهة</span><span className="font-semibold tabular-nums">{sar(result.comparables_per_sqm!.mid)}</span></li>
                {result.adjustments?.length ? result.adjustments.map((a) => (
                  <li key={a.factor} className="flex justify-between gap-2"><span>{a.label}</span><span dir="ltr" className={cn('font-semibold tabular-nums', a.pct > 0 ? 'text-primary' : 'text-warning')}>{a.pct > 0 ? '+' : ''}{numberFormat.format(a.pct)}%</span></li>
                )) : <li className="text-muted-foreground">لا تعديل: عقارك مثل المعتاد في العروض المشابهة فيما نقيسه.</li>}
                <li className="flex justify-between gap-2 border-t pt-1.5"><span className="font-semibold">سعر المتر لعقارك</span><span className="font-bold tabular-nums">{sar(result.per_sqm!.mid)}</span></li>
              </ul>
            </div>

            {result.examples && result.examples.length > 0 && (
              <div className="rounded-3xl border bg-card p-5">
                <h2 className="text-base font-bold">أقرب العروض المشابهة</h2>
                {/* on a phone the first four (two rows), the rest one tap away, instead of four rows of squares under the price */}
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {result.examples.map((item, index) => (
                    <li key={item.id} className={cn(!allExamples && index >= PHONE_EXAMPLES && 'max-sm:hidden')}>
                      {/* the photo (or, without one, the type's face) and its figures; the ad one tap away under them */}
                      <div className="flex flex-col gap-1">
                        {SHOW_LISTING_PHOTOS && item.photo && !brokenPhotos.has(item.photo) ? (
                          <a href={item.url ?? undefined} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.photo} alt="" loading="lazy" decoding="async" onError={() => setBrokenPhotos((current) => new Set(current).add(item.photo!))} className="aspect-square w-full rounded-xl object-cover" />
                          </a>
                        ) : <ListingFace size="tile" type={item.type} className="aspect-square rounded-xl" />}
                        <span className="text-sm font-bold tabular-nums">{sar(item.price_sar)}</span>
                        <span className="text-xs text-muted-foreground">{[`${numberFormat.format(item.area_sqm)} م²`, item.beds ? counted(item.beds, 'room') : null, item.district_ar].filter(Boolean).join(' · ')}</span>
                        {item.url
                          ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 rounded text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-9"><ExternalLink className="size-3" aria-hidden />شاهد الإعلان<span className="sr-only">، يفتح في نافذة جديدة</span></a>
                          : <span className="text-xs text-muted-foreground">الإعلان غير متاح</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {!allExamples && result.examples.length > PHONE_EXAMPLES && (
                  <Button variant="ghost" size="sm" className="mt-2 w-full sm:hidden" onClick={() => setAllExamples(true)}>
                    اعرض الكل ({numberFormat.format(result.examples.length)})
                  </Button>
                )}
              </div>
            )}
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
