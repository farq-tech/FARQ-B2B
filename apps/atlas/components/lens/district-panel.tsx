'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { sumOf, type DistrictRow } from './city-data'
import type { LensId } from './lenses'

type Profile = {
  male: number | null
  female: number | null
  saudi_pct: number | null
  ages: { age_group: string; total: number }[]
  main_activities: { main_ar: string; n: number }[]
}

const show = (value: number | null | undefined, unit = '') => (value == null ? 'غير متاح' : `${numberFormat.format(Math.round(value))}${unit}`)

/** One figure; tapping it explains how it was worked out. */
function Figure({ label, value, explain }: { label: string; value: string; explain: string[] }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Explained title={label} lines={explain} className={value === 'غير متاح' ? 'mt-0.5 text-base text-muted-foreground' : 'mt-0.5 text-xl font-bold'}>
        {value}
      </Explained>
    </div>
  )
}

/** The one summary card: the city when nothing is selected, else the selected districts with every figure once. */
export function DistrictPanel({ city, cityName, lens, rows, selected, total, onClear }: {
  city: string
  cityName: string
  lens: LensId
  rows: DistrictRow[]
  selected: DistrictRow[]
  total: number | null
  onClear: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const single = selected.length === 1 ? selected[0] : null

  useEffect(() => {
    setProfile(null)
    if (!single) return
    let active = true
    postMarket<Profile>('district-profile', { city, district: single.name }).then((data) => { if (active) setProfile(data) }).catch(() => undefined)
    return () => { active = false }
  }, [city, single])

  const scope = selected.length ? selected : rows
  const people = sumOf(scope, 'population')
  const businesses = selected.length ? sumOf(scope, 'businesses') : total
  const male = profile?.male ?? null
  const female = profile?.female ?? null
  const sex = male != null && female != null && male + female > 0
    ? `${Math.round((100 * male) / (male + female))}% · ${Math.round((100 * female) / (male + female))}%`
    : 'غير متاح'
  const topAge = profile?.ages.length ? [...profile.ages].sort((a, b) => b.total - a.total)[0] : null
  const title = single ? single.name : selected.length ? `${numberFormat.format(selected.length)} أحياء` : cityName
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
        <Figure label="المنشآت" value={show(businesses)} explain={EXPLAIN.businesses(scopeKind)} />
        {lens !== 'distributors' && <Figure label="ساكن لكل منشأة" value={people != null && businesses ? show(people / businesses) : 'غير متاح'} explain={EXPLAIN.residentsPerBusiness(people, businesses)} />}
        {single && <Figure label="بحث بلا نتيجة" value={single.unmetSearches != null && single.searches != null ? `${show(single.unmetSearches)} من ${show(single.searches)}` : 'غير متاح'} explain={EXPLAIN.unmet(single.searches, single.unmetSearches)} />}
        <Figure label="مطاعم على تطبيقات التوصيل" value={show(sumOf(scope, 'restaurants'))} explain={EXPLAIN.restaurants} />
        {(lens === 'marketers' || lens === 'analysts' || selected.length > 0) && <Figure label="منشآت بواتساب" value={show(sumOf(scope, 'whatsapp'))} explain={EXPLAIN.whatsapp} />}
        {single && <Figure label="ذكور · إناث" value={sex} explain={EXPLAIN.sex} />}
        {single && <Figure label="السعوديون" value={profile?.saudi_pct == null ? 'غير متاح' : `${Math.round(profile.saudi_pct)}%`} explain={EXPLAIN.saudi} />}
        {single && lens !== 'distributors' && <Figure label="حصة الفلل من المساكن" value={single.villaShare == null ? 'غير متاح' : `${Math.round(single.villaShare)}%`} explain={EXPLAIN.villaShare} />}
        {single && lens !== 'distributors' && <Figure label="متوسط الدخل" value={show(single.income, ' ر.س')} explain={EXPLAIN.income} />}
        {single && lens !== 'marketers' && (
          <Figure label="مبانٍ جديدة وتحت الإنشاء"
            value={single.underConstruction != null && single.newBuildings != null ? show(single.underConstruction + single.newBuildings) : 'غير متاح'}
            explain={EXPLAIN.growth(single.underConstruction, single.newBuildings)} />
        )}
        {single && lens === 'marketers' && <Figure label="أكبر شريحة عمرية" value={topAge ? topAge.age_group : 'غير متاح'} explain={EXPLAIN.topAge} />}
      </div>
      {selected.length > 1 && (
        <ul className="mt-3 divide-y text-base">
          {selected.map((row) => (
            <li key={row.id} className="flex items-center justify-between py-2">
              <span className="font-medium">{row.name}</span>
              <span className="text-sm text-muted-foreground">{show(row.population)} ساكن · {show(row.businesses)} منشأة</span>
            </li>
          ))}
        </ul>
      )}
      {single && single.unmetTerms.length > 0 && (
        <div className="mt-4">
          <Explained title="يبحثون عنه ولا يجدونه" lines={EXPLAIN.unmet(single.searches, single.unmetSearches)} className="mb-1 text-sm font-semibold text-muted-foreground">يبحثون عنه ولا يجدونه</Explained>
          <ul className="space-y-1.5 text-base">
            {single.unmetTerms.map((row) => (
              <li key={row.term} className="flex justify-between"><span>{row.term}</span><span className="font-semibold">{numberFormat.format(row.unmet)} من {numberFormat.format(row.searches)}</span></li>
            ))}
          </ul>
        </div>
      )}
      {single && profile && profile.main_activities.length > 0 && (
        <div className="mt-4">
          <Explained title="أكثر الأنشطة" lines={EXPLAIN.activities} className="mb-1 text-sm font-semibold text-muted-foreground">أكثر الأنشطة</Explained>
          <ul className="space-y-1.5 text-base">
            {profile.main_activities.slice(0, 5).map((row) => (
              <li key={row.main_ar} className="flex justify-between"><span>{row.main_ar}</span><span className="font-semibold">{numberFormat.format(row.n)}</span></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
