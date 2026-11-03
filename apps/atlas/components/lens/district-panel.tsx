'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { counted, numberFormat, postMarket } from '@/lib/insights-api'
import { groupLabel } from '@/lib/real-estate'
import { RELIABLE_LISTINGS } from './lenses'
import { sumKnown, sumOf, type CityTable, type DistrictRow } from './city-data'
import type { LensId } from './lenses'
import { Icon3D } from '@/components/shared/icon-3d'
import { Skeleton } from '@/components/ui/skeleton'

type Profile = {
  male: number | null
  female: number | null
  saudi_pct: number | null
  ages: { age_group: string; total: number }[]
  main_activities: { main_id?: string; main_ar: string; n: number }[]
}

// sale first, then each rent period on its own line
const DEAL_ORDER = ['sale_', 'rent_year_', 'rent_month_']
const dealRank = (key: string) => DEAL_ORDER.findIndex((prefix) => key.startsWith(prefix))

type FigureKey = 'population' | 'businesses' | 'perBusiness' | 'unmet' | 'restaurants' | 'male' | 'female' | 'saudi' | 'menuPrice' | 'villaShare' | 'income' | 'growth' | 'topAge'
/** The figures each group decides on, first in its summary (its map metrics, then its secondary cards). */
const LEAD: Record<LensId, FigureKey[]> = {
  shops: ['perBusiness', 'unmet', 'population', 'businesses', 'saudi'],
  marketers: ['population', 'income', 'villaShare', 'male', 'female', 'topAge'],
  distributors: ['businesses', 'growth', 'population'],
  analysts: ['population', 'businesses', 'perBusiness'],
  property: ['income', 'villaShare', 'growth', 'population'],
}

const show = (value: number | null | undefined, unit = '') => (value == null ? 'غير متاح' : `${numberFormat.format(Math.round(value))}${unit}`)

/** One figure; tapping it explains how it was worked out. */
type FigureSpec = { label: string; short?: string; value: string; note?: string | null; explain: string[]; /** Still being fetched: its shape, not «غير متاح». */ pending?: boolean }
const MISSING = 'غير متاح'
/** A figure whose table did not load this time: a retry away, not missing (city-data.ts `failed`). */
const FAILED = 'تعذّر التحميل'
/** The table each of the summary's own figures arrives in; the profile's (sex, nationality, ages) are asked here. */
const FIGURE_TABLES: Partial<Record<FigureKey, CityTable[]>> = {
  population: ['population'], businesses: ['counts'], perBusiness: ['counts', 'population'], unmet: ['demand'], restaurants: ['restaurants'],
  menuPrice: ['menuPrices'], villaShare: ['housing'], income: ['income'], growth: ['growth'],
}

