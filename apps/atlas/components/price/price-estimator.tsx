'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Calculator, ExternalLink, Loader2, SearchX } from 'lucide-react'
import { Icon3D } from '@/components/shared/icon-3d'
import { EmptyState } from '@/components/shared/empty-state'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { typeLabel } from '@/lib/real-estate'
import { cn } from '@/lib/utils'

const CITIES = [['Riyadh', 'الرياض'], ['Jeddah', 'جدة'], ['Dammam', 'الدمام'], ['Al Khobar', 'الخبر'], ['Makkah Al Mukarramah', 'مكة المكرمة']] as const
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

const sar = (value: number) => `${numberFormat.format(value)} ريال`

/**
 * «سعّر عقارك»: a few questions about a property, then its likely price from the current listings most like it (same
 * deal and type, close in size, in its district and, when that has too few, the nearest districts), moved by the
 * stable rules from the north-Riyadh model (age, streets, street width, furnishing). It shows the range, every
 * adjustment with its percentage, and the comparables themselves, so the number can be checked.
 */
export function PriceEstimator() {
  const [city, setCity] = useState('Riyadh')
  const [districts, setDistricts] = useState<{ id: string; name: string }[] | null>(null)
  const [district, setDistrict] = useState('')
  const [deal, setDeal] = useState('rent_year')
  const [kind, setKind] = useState<string>('floor')
  const [area, setArea] = useState('')
  const [age, setAge] = useState<string | null>(null)
  const [streets, setStreets] = useState<string | null>(null)
  const [width, setWidth] = useState<string | null>(null)
  const [furnished, setFurnished] = useState<string | null>('no')
  const [result, setResult] = useState<Estimate | 'loading' | 'error' | null>(null)
  const answer = useRef<HTMLElement>(null)
  // on a phone the answer sits under the questions: bring it into view once it arrives
  useEffect(() => { if (result && result !== 'loading') answer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [result])

  useEffect(() => {
    let live = true
    setDistricts(null); setDistrict('')
    postMarket<{ districts?: { district_id: string; district_ar: string }[] }>('real-estate', { city })
      .then((data) => { if (live) setDistricts((data.districts ?? []).map((row) => ({ id: row.district_id, name: row.district_ar })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))) })
      .catch(() => { if (live) setDistricts([]) })
    return () => { live = false }
  }, [city])

  const areaNumber = Number(area.replace(/[^0-9]/g, ''))
  const ready = district && areaNumber >= 10
  const run = () => {
    if (!ready) return
    setResult('loading')
    postMarket<Estimate>('price-estimate', {
      city, district_id: district, deal, type: kind, area_sqm: areaNumber,
      ...(age ? { age } : {}), ...(streets ? { streets } : {}), ...(width ? { street_width: width } : {}), ...(furnished ? { furnished } : {}),
    }).then(setResult).catch(() => setResult('error'))
  }
  const districtName = districts?.find((item) => item.id === district)?.name

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:py-10">
      <section className="flex flex-col gap-5 rounded-3xl border bg-card p-5 shadow-sm" aria-label="أسئلة التسعير">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Calculator className="size-6 text-primary" aria-hidden />سعّر عقارك</h1>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">أجب عن الأسئلة، ونعطيك السعر المتوقع من أقرب العروض الحالية المشابهة لعقارك، مع سبب كل فرق.</p>
        </header>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">المدينة
            <select value={city} onChange={(e) => setCity(e.target.value)} className="h-11 rounded-xl border bg-background px-3 text-base font-normal">
              {CITIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">الحي
            <select value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!districts?.length} className="h-11 rounded-xl border bg-background px-3 text-base font-normal disabled:opacity-60">
              <option value="">{districts === null ? 'جارٍ التحميل…' : districts.length ? 'اختر الحي' : 'غير متاح'}</option>
              {districts?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
        <Question title="الصفقة">{DEALS.map(([id, label]) => <Chip key={id} active={deal === id} onClick={() => setDeal(id)}>{label}</Chip>)}</Question>
        <Question title="نوع العقار">
          {KINDS.map((id) => <Chip key={id} active={kind === id} onClick={() => setKind(id)}><Icon3D type={id} className="size-6" />{typeLabel(id)}</Chip>)}
        </Question>
        <label className="flex flex-col gap-1 text-base font-bold">المساحة
          <span className="flex items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-ring/60">
            <input inputMode="numeric" dir="ltr" placeholder="مثل 180" value={area} onChange={(e) => setArea(e.target.value.replace(/[^0-9]/g, ''))}
              className="h-11 w-full bg-transparent text-end text-base font-semibold tabular-nums outline-none placeholder:font-normal" />
            <span className="text-sm font-normal text-muted-foreground">م²</span>
          </span>
        </label>
        <Question title="عمر العقار">{AGES.map(([id, label]) => <Chip key={id} active={age === id} onClick={() => setAge(age === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="الشوارع" hint="عدد الشوارع أهم من جهة الواجهة">{STREETS.map(([id, label]) => <Chip key={id} active={streets === id} onClick={() => setStreets(streets === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="عرض الشارع">{WIDTHS.map(([id, label]) => <Chip key={id} active={width === id} onClick={() => setWidth(width === id ? null : id)}>{label}</Chip>)}</Question>
        <Question title="التأثيث">{[['no', 'غير مفروش'], ['yes', 'مفروش']].map(([id, label]) => <Chip key={id} active={furnished === id} onClick={() => setFurnished(id)}>{label}</Chip>)}</Question>
        <Button size="lg" onClick={run} disabled={!ready || result === 'loading'} className="w-full">
          {result === 'loading' ? <Loader2 className="animate-spin" aria-hidden /> : <Calculator aria-hidden />} احسب السعر
        </Button>
        {!ready && <p className="text-center text-xs text-muted-foreground">اختر الحي واكتب المساحة لتحسب السعر.</p>}
      </section>

      <section ref={answer} aria-live="polite" aria-label="السعر المتوقع" className="flex scroll-mt-20 flex-col gap-4">
        {result === null && <EmptyState icon={Calculator} title="السعر يظهر هنا" body="نقارن عقارك بأقرب العروض الحالية في حيه وما حوله، ونعدّل للفروق التي ثبت أثرها في البيانات." />}
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
                المدى المتوقع: <span className="font-semibold tabular-nums">{numberFormat.format(result.price.low)} – {numberFormat.format(result.price.high)}</span> ريال
              </p>
              <div className="mt-3 h-2 rounded-full bg-gradient-to-l from-primary/80 via-primary/40 to-primary/10" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                <Explained title="كيف حسبناه" lines={[
                  `من ${numberFormat.format(result.comparables ?? 0)} عرضاً حالياً من النوع نفسه وبمساحة قريبة (من 70% إلى 140% من مساحتك).`,
                  'المدى هو الربع الأدنى والأعلى من سعر المتر في هذه العروض، والوسط وسيطها، مضروبة في مساحتك.',
                  'ثم نعدّل للفروق التي ثبت أثرها في نموذج عروض شمال الرياض: العمر، وعدد الشوارع، وعرض الشارع، والتأثيث. حقول مثل المكيفات والحوش وغرفة العاملة لا تدخل لأن عقار لا يعبئها بانتظام.',
                  'أسعار معروضة لا عقود، والعقود عادة أقل بنحو 5–10%.',
                ]} className="text-sm">
                  من {numberFormat.format(result.comparables ?? 0)} عرضاً مشابهاً في {result.scope?.map((s) => s.district_ar).filter(Boolean).join('، ')}
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
