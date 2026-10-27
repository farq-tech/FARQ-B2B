'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={value === 'غير متاح' ? 'mt-0.5 text-sm text-muted-foreground' : 'mt-0.5 text-base font-bold'}>{value}</p>
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
  const sexKnown = profile?.male != null && profile?.female != null
  const topAge = profile?.ages.length ? [...profile.ages].sort((a, b) => b.total - a.total)[0] : null
  const income = single ? single.income : null
  const growth = single && single.underConstruction != null && single.newBuildings != null ? single.underConstruction + single.newBuildings : null
  const title = single ? single.name : selected.length ? `${numberFormat.format(selected.length)} أحياء` : cityName

  return (
    <section aria-label="الملخص" className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-lg font-bold">{title}</h2>
        {selected.length > 0 && (
          <button onClick={onClear} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="size-3.5" aria-hidden /> إلغاء التحديد
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Figure label="السكان" value={show(people)} />
        <Figure label="المنشآت" value={show(businesses)} />
        {lens !== 'distributors' && <Figure label="ساكن لكل منشأة" value={people != null && businesses ? show(people / businesses) : 'غير متاح'} />}
        {(lens === 'marketers' || lens === 'analysts' || selected.length > 0) && <Figure label="منشآت بواتساب" value={show(sumOf(scope, 'whatsapp'))} />}
        {single && <Figure label="ذكور · إناث" value={sexKnown ? `${Math.round((100 * profile!.male!) / (profile!.male! + profile!.female!))}٪ · ${Math.round((100 * profile!.female!) / (profile!.male! + profile!.female!))}٪` : 'غير متاح'} />}
        {single && <Figure label="السعوديون" value={profile?.saudi_pct == null ? 'غير متاح' : `${Math.round(profile.saudi_pct)}٪`} />}
        {single && lens !== 'distributors' && <Figure label="متوسط الدخل" value={show(income, ' ر.س')} />}
        {single && lens !== 'marketers' && <Figure label="مبانٍ جديدة وتحت الإنشاء" value={show(growth)} />}
        {single && lens === 'marketers' && <Figure label="أكبر شريحة عمرية" value={topAge ? topAge.age_group : 'غير متاح'} />}
      </div>
      {selected.length > 1 && (
        <ul className="mt-3 divide-y text-sm">
          {selected.map((row) => (
            <li key={row.id} className="flex items-center justify-between py-1.5">
              <span className="font-medium">{row.name}</span>
              <span className="text-xs text-muted-foreground">{show(row.population)} ساكن · {show(row.businesses)} منشأة</span>
            </li>
          ))}
        </ul>
      )}
      {single && profile && profile.main_activities.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">أكثر الأنشطة</p>
          <ul className="space-y-1 text-sm">
            {profile.main_activities.slice(0, 5).map((row) => (
              <li key={row.main_ar} className="flex justify-between"><span>{row.main_ar}</span><span className="font-semibold">{numberFormat.format(row.n)}</span></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
