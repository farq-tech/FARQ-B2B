'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Calculator, ExternalLink, Loader2, SearchX } from 'lucide-react'
import { Icon3D } from '@/components/shared/icon-3d'
import { EmptyState } from '@/components/shared/empty-state'
import { CityCatalogStatus } from '@/components/shared/city-catalog-status'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { cityLabel, numberFormat, postMarket, useCities } from '@/lib/insights-api'
import { parsePriceEstimateResponse, type PriceEstimate } from '@/lib/price-estimate-response'
import { normalizeNumericInput, parseFilterInteger } from '@/lib/numeric-input'
import { typeLabel } from '@/lib/real-estate'
import { cn } from '@/lib/utils'

const DEALS = [['rent_year', 'إيجار سنوي'], ['rent_month', 'إيجار شهري'], ['sale', 'بيع']] as const
const KINDS = ['apartment', 'floor', 'villa'] as const
const AGES = [['0', 'جديد'], ['1-2', 'سنة أو سنتان'], [`3-${numberFormat.format(5)}`, `${numberFormat.format(3)}–${numberFormat.format(5)} سنوات`], [`6-${numberFormat.format(10)}`, `${numberFormat.format(6)}–${numberFormat.format(10)} سنوات`], [`${numberFormat.format(11)}+`, `${numberFormat.format(11)} سنة فأكثر`]] as const
const STREETS = [['1', 'شارع واحد'], ['2', 'زاوية على شارعين'], [`${numberFormat.format(3)}+`, `${numberFormat.format(3)} شوارع فأكثر`]] as const
const WIDTHS = [['lt15', `أقل من ${numberFormat.format(15)} م`], [`15-${numberFormat.format(19)}`, `${numberFormat.format(15)}–${numberFormat.format(19)} م`], [`20-${numberFormat.format(29)}`, `${numberFormat.format(20)}–${numberFormat.format(29)} م`], [`${numberFormat.format(30)}+`, `${numberFormat.format(30)} م فأكثر`]] as const
const PERIOD: Record<string, string> = { rent_year: ' سنوياً', rent_month: ' شهرياً', sale: '' }
const REASONS: Record<string, string> = {
  no_listings: 'لا توجد عروض حالية من هذا النوع في المدينة لنقارن بها.',
  district_has_no_listings: 'لا توجد عروض حالية من هذا النوع في الحي ولا نعرف موقعه بين الأحياء بعد. جرّب حياً قريباً.',
  too_few_comparables: `العروض المشابهة في الحي وما حوله أقل من ${numberFormat.format(15)}، وهذا لا يكفي لسعر نثق به. جرّب مساحة أقرب للمعتاد أو نوعاً آخر.`,
}

