'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, percent, postMarket } from '@/lib/insights-api'
import { groupLabel } from '@/lib/real-estate'
import { RELIABLE_LISTINGS } from './lenses'
import { sumOf, type DistrictRow, type DistrictScopeSummary } from './city-data'
import type { LensId } from './lenses'
import { Icon3D } from '@/components/shared/icon-3d'
import { showDistrictSummaryMetric } from '@/lib/district-summary'
import type { AudienceMode } from '@/lib/audience'

type Profile = {
  male: number | null
  female: number | null
  saudi_pct: number | null
  ages: { age_group: string; total: number | null }[]
  main_activities: { main_id?: string; main_ar: string; n: number }[]
}

// sale first, then each rent period on its own line
const DEAL_ORDER = ['sale_', 'rent_year_', 'rent_month_']
const dealRank = (key: string) => DEAL_ORDER.findIndex((prefix) => key.startsWith(prefix))

const show = (value: number | null | undefined, unit = '') => (value == null ? 'غير متاح' : `${numberFormat.format(Math.round(value))}${unit}`)

/** One figure; tapping it explains how it was worked out. */
function Figure({ label, value, explain, action }: { label: string; value: string; explain: string[]; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Explained title={label} lines={explain} className={value === 'غير متاح' ? 'mt-0.5 text-base text-muted-foreground' : 'mt-0.5 text-xl font-bold'}>
        {value}
      </Explained>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/** The one summary card: the city when nothing is selected, else the selected districts with every figure once. */
export function DistrictPanel({ city, cityName, lens, audienceMode, rows, selected, total, districtSummary, districtSummaryStatus, onRetryCounts, onClear }: {
  city: string
  cityName: string
  lens: LensId
  audienceMode: AudienceMode
  rows: DistrictRow[]
  selected: DistrictRow[]
  total: number | null
  districtSummary: DistrictScopeSummary | null
  districtSummaryStatus: 'loading' | 'ready' | 'error'
  onRetryCounts?: () => void
  onClear: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [multiSummary, setMultiSummary] = useState<DistrictScopeSummary | null>(null)
  const [multiSummaryStatus, setMultiSummaryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [multiSummaryAttempt, setMultiSummaryAttempt] = useState(0)
  const single = selected.length === 1 ? selected[0] : null
  const selectedIdsKey = selected.map((row) => row.id).join('|')

  useEffect(() => {
    setProfile(null)
    if (!single?.id || !single.name) return
    let active = true
    const controller = new AbortController()
    postMarket<Profile>('district-profile', { city, district: single.name }, controller.signal)
      .then((data) => { if (active) setProfile(data) })
      .catch(() => undefined)
    return () => { active = false; controller.abort() }
  }, [city, single?.id, single?.name])

  useEffect(() => {
    if (selected.length < 2) {
      setMultiSummary(null)
      setMultiSummaryStatus('idle')
      return
    }
    let active = true
    setMultiSummary(null)
    setMultiSummaryStatus('loading')
    postMarket<{ scope_summary?: DistrictScopeSummary }>('district-counts', { city, district_ids: selectedIdsKey.split('|') })
      .then((data) => {
        if (!data.scope_summary) throw new Error('Missing district summary')
        if (active) { setMultiSummary(data.scope_summary); setMultiSummaryStatus('ready') }
      })
      .catch(() => { if (active) setMultiSummaryStatus('error') })
    return () => { active = false }
  }, [city, selectedIdsKey, selected.length, multiSummaryAttempt])

  const scope = selected.length ? selected : rows
  const people = sumOf(scope, 'population')
  const businesses = selected.length ? sumOf(scope, 'businesses') : total
  const ratioScope = single
    ? { population: single.population, businesses: single.businesses, residents_per: single.residentsPerBusiness }
    : selected.length ? multiSummary : districtSummary
  const ratio = ratioScope?.residents_per ?? null
  const ratioError = selected.length > 1 ? multiSummaryStatus === 'error' : districtSummaryStatus === 'error'
  const ratioLoading = selected.length > 1 ? multiSummaryStatus === 'loading' : districtSummaryStatus === 'loading'
  const ratioValue = ratioLoading ? 'جارٍ الحساب' : ratioError ? 'تعذر الحساب' : ratio == null ? 'غير متاح' : show(ratio)
  const ratioExplanation = ratioError
    ? ['تعذر تحميل ملخص السكان والمنشآت من الخدمة. أعد المحاولة.']
    : ratioLoading
    ? ['جارٍ تحميل ملخص السكان والمنشآت لهذا النطاق.']
    : ratio == null
    ? ['السكان المقاسون ÷ منشآت الدليل ذات الحي المعروف في النطاق.', 'غير متاح لأن السكان أو عدد المنشآت لا يغطيان الأحياء المحددة بالكامل، أو لا توجد منشآت مقاسة.']
    : [
        'السكان المقاسون ÷ منشآت الدليل ذات الحي المعروف في النطاق.',
        `${numberFormat.format(Math.round(ratioScope!.population!))} ÷ ${numberFormat.format(ratioScope!.businesses!)} = ${numberFormat.format(Math.round(ratio))}`,
        'كلما ارتفع الرقم قلّت المنشآت التي تخدم السكان.',
      ]
  const male = profile?.male ?? null
  const female = profile?.female ?? null
  const sex = male != null && female != null && male + female > 0
    ? `${percent(Math.round((100 * male) / (male + female)))} · ${percent(Math.round((100 * female) / (male + female)))}`
    : 'غير متاح'
  const knownAges = profile?.ages.filter((age): age is { age_group: string; total: number } => age.total != null) ?? []
  const topAge = knownAges.length ? [...knownAges].sort((a, b) => b.total - a.total)[0] : null
  const title = single ? single.name : selected.length ? counted(selected.length, 'district') : cityName
  const scopeKind = single ? 'district' : selected.length ? 'districts' : 'city'

  return (
    <section aria-label="الملخص" className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-xl font-bold">{title}</h2>
        {selected.length > 0 && (
          <button onClick={onClear} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden /> إلغاء التحديد
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Figure label="السكان" value={show(people)} explain={EXPLAIN.population(scope.map((row) => row.populationSource), people)} />
        {showDistrictSummaryMetric('businesses', lens, audienceMode) && <Figure label="المنشآت" value={show(businesses)} explain={EXPLAIN.businesses(scopeKind)} />}
        {showDistrictSummaryMetric('residentsPerBusiness', lens, audienceMode) && lens !== 'distributors' && <Figure label="ساكن لكل منشأة" value={ratioValue} explain={ratioExplanation}
          action={ratioError ? <button onClick={() => selected.length > 1 ? setMultiSummaryAttempt((attempt) => attempt + 1) : onRetryCounts?.()} className="text-sm font-semibold text-primary underline">إعادة المحاولة</button> : undefined} />}
        {showDistrictSummaryMetric('unmetSearch', lens, audienceMode) && single && <Figure label="بحث بلا نتيجة" value={single.unmetSearches != null && single.searches != null ? `${show(single.unmetSearches)} من ${show(single.searches)}` : 'غير متاح'} explain={EXPLAIN.unmet(single.searches, single.unmetSearches)} />}
        {showDistrictSummaryMetric('restaurants', lens, audienceMode) && <Figure label="مطاعم على تطبيقات التوصيل" value={show(sumOf(scope, 'restaurants'))} explain={EXPLAIN.restaurants} />}
        {showDistrictSummaryMetric('sex', lens, audienceMode) && single && <Figure label="ذكور · إناث" value={sex} explain={EXPLAIN.sex} />}
        {showDistrictSummaryMetric('nationality', lens, audienceMode) && single && <Figure label="السعوديون" value={profile?.saudi_pct == null ? 'غير متاح' : percent(Math.round(profile.saudi_pct))} explain={EXPLAIN.saudi} />}
        {showDistrictSummaryMetric('menuPrice', lens, audienceMode) && single && <Figure label="سعر الصنف المعتاد" value={show(single.menuPrice, ' ر.س')} explain={EXPLAIN.menuPrice(single.menuPricePlaces)} />}
        {showDistrictSummaryMetric('villaShare', lens, audienceMode) && single && lens !== 'distributors' && <Figure label="حصة الفلل من المساكن" value={single.villaShare == null ? 'غير متاح' : percent(Math.round(single.villaShare))} explain={EXPLAIN.villaShare} />}
        {single && lens !== 'distributors' && <Figure label="متوسط الدخل" value={show(single.income, ' ر.س')} explain={EXPLAIN.income} />}
        {showDistrictSummaryMetric('growth', lens, audienceMode) && single && lens !== 'marketers' && (
          <Figure label="مبانٍ جديدة وتحت الإنشاء"
            value={single.underConstruction != null && single.newBuildings != null ? show(single.underConstruction + single.newBuildings) : 'غير متاح'}
            explain={EXPLAIN.growth(single.underConstruction, single.newBuildings)} />
        )}
        {showDistrictSummaryMetric('age', lens, audienceMode) && single && lens === 'marketers' && <Figure label="أكبر شريحة عمرية" value={topAge ? topAge.age_group : 'غير متاح'} explain={EXPLAIN.topAge} />}
      </div>
      {selected.length > 1 && (
        <ul className="mt-3 divide-y text-base">
          {selected.map((row) => (
            <li key={row.id} className="flex items-center justify-between py-2">
              <span className="font-medium">{row.name}</span>
              <span className="text-sm text-muted-foreground">{show(row.population)} ساكن{showDistrictSummaryMetric('businesses', lens, audienceMode) && ` · ${show(row.businesses)} منشأة`}</span>
            </li>
          ))}
        </ul>
      )}
      {showDistrictSummaryMetric('unmetTerms', lens, audienceMode) && single && single.unmetTerms.length > 0 && (
        <div className="mt-4">
          <Explained title="يبحثون عنه ولا يجدونه" lines={EXPLAIN.unmet(single.searches, single.unmetSearches)} className="mb-1 text-sm font-semibold text-muted-foreground">يبحثون عنه ولا يجدونه</Explained>
          <ul className="space-y-1.5 text-base">
            {single.unmetTerms.map((row) => (
              <li key={row.term} className="flex justify-between"><span>{row.term}</span><span className="font-semibold">{numberFormat.format(row.unmet)} من {numberFormat.format(row.searches)}</span></li>
            ))}
          </ul>
        </div>
      )}
      {showDistrictSummaryMetric('registeredDeals', lens, audienceMode) && single && (
        <div className="mt-4">
          <Figure label="سعر متر البيع في الصفقات المسجلة" value={show(single.deals.residential?.median ?? null, ' ر.س')} explain={EXPLAIN.registeredDeals(single.deals.residential?.deals)} />
        </div>
      )}
      {showDistrictSummaryMetric('listingPrices', lens, audienceMode) && single && Object.keys(single.realEstate).length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-semibold text-muted-foreground">أسعار العقار المعروضة (للمتر)</p>
          <ul className="space-y-1.5 text-base">
            {/* studio prices rank districts poorly against official rents, so they stay out of the district comparison */}
            {Object.entries(single.realEstate).filter(([group]) => !group.endsWith('_studio') && !group.startsWith('rent_unstated_')).sort(([a], [b]) => dealRank(a) - dealRank(b) || a.localeCompare(b)).map(([group, figure]) => (
              <li key={group} className="flex flex-col gap-0.5">
                <span className="flex justify-between gap-2">
                  <span>{groupLabel(group)}</span>
                  <Explained title={groupLabel(group)} lines={EXPLAIN.realEstate(figure!.listings, group)} className="shrink-0 font-semibold">
                    {show(figure!.median, ' ر.س')}{figure!.listings < RELIABLE_LISTINGS && <span className="ms-1 text-sm font-normal text-warning">عينة صغيرة</span>}
                  </Explained>
                </span>
                {/* the same figure split by the building's age, where enough ads state it */}
                {figure!.byAge && (
                  <Explained title={`${groupLabel(group)} حسب عمر العقار`} lines={EXPLAIN.realEstateByAge(figure!.byAge.new?.listings, figure!.byAge.older?.listings)} className="self-end text-sm text-muted-foreground">
                    جديد (سنتان أو أقل): {figure!.byAge.new ? show(figure!.byAge.new.median, ' ر.س') : 'غير متاح'} · أقدم: {figure!.byAge.older ? show(figure!.byAge.older.median, ' ر.س') : 'غير متاح'}
                  </Explained>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showDistrictSummaryMetric('activities', lens, audienceMode) && single && profile && profile.main_activities.length > 0 && (
        <div className="mt-4">
          <Explained title="أكثر الأنشطة" lines={EXPLAIN.activities} className="mb-1 text-sm font-semibold text-muted-foreground">أكثر الأنشطة</Explained>
          <ul className="space-y-1.5 text-base">
            {profile.main_activities.slice(0, 5).map((row) => (
              <li key={row.main_ar} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2">{row.main_id && <Icon3D type={`main-${row.main_id}`} className="size-7" />}{row.main_ar}</span><span className="font-semibold">{numberFormat.format(row.n)}</span></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
