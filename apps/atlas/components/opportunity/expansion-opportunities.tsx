'use client'

import { useEffect, useState } from 'react'
import { MapPinned, Users } from 'lucide-react'
import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import { normalizeDistrictName } from '@/lib/live-district'
import { loadDistrictDemographics, loadDistrictPopulation, loadLiveActivityCatalog, loadMarketActivityCounts, type DistrictCount, type DistrictDemographic, type DistrictPopulation, type LiveActivityMain, type MarketActivityCount } from '@/lib/live-market'

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('en-US')
}

export function ExpansionOpportunities({
  cityId,
  query,
  activity,
  selectedDistrictName,
  counts,
  countsAvailable,
  districts,
  onFocusDistrict,
  onSelectActivity,
}: {
  cityId: string
  query: string
  activity: LiveActivityMain | null
  selectedDistrictName: string | null
  counts: DistrictCount[]
  countsAvailable: boolean
  districts: FeatureCollection<Geometry, GeoJsonProperties> | null | undefined
  onFocusDistrict: (district: string) => void
  onSelectActivity: (activity: LiveActivityMain, label: string) => void
}) {
  const [populationRows, setPopulationRows] = useState<DistrictPopulation[]>([])
  const [demographicRows, setDemographicRows] = useState<DistrictDemographic[]>([])
  const [cityActivityCatalog, setCityActivityCatalog] = useState<LiveActivityMain[] | null>(null)
  const [cityActivityCatalogStatus, setCityActivityCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cityActivityCounts, setCityActivityCounts] = useState<MarketActivityCount[] | null>(null)
  const [cityActivityCountsStatus, setCityActivityCountsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [districtActivityCounts, setDistrictActivityCounts] = useState<MarketActivityCount[] | null>(null)
  const [districtActivityStatus, setDistrictActivityStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  useEffect(() => {
    const controller = new AbortController()
    setPopulationRows([])
    setDemographicRows([])
    loadDistrictPopulation(cityId).then((rows) => { if (!controller.signal.aborted) setPopulationRows(rows) }).catch(() => {
      if (!controller.signal.aborted) setPopulationRows([])
    })
    loadDistrictDemographics(cityId).then((rows) => { if (!controller.signal.aborted) setDemographicRows(rows) }).catch(() => {
      if (!controller.signal.aborted) setDemographicRows([])
    })
    return () => controller.abort()
  }, [cityId])
  useEffect(() => {
    let active = true
    setCityActivityCatalog(null)
    setCityActivityCatalogStatus('loading')
    loadLiveActivityCatalog(cityId)
      .then((rows) => { if (active) { setCityActivityCatalog(rows); setCityActivityCatalogStatus('ready') } })
      .catch(() => { if (active) { setCityActivityCatalog([]); setCityActivityCatalogStatus('error') } })
    return () => { active = false }
  }, [cityId])
  useEffect(() => {
    let active = true
    setCityActivityCounts(null)
    setCityActivityCountsStatus('loading')
    loadMarketActivityCounts(cityId)
      .then((rows) => { if (active) { setCityActivityCounts(rows); setCityActivityCountsStatus('ready') } })
      .catch(() => { if (active) { setCityActivityCounts([]); setCityActivityCountsStatus('error') } })
    return () => { active = false }
  }, [cityId])
  useEffect(() => {
    let active = true
    if (!selectedDistrictName) {
      setDistrictActivityCounts(null)
      setDistrictActivityStatus('idle')
      return () => { active = false }
    }
    setDistrictActivityCounts(null)
    setDistrictActivityStatus('loading')
    loadMarketActivityCounts(cityId, [selectedDistrictName])
      .then((rows) => { if (active) { setDistrictActivityCounts(rows); setDistrictActivityStatus('ready') } })
      .catch(() => { if (active) { setDistrictActivityCounts([]); setDistrictActivityStatus('error') } })
    return () => { active = false }
  }, [cityId, selectedDistrictName])
  const activityName = activity
    ? activity.subs.length === 1 ? activity.subs[0].sub_ar : activity.main_ar
    : query.trim()

  if (!populationRows.length || !districts?.features.length || !countsAvailable) return null

  const populationById = new Map(populationRows.filter((row) => row.coverage_pct >= 50).map((row) => [String(row.district_id), row]))
  const demographicsById = new Map<string, DistrictDemographic[]>()
  for (const row of demographicRows.filter((item) => (item.coverage_pct ?? 0) >= 50)) {
    const key = String(row.district_id)
    demographicsById.set(key, [...(demographicsById.get(key) ?? []), row])
  }
  const countByName = new Map<string, number>()
  for (const count of counts) {
    const key = normalizeDistrictName(count.district_ar)
    countByName.set(key, (countByName.get(key) ?? 0) + count.n)
  }

  const areaParts = districts.features.flatMap((feature) => {
    const properties = feature.properties ?? {}
    const districtName = [properties.ar, properties.name_ar, properties.district_ar, properties.name]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    if (!districtName) return []
    const districtId = properties.id
    if (districtId == null) return []
    const populationRow = populationById.get(String(districtId))
    if (!populationRow) return []
    return [{ districtName: districtName.trim(), population: populationRow.population, validCells: populationRow.valid_cells, polygonCells: populationRow.polygon_cells, demographics: demographicsById.get(String(districtId)) ?? [] }]
  })
  // Some official city boundaries split one named district into multiple
  // polygons. Join each polygon by ID first, then sum exact same-label pieces.
  const groupedAreas = new Map<string, { districtName: string; population: number; validCells: number; polygonCells: number; demographics: DistrictDemographic[] }>()
  for (const part of areaParts) {
    const current = groupedAreas.get(part.districtName)
    if (current) {
      current.population += part.population
      current.validCells += part.validCells
      current.polygonCells += part.polygonCells
      current.demographics.push(...part.demographics)
    } else groupedAreas.set(part.districtName, { ...part })
  }
  const areas = [...groupedAreas.values()].map((area) => {
    const competitorCount = countByName.get(normalizeDistrictName(area.districtName)) ?? 0
    const coverage = area.polygonCells > 0 ? (100 * area.validCells) / area.polygonCells : 0
    const demographics = new Map<string, { male: number; female: number; total: number }>()
    for (const row of area.demographics) {
      if (row.age_code === 'ALL') continue
      const current = demographics.get(row.age_code) ?? { male: 0, female: 0, total: 0 }
      demographics.set(row.age_code, {
        male: current.male + (row.male ?? 0),
        female: current.female + (row.female ?? 0),
        total: current.total + (row.total ?? 0),
      })
    }
    const sumCodes = (codes: string[]) => [...demographics.entries()].filter(([code]) => codes.includes(code)).reduce((sum, [, value]) => sum + value.total, 0)
    const children = sumCodes(['00', '01', '05', '10'])
    const seniors = sumCodes(['65', '70', '75', '80', '85', '90'])
    const workingAge = sumCodes(['15', '20', '25', '30', '35', '40', '45', '50', '55', '60'])
    const sexTotals = [...demographics.values()].reduce((sum, value) => ({ male: sum.male + value.male, female: sum.female + value.female }), { male: 0, female: 0 })
    return { ...area, coverage, competitorCount, residentsPerBusiness: competitorCount > 0 ? area.population / competitorCount : null, children, workingAge, seniors, male: sexTotals.male, female: sexTotals.female }
  })
  const selectedArea = selectedDistrictName
    ? areas.find((area) => normalizeDistrictName(area.districtName) === normalizeDistrictName(selectedDistrictName)) ?? null
    : null
  const candidates = selectedDistrictName
    ? selectedArea && (!activityName || selectedArea.competitorCount > 0) ? [selectedArea] : []
    : areas.filter((area) => !activityName || area.competitorCount > 0)
      .sort((a, b) => activityName
        ? (b.residentsPerBusiness ?? 0) - (a.residentsPerBusiness ?? 0) || b.population - a.population
        : b.population - a.population)
      .slice(0, 6)
  const noMatches = selectedDistrictName ? [] : activityName ? areas.filter((area) => area.competitorCount === 0).sort((a, b) => b.population - a.population).slice(0, 3) : []
  const totalMappedPopulation = areas.reduce((sum, area) => sum + area.population, 0)
  const populationShare = selectedArea && totalMappedPopulation > 0 ? selectedArea.population / totalMappedPopulation : 0
  const cityActivitiesById = new Map((cityActivityCatalog ?? []).map((item) => [item.main_id, item]))
  const localActivityCountsById = new Map((districtActivityCounts ?? []).map((item) => [item.main_id, item]))
  const underrepresentedActivities = (cityActivityCounts ?? [])
    .filter((item) => item.n >= 300 && cityActivitiesById.has(item.main_id))
    .map((item) => {
      const localCount = localActivityCountsById.get(item.main_id)?.n ?? 0
      const expectedCount = item.n * populationShare
      const representation = expectedCount > 0 ? localCount / expectedCount : 0
      return { ...cityActivitiesById.get(item.main_id)!, localCount, expectedCount, representation }
    })
    .filter((item) => item.representation < 0.8)
    .sort((a, b) => a.representation - b.representation || b.shops - a.shops)
    .slice(0, 5)

  if (!selectedArea && !candidates.length && !noMatches.length) return null

  return (
    <section className="rounded-xl border border-primary/20 bg-card p-4" aria-label="مؤشرات السكان والسوق">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><MapPinned className="size-4" aria-hidden /></span>
        <div>
          <h2 className="text-sm font-semibold">{selectedArea ? `فرص حي ${selectedArea.districtName}` : activityName ? 'أحياء تستحق دراسة التوسع' : 'السكان والسوق حسب الحي'}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedArea ? 'السكان والمنشآت والأنشطة التي تستحق الفحص في الحي المحدد' : activityName ? `${activityName} · ترتيب أولي حسب السكان لكل منشأة مرصودة` : 'أعلى الأحياء تقديرًا للسكان، مع أعداد المنشآت وشرائح العمر'}</p>
        </div>
      </div>
      {selectedArea ? (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
          <h3 className="text-sm font-semibold">فرص أولية في حي {selectedArea.districtName}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {formatNumber(selectedArea.population)} ساكن · {formatNumber(selectedArea.competitorCount)} {activityName ? 'منشأة للنشاط المحدد' : 'منشأة مرصودة في الدليل'} · تقدير سكاني بتغطية {formatNumber(selectedArea.coverage)}٪
          </p>
          {selectedArea.children + selectedArea.workingAge + selectedArea.seniors > 0 ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              الأعمار المقدرة: دون 15 {formatNumber(selectedArea.children)} · 15–64 {formatNumber(selectedArea.workingAge)} · 65+ {formatNumber(selectedArea.seniors)}
            </p>
          ) : null}
          {selectedArea.male + selectedArea.female > 0 ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              التقدير حسب الجنس: ذكور {formatNumber(selectedArea.male)} · إناث {formatNumber(selectedArea.female)}
            </p>
          ) : null}
          <div className="mt-3 border-t pt-2.5">
            <p className="text-xs font-semibold">أنشطة أقل تمثيلًا من حصة الحي السكانية</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              يقارن سجلات النشاط عالية أو متوسطة الثقة بحصة الحي السكانية؛ قد يظهر السجل ضمن أكثر من نشاط. الأقل تمثيلًا مرشح للفحص، لا إثبات للطلب.
            </p>
            {cityActivityCountsStatus === 'loading' || cityActivityCatalogStatus === 'loading' || districtActivityStatus === 'loading' ? <p className="mt-2 text-xs text-muted-foreground">جارٍ تحليل الأنشطة في الحي…</p> : null}
            {cityActivityCountsStatus === 'error' || cityActivityCatalogStatus === 'error' || districtActivityStatus === 'error' ? <p className="mt-2 text-xs text-muted-foreground">تعذر تحميل أعداد الأنشطة للمقارنة الآن.</p> : null}
            {cityActivityCountsStatus === 'ready' && cityActivityCatalogStatus === 'ready' && districtActivityStatus === 'ready' && underrepresentedActivities.length ? (
              <ul className="mt-2 divide-y">
                {underrepresentedActivities.map((item) => (
                  <li key={item.main_id}>
                    <button
                      type="button"
                      onClick={() => onSelectActivity(item, item.main_ar)}
                      className="flex w-full items-center justify-between gap-3 py-2 text-right hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1 text-xs font-medium">{item.main_ar}</span>
                      <span className="shrink-0 text-left text-[11px] text-muted-foreground">
                        {formatNumber(item.localCount)} مرصودة · {formatNumber(item.expectedCount)} متوقعة نسبيًا · {Math.round(item.representation * 100)}٪
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {cityActivityCountsStatus === 'ready' && cityActivityCatalogStatus === 'ready' && districtActivityStatus === 'ready' && !underrepresentedActivities.length ? (
              <p className="mt-2 text-xs text-muted-foreground">لا توجد فئة كافية البيانات للمقارنة في هذا الحي.</p>
            ) : null}
          </div>
        </div>
      ) : null}
      <ul className="mt-3 divide-y">
        {candidates.map((candidate) => (
          <li key={candidate.districtName}>
            <button
              type="button"
              onClick={() => onFocusDistrict(candidate.districtName)}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-right hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{candidate.districtName}</span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Users className="size-3.5" aria-hidden />{formatNumber(candidate.population)} ساكن</span>
                {activityName ? <span><strong className="text-foreground tabular-nums">{formatNumber(candidate.competitorCount)}</strong> منشأة مرصودة · <strong className="text-foreground tabular-nums">{formatNumber(candidate.residentsPerBusiness ?? 0)}</strong> ساكن/منشأة</span> : <span><strong className="text-foreground tabular-nums">{formatNumber(candidate.competitorCount)}</strong> منشأة مرصودة في الحي</span>}
                  {candidate.children + candidate.workingAge + candidate.seniors > 0 ? <span>أعمار السكان: دون 15 {formatNumber(candidate.children)} · 15–64 {formatNumber(candidate.workingAge)} · 65+ {formatNumber(candidate.seniors)}</span> : null}
                  {candidate.male + candidate.female > 0 ? <span>تقدير حسب الجنس: ذكور {formatNumber(candidate.male)} · إناث {formatNumber(candidate.female)}</span> : null}
                  <span>تغطية تقدير السكان {formatNumber(candidate.coverage)}٪</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {noMatches.length ? (
        <div className="mt-2 border-t pt-2">
          <p className="text-xs font-semibold">أحياء كبيرة بلا نتائج مطابقة في أطلس</p>
          <ul className="mt-1 divide-y">
            {noMatches.map((area) => (
              <li key={area.districtName}>
                <button type="button" onClick={() => onFocusDistrict(area.districtName)} className="flex w-full items-center justify-between gap-3 py-2 text-right text-xs hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="truncate">{area.districtName}</span>
                <span className="shrink-0 text-muted-foreground">{formatNumber(area.population)} ساكن · لا تظهر منشآت مطابقة</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="mt-2 border-t pt-2 text-[11px] leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">مصدر المؤشر وحدوده</summary>
        <p className="mt-1.5">السكان وشرائح العمر والجنس تقديرات WorldPop لعام 2025 مجمّعة داخل حدود الحي من خلايا تقارب 100 م، وليست تعدادًا لأفراد أو بيانات عن العاملين. تُعرض الأحياء التي تغطي خلاياها 50٪ على الأقل من مساحة الحي. أعداد المنشآت مرصودة في أطلس؛ المؤشرات تساعد على المقارنة الأولية ولا تثبت الطلب أو غياب المنافسة.</p>
        <a className="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline" href="https://hub.worldpop.org/geodata/summary?id=83055" target="_blank" rel="noreferrer">مصدر السكان والعمر والجنس · WorldPop</a>
      </details>
    </section>
  )
}