function Question({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-base font-bold">{title}{hint && <span className="ms-2 text-xs font-normal text-muted-foreground">{hint}</span>}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

const sar = (value: number) => `${numberFormat.format(value)} ريال`

/**
 * «سعّر عقارك»: a few questions about a property, then its likely price from the current listings most like it (same
 * deal and type, close in size, in its district and, when that has too few, the nearest districts). Calibrated rules
 * apply only to their verified geography, deal and property type. It shows the range, every adjustment with its
 * percentage, and the comparables themselves, so the number can be checked.
 */
export function PriceEstimator() {
  const { cities, status: citiesStatus, retry: retryCities } = useCities()
  const [city, setCity] = useState('Riyadh')
  const [districtRequest, setDistrictRequest] = useState<{ city: string; status: 'loading' | 'ready' | 'unavailable' | 'error'; districts: { id: string; name: string }[] } | null>(null)
  const [districtAttempt, setDistrictAttempt] = useState(0)
  const [district, setDistrict] = useState('')
  const [deal, setDeal] = useState('rent_year')
  const [kind, setKind] = useState<string>('floor')
  const [area, setArea] = useState('')
  const [age, setAge] = useState<string | null>(null)
  const [streets, setStreets] = useState<string | null>(null)
  const [width, setWidth] = useState<string | null>(null)
  const [furnished, setFurnished] = useState<string | null>('no')
  const [estimateState, setEstimateState] = useState<{ key: string; request: number; value: PriceEstimate | 'loading' | 'error' } | null>(null)
  const estimateKey = JSON.stringify([city, district, deal, kind, area, age, streets, width, furnished])
  const requestId = useRef(0)
  const result = estimateState?.key === estimateKey && (estimateState.value !== 'loading' || estimateState.request === requestId.current) ? estimateState.value : null
  const answer = useRef<HTMLElement>(null)
  useEffect(() => { requestId.current += 1 }, [estimateKey])
  // on a phone the answer sits under the questions: bring it into view once it arrives
  useEffect(() => { if (result && result !== 'loading') answer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [result])

  useEffect(() => {
    let live = true
    setDistrict('')
    setDistrictRequest({ city, status: 'loading', districts: [] })
    postMarket<{ available?: unknown; districts?: { district_id: string; district_ar: string }[] }>('real-estate', { city })
      .then((data) => {
        if (!Array.isArray(data.districts) || typeof data.available !== 'boolean') throw new Error('Invalid real estate district response')
        if (!live) return
        const options = data.districts.map((row) => ({ id: row.district_id, name: row.district_ar })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
        setDistrictRequest({ city, status: data.available && options.length ? 'ready' : 'unavailable', districts: options })
      })
      .catch(() => { if (live) setDistrictRequest({ city, status: 'error', districts: [] }) })
    return () => { live = false }
  }, [city, districtAttempt])

  const districts = districtRequest?.city === city ? districtRequest.districts : []
  const districtStatus = districtRequest?.city === city ? districtRequest.status : 'loading'
  const parsedArea = parseFilterInteger(area)
  const areaNumber = parsedArea ?? 0
  const ready = districtStatus === 'ready' && districts.some((item) => item.id === district)
    && parsedArea != null && parsedArea >= 10 && parsedArea <= 100_000
  const run = () => {
    if (!ready) return
    const key = estimateKey
    const request = ++requestId.current
    setEstimateState({ key, request, value: 'loading' })
    postMarket<unknown>('price-estimate', {
      city, district_id: district, deal, type: kind, area_sqm: areaNumber,
      ...(age ? { age } : {}), ...(streets ? { streets } : {}), ...(width ? { street_width: width } : {}), ...(furnished ? { furnished } : {}),
    }).then((payload) => {
      const value = parsePriceEstimateResponse(payload)
      if (requestId.current === request) setEstimateState({ key, request, value })
    }).catch(() => {
      if (requestId.current === request) setEstimateState({ key, request, value: 'error' })
    })
  }
  const selectedCity = cities.find((item) => item.en === city)
  const cityAr = selectedCity?.ar || city
  const districtName = districts?.find((item) => item.id === district)?.name

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:py-10">
      <section className="flex flex-col gap-5 rounded-3xl border bg-card p-5 shadow-sm" aria-label="أسئلة التسعير">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Calculator className="size-6 text-primary" aria-hidden />سعّر عقارك</h1>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">أجب عن الأسئلة، ونحسب نطاقاً إرشادياً من أقرب العروض الحالية المشابهة لعقارك، مع سبب كل فرق.</p>
        </header>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">المدينة
            <select value={city} onChange={(e) => setCity(e.target.value)} className="h-11 rounded-xl border bg-background px-3 text-base font-normal">
              {cities.map((item) => <option key={item.en} value={item.en}>{cityLabel(item)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">الحي
            <select value={district} onChange={(e) => setDistrict(e.target.value)} disabled={districtStatus !== 'ready'} className="h-11 rounded-xl border bg-background px-3 text-base font-normal disabled:opacity-60">
              <option value="">{districtStatus === 'loading' ? 'جارٍ التحميل…' : districtStatus === 'error' ? 'تعذر تحميل الأحياء' : districtStatus === 'unavailable' ? 'التسعير غير متاح' : 'اختر الحي'}</option>
              {districts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
        <CityCatalogStatus status={citiesStatus} retry={retryCities} />
        {districtStatus === 'error' && <p role="alert" className="text-sm text-destructive">تعذر تحميل أحياء التسعير. <button type="button" onClick={() => setDistrictAttempt((value) => value + 1)} className="font-semibold underline underline-offset-2">أعد المحاولة</button></p>}
        {districtStatus === 'unavailable' && <p className="text-sm text-muted-foreground">
          {selectedCity?.districts === 0
            ? `حدود الأحياء غير متاحة في ${cityAr}، لذلك لا يمكن مقارنة الأسعار على مستوى الحي.`
            : 'لا تتوفر بيانات تسعير مرجعية لهذه المدينة حالياً.'}
        </p>}
        <Question title="الصفقة">{DEALS.map(([id, label]) => <Chip key={id} active={deal === id} onClick={() => setDeal(id)}>{label}</Chip>)}</Question>
        <Question title="نوع العقار">
          {KINDS.map((id) => <Chip key={id} active={kind === id} onClick={() => setKind(id)}><Icon3D type={id} className="size-6" />{typeLabel(id)}</Chip>)}
        </Question>
        <label className="flex flex-col gap-1 text-base font-bold">المساحة
          <span className="flex items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-ring/60">
            <input inputMode="numeric" dir="ltr" placeholder={`مثل ${numberFormat.format(180)}`} value={area} onChange={(e) => setArea(normalizeNumericInput(e.target.value))}
              className="h-11 w-full bg-transparent text-end text-base font-semibold tabular-nums outline-none placeholder:font-normal" />
            <span className="text-sm font-normal text-muted-foreground">م²</span>
          </span>
        </label>
        <Question title="عمر العقار">{AGES.map(([id, label]) => <Chip key={id} active={age === id} onClick={() => setAge(age === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="الشوارع" hint="عدد الشوارع أهم من جهة الواجهة">{STREETS.map(([id, label]) => <Chip key={id} active={streets === id} onClick={() => setStreets(streets === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="عرض الشارع">{WIDTHS.map(([id, label]) => <Chip key={id} active={width === id} onClick={() => setWidth(width === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="التأثيث">{[['no', 'غير مفروش'], ['yes', 'مفروش']].map(([id, label]) => <Chip key={id} active={furnished === id} onClick={() => setFurnished(id)}>{label}</Chip>)}</Question>
        <p className="text-xs leading-5 text-muted-foreground">تعديلات العمر والشوارع والتأثيث لا تُطبّق إلا في الأحياء والصفقات وأنواع العقار التي تشملها المعايرة؛ وتوضح النتيجة إن كانت تنطبق.</p>
        <Button size="lg" onClick={run} disabled={!ready || result === 'loading'} className="w-full">
          {result === 'loading' ? <Loader2 className="animate-spin" aria-hidden /> : <Calculator aria-hidden />} احسب السعر
        </Button>
        {!ready && districtStatus === 'ready' && <p className="text-center text-xs text-muted-foreground">
          {!district ? 'اختر الحي لتحسب السعر.' : parsedArea == null ? 'أدخل مساحة رقمية صالحة.' : parsedArea < 10 ? 'أقل مساحة للتسعير 10 م².' : parsedArea > 100_000 ? `أعلى مساحة للتسعير ${numberFormat.format(100_000)} م².` : 'اكتب المساحة لتحسب السعر.'}
        </p>}
      </section>

      <section ref={answer} aria-live="polite" aria-label="نطاق السعر الإرشادي" className="flex scroll-mt-20 flex-col gap-4">
        {result === null && <EmptyState icon={Calculator} title="النطاق يظهر هنا" body="نقارن عقارك بأقرب العروض الحالية في حيه وما حوله، ولا نطبّق تعديلات العوامل إلا ضمن نطاق معاير." />}
        {result === 'error' && <LoadError what="السعر" onRetry={run} />}
        {result && result !== 'loading' && result !== 'error' && !result.available && (
          <EmptyState icon={SearchX} title="غير متاح" body={REASONS[result.reason ?? ''] ?? 'تعذر حساب سعر نثق به لهذا العقار.'} />
        )}
        {result && result !== 'loading' && result !== 'error' && result.available && result.price && (
          <>
            <div className="rounded-3xl border bg-card p-5 shadow-sm">
              <p className="text-sm text-muted-foreground">{typeLabel(kind)} {numberFormat.format(areaNumber)} م² في {districtName}</p>
              <p className="mt-1 text-4xl font-bold tabular-nums">{sar(result.price.mid)}<span className="text-lg font-semibold text-muted-foreground">{PERIOD[deal]}</span></p>
              <p className="mt-1 text-base">
                النطاق الإرشادي: <span className="font-semibold tabular-nums">{numberFormat.format(result.price.low)} – {numberFormat.format(result.price.high)}</span> ريال
              </p>
              <div className="mt-3 h-2 rounded-full bg-gradient-to-l from-primary/80 via-primary/40 to-primary/10" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                <Explained title="كيف حسبناه" lines={[
                  result.comparables != null
                    ? `من ${numberFormat.format(result.comparables)} عرضاً حالياً من النوع نفسه وبمساحة قريبة (من ${numberFormat.format(70)}% إلى ${numberFormat.format(140)}% من مساحتك).`
                    : `من العروض الحالية من النوع نفسه وبمساحة قريبة (من ${numberFormat.format(70)}% إلى ${numberFormat.format(140)}% من مساحتك).`,
                  'المدى هو الربع الأدنى والأعلى من سعر المتر في هذه العروض، والوسط وسيطها، مضروبة في مساحتك.',
                  result.adjustments_calibrated
                    ? 'تعديلات العمر والشوارع وعرض الشارع والتأثيث مطبقة ضمن نطاق المعايرة الموثق لهذا الحي والصفقة ونوع العقار.'
                    : 'لم نطبّق تعديلات العمر والشوارع وعرض الشارع والتأثيث؛ معايرتها لا تغطي هذا الحي أو الصفقة أو نوع العقار. يعتمد النطاق على العروض المشابهة فقط.',
                  'النطاق من أسعار الطلب في الإعلانات المقارنة، وليس من صفقات منفذة؛ لا نخصم نسبة تفاوض غير مقاسة.',
                ]} className="text-sm">
                  {result.comparables != null ? `من ${numberFormat.format(result.comparables)} عرضاً مشابهاً` : 'من العروض المشابهة'} في {result.scope?.map((s) => s.district_ar).filter(Boolean).join('، ')}
                </Explained>
              </p>
            </div>

            <div className="rounded-3xl border bg-card p-5">
              <h2 className="text-base font-bold">لماذا هذا السعر</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                <li className="flex justify-between gap-2"><span>وسيط سعر المتر في العروض المشابهة</span><span className="font-semibold tabular-nums">{sar(result.comparables_per_sqm!.mid)}</span></li>
                {result.adjustments?.length ? result.adjustments.map((a) => (
                  <li key={a.factor} className="flex justify-between gap-2"><span>{a.label}</span><span dir="ltr" className={cn('font-semibold tabular-nums', a.pct > 0 ? 'text-primary' : 'text-warning')}>{a.pct > 0 ? '+' : ''}{numberFormat.format(a.pct)}%</span></li>
                )) : <li className="text-muted-foreground">{result.adjustments_calibrated ? 'لا توجد تعديلات إضافية للعوامل المختارة ضمن المعايرة.' : 'لم تُطبّق تعديلات؛ هذا النطاق غير مشمول بمعايرة العوامل.'}</li>}
                <li className="flex justify-between gap-2 border-t pt-1.5"><span className="font-semibold">سعر المتر لعقارك</span><span className="font-bold tabular-nums">{sar(result.per_sqm!.mid)}</span></li>
              </ul>
            </div>

            {result.examples && result.examples.length > 0 && (
              <div className="rounded-3xl border bg-card p-5">
                <h2 className="text-base font-bold">أقرب العروض المشابهة</h2>
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {result.examples.map((item) => (
                    <li key={item.id}>
                      <a href={item.url ?? undefined} target="_blank" rel="noopener noreferrer" className="group flex flex-col gap-1 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {item.photo ? <img src={item.photo} alt="" className="aspect-square w-full rounded-xl object-cover" /> : <span className="grid aspect-square place-items-center rounded-xl bg-muted text-xs text-muted-foreground">بلا صورة</span>}
                        <span className="text-sm font-bold tabular-nums">{numberFormat.format(item.price_sar)}</span>
                        <span className="text-xs text-muted-foreground">{numberFormat.format(item.area_sqm)} م² · {item.district_ar}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100"><ExternalLink className="size-3" aria-hidden />في عقار</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