function Figure({ label, short, value, note, explain, pending }: FigureSpec) {
  // the value sits at the tile's foot, so a row's two figures line up even when one label runs to two lines; a long
  // label can show a short form, and its card keeps the full name
  return (
    <div className="flex flex-col justify-between gap-0.5 rounded-xl bg-muted/40 px-3 py-2.5">
      <p className="text-sm text-muted-foreground">{short ?? label}</p>
      {pending ? <Skeleton className="mt-1.5 h-6 w-16" aria-label={`جارٍ تحميل ${label}`} /> : (
        <Explained title={label} lines={explain} className={value === MISSING || value === FAILED ? 'mt-0.5 self-start text-base text-muted-foreground' : 'mt-0.5 self-start text-xl font-bold'}>
          {value}
        </Explained>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/** The one summary card: the city when nothing is selected, else the selected districts with every figure once. */
export function DistrictPanel({ city, cityName, lens, rows, selected, total, onClear, failed = [], pending = [] }: {
  city: string
  cityName: string
  lens: LensId
  rows: DistrictRow[]
  selected: DistrictRow[]
  total: number | null
  onClear: () => void
  /** The city's tables that failed to load, and those being asked again: their figures say so instead of «غير متاح». */
  failed?: readonly CityTable[]
  pending?: readonly CityTable[]
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  // the profile's figures (sex, nationality, ages) are «غير متاح» only once it has answered or failed, not while asked
  const [profileDone, setProfileDone] = useState(false)
  const single = selected.length === 1 ? selected[0] : null

  // keyed by the district's name, not its row: a fresh copy of the same row (the city's tables answering again) kept
  // blanking the profile and asking for it once more
  const singleName = single?.name ?? null
  useEffect(() => {
    setProfile(null)
    setProfileDone(false)
    if (!singleName) return
    let active = true
    postMarket<Profile>('district-profile', { city, district: singleName }).then((data) => { if (active) setProfile(data) }).catch(() => undefined)
      .finally(() => { if (active) setProfileDone(true) })
    return () => { active = false }
  }, [city, singleName])

  const scope = selected.length ? selected : rows
  // a total over several districts covers those that have the figure, and says so when that is not all of them
  const coverage = (sum: { known: number; of: number } | null) => (sum && sum.known < sum.of ? `في ${numberFormat.format(sum.known)} من ${counted(sum.of, 'district')}` : null)
  const coverageLine = (sum: { known: number; of: number } | null) => {
    const note = coverage(sum)
    return note ? [`المجموع ${note} لها هذا الرقم؛ الباقي غير متاح.`] : []
  }
  const peopleSum = single ? null : sumKnown(scope, 'population')
  const people = single ? single.population : peopleSum?.total ?? null
  const businesses = selected.length ? sumOf(scope, 'businesses') : total
  const restaurantSum = single ? null : sumKnown(scope, 'restaurants')
  const restaurants = single ? single.restaurants : restaurantSum?.total ?? null
  // the rate over several districts uses only those with both figures, so the two sides cover the same districts
  const paired = scope.filter((row) => row.population != null && row.businesses != null)
  const pairedPeople = paired.reduce((sum, row) => sum + (row.population as number), 0)
  const pairedBusinesses = paired.reduce((sum, row) => sum + (row.businesses as number), 0)
  const male = profile?.male ?? null
  const female = profile?.female ?? null
  // each share on its own tile: the two figures in one «57% · 43%» line ran left to right inside the Arabic label
  // «ذكور · إناث», so the first label sat over the second figure
  const measured = male != null && female != null && male + female > 0
  const share = (part: number | null) => (measured && part != null ? `${Math.round((100 * part) / (male! + female!))}%` : 'غير متاح')
  const topAge = profile?.ages.length ? [...profile.ages].sort((a, b) => b.total - a.total)[0] : null
  const title = single ? single.name : selected.length ? counted(selected.length, 'district') : cityName
  const scopeKind = single ? 'district' : selected.length ? 'districts' : 'city'

  // one district's rate is its golden row's (the service works it out); several districts or the city add up first
  const perBusiness = single ? single.residentsPerBusiness : paired.length && pairedBusinesses ? pairedPeople / pairedBusinesses : null
  const pairedNote = !single && paired.length && paired.length < scope.length ? coverage({ known: paired.length, of: scope.length }) : null
  const asking = Boolean(single) && !profileDone
  const figures: [FigureKey, FigureSpec | false | null][] = [
    ['population', { label: 'السكان', value: show(people), note: coverage(peopleSum), explain: [...EXPLAIN.population(scope.filter((row) => row.population != null).map((row) => row.populationSource), people), ...coverageLine(peopleSum)] }],
    ['businesses', { label: 'المنشآت', value: show(businesses), explain: EXPLAIN.businesses(scopeKind) }],
    ['perBusiness', lens !== 'distributors' && { label: 'ساكن لكل منشأة', value: show(perBusiness), note: pairedNote,
      explain: single ? EXPLAIN.residentsPerBusiness(people, businesses) : EXPLAIN.residentsPerBusiness(paired.length ? pairedPeople : null, paired.length ? pairedBusinesses : null) }],
    ['unmet', single && { label: 'بحث بلا نتيجة', value: single.unmetSearches != null && single.searches != null ? `${show(single.unmetSearches)} من ${show(single.searches)}` : MISSING, explain: EXPLAIN.unmet(single.searches, single.unmetSearches) }],
    ['restaurants', { label: 'مطاعم على تطبيقات التوصيل', short: 'مطاعم التوصيل', value: show(restaurants), note: coverage(restaurantSum), explain: [...EXPLAIN.restaurants, ...coverageLine(restaurantSum)] }],
    ['male', single && { label: 'الذكور', value: share(male), explain: EXPLAIN.sex, pending: asking }],
    ['female', single && { label: 'الإناث', value: share(female), explain: EXPLAIN.sex, pending: asking }],
    ['saudi', single && { label: 'السعوديون', value: profile?.saudi_pct == null ? MISSING : `${Math.round(profile.saudi_pct)}%`, explain: EXPLAIN.saudi, pending: asking }],
    ['menuPrice', single && { label: 'سعر الصنف المعتاد', value: show(single.menuPrice, ' ريال'), explain: EXPLAIN.menuPrice(single.menuPricePlaces) }],
    ['villaShare', single && lens !== 'distributors' && { label: 'حصة الفلل من المساكن', value: single.villaShare == null ? MISSING : `${Math.round(single.villaShare)}%`, explain: EXPLAIN.villaShare }],
    ['income', single && lens !== 'distributors' && { label: 'متوسط الدخل', value: show(single.income, ' ريال'), explain: EXPLAIN.income }],
    ['growth', single && lens !== 'marketers' && { label: 'مبانٍ جديدة وتحت الإنشاء',
      value: single.underConstruction != null && single.newBuildings != null ? show(single.underConstruction + single.newBuildings) : MISSING,
      explain: EXPLAIN.growth(single.underConstruction, single.newBuildings) }],
    ['topAge', single && lens === 'marketers' && { label: 'أكبر شريحة عمرية', value: topAge ? topAge.age_group : MISSING, explain: EXPLAIN.topAge, pending: asking }],
  ]
  // the group's own decision figures lead (docs/atlas-product-foundation.md §3); the rest keep their order after them
  const lead = LEAD[lens]
  const rank = (key: FigureKey) => { const at = lead.indexOf(key); return at < 0 ? lead.length : at }
  // a figure whose table is being asked again keeps its shape; one whose table failed says so, never «غير متاح»
  const loadState = ([key, spec]: [FigureKey, FigureSpec]): [FigureKey, FigureSpec] => {
    const from = FIGURE_TABLES[key] ?? []
    if (from.some((table) => pending.includes(table))) return [key, { ...spec, pending: true }]
    if (from.some((table) => failed.includes(table))) return [key, { ...spec, value: FAILED, note: null }]
    return [key, spec]
  }
  const ordered = figures.filter((entry): entry is [FigureKey, FigureSpec] => Boolean(entry[1])).map(loadState)
    .map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry[0]) - rank(b.entry[0]) || a.index - b.index).map(({ entry }) => entry)
  // the group's lead figures keep their tiles even when missing; any other missing figure is named once on one quiet
  // line, so a district with little data (Jeddah's central markets) reads in a glance instead of a wall of «غير متاح»
  const folded = (key: FigureKey, spec: FigureSpec) => !spec.pending && spec.value === MISSING && !lead.includes(key)
  const tiles = ordered.filter(([key, spec]) => !folded(key, spec))
  const missing = ordered.filter(([key, spec]) => folded(key, spec))
  // a property seeker reads prices before searches; everyone else the other way round
  const pricesFirst = lens === 'property'

  const unmetBlock = (
    <>
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
    </>
  )

  return (
    <section aria-label="الملخص" className="rounded-2xl border bg-card p-4">
      {/* a long name («سوق الخضار والفواكه المركزي») wraps whole instead of losing its end, and the clear button keeps
          its one line beside it instead of folding into two */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-xl font-bold text-balance break-words">{title}</h2>
        {selected.length > 0 && (
          <button onClick={onClear} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden /> إلغاء التحديد
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {tiles.map(([key, spec]) => <Figure key={key} {...spec} />)}
      </div>
      {missing.length > 0 && (
        // each name keeps its «i» as its own mark, so no comma is needed between them (a comma sat before the next icon)
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{MISSING} {single ? 'لهذا الحي' : 'هنا'}:</span>
          {missing.map(([key, spec]) => (
            <Explained key={key} title={spec.label} lines={spec.explain} className="text-sm">{spec.short ?? spec.label}</Explained>
          ))}
        </p>
      )}
      {selected.length > 1 && (
        <ul className="mt-3 divide-y text-base">
          {selected.map((row) => (
            <li key={row.id} className="flex items-center justify-between py-2">
              <span className="font-medium">{row.name}</span>
              {/* a missing figure says what is missing («السكان غير متاح»), not «غير متاح ساكن» */}
              <span className="text-sm text-muted-foreground tabular-nums">{row.population == null ? 'السكان غير متاح' : `${show(row.population)} ساكن`} · {row.businesses == null ? 'المنشآت غير متاح' : counted(row.businesses, 'business')}</span>
            </li>
          ))}
        </ul>
      )}
      {!pricesFirst && unmetBlock}
      {single && (
        <div className="mt-4">
          <Figure label="سعر متر البيع في الصفقات المسجلة" value={show(single.deals.residential?.median ?? null, ' ريال')} explain={EXPLAIN.registeredDeals(single.deals.residential?.deals)} />
        </div>
      )}
      {single && Object.keys(single.realEstate).length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-semibold text-muted-foreground">أسعار العقار المعروضة (للمتر)</p>
          <ul className="space-y-1.5 text-base">
            {/* studio prices rank districts poorly against official rents, so they stay out of the district comparison */}
            {Object.entries(single.realEstate).filter(([group]) => !group.endsWith('_studio') && !group.startsWith('rent_unstated_')).sort(([a], [b]) => dealRank(a) - dealRank(b) || a.localeCompare(b)).map(([group, figure]) => (
              <li key={group} className="flex flex-col gap-0.5">
                <span className="flex justify-between gap-2">
                  <span>{groupLabel(group)}</span>
                  <Explained title={groupLabel(group)} lines={EXPLAIN.realEstate(figure!.listings, group)} className="shrink-0 font-semibold">
                    {show(figure!.median, ' ريال')}{figure!.listings < RELIABLE_LISTINGS && <span className="ms-1 text-sm font-normal text-warning">عينة صغيرة</span>}
                  </Explained>
                </span>
                {/* the same figure split by the building's age, where enough ads state it */}
                {figure!.byAge && (
                  <Explained title={`${groupLabel(group)} حسب عمر العقار`} lines={EXPLAIN.realEstateByAge(figure!.byAge.new?.listings, figure!.byAge.older?.listings)} className="self-end text-sm text-muted-foreground">
                    جديد (سنتان أو أقل): {figure!.byAge.new ? show(figure!.byAge.new.median, ' ريال') : 'غير متاح'} · أقدم: {figure!.byAge.older ? show(figure!.byAge.older.median, ' ريال') : 'غير متاح'}
                  </Explained>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pricesFirst && unmetBlock}
      {single && profile && profile.main_activities.length > 0 && (
        <div className="mt-4">
          <Explained title="أكثر الأنشطة" lines={EXPLAIN.activities} className="mb-1 text-sm font-semibold text-muted-foreground">أكثر الأنشطة</Explained>
          <ul className="space-y-1.5 text-base">
            {/* each count says what it counts, with a bar against the largest of the five so the mix reads at a glance */}
            {profile.main_activities.slice(0, 5).map((row, _, top) => (
              <li key={row.main_ar} className="flex items-center gap-2">
                {row.main_id && <Icon3D type={`main-${row.main_id}`} className="size-7 shrink-0" />}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{row.main_ar}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{counted(row.n, 'business')}</span>
                  </span>
                  <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(100 * row.n) / Math.max(1, ...top.map((item) => item.n))}%` }} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
