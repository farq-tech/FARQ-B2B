'use client'

import { useEffect, useState } from 'react'
import { MapPinned, Users } from 'lucide-react'
import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import { normalizeDistrictName } from '@/lib/live-district'
import { loadDistrictPopulation, type DistrictCount, type DistrictPopulation, type LiveActivityMain } from '@/lib/live-market'

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('en-US')
}

export function ExpansionOpportunities({
  cityId,
  query,
  activity,
  counts,
  countsAvailable,
  districts,
  onFocusDistrict,
}: {
  cityId: string
  query: string
  activity: LiveActivityMain | null
  counts: DistrictCount[]
  countsAvailable: boolean
  districts: FeatureCollection<Geometry, GeoJsonProperties> | null | undefined
  onFocusDistrict: (district: string) => void
}) {
  const [populationRows, setPopulationRows] = useState<DistrictPopulation[]>([])
  useEffect(() => {
    const controller = new AbortController()
    setPopulationRows([])
    loadDistrictPopulation(cityId).then((rows) => { if (!controller.signal.aborted) setPopulationRows(rows) }).catch(() => {
      if (!controller.signal.aborted) setPopulationRows([])
    })
    return () => controller.abort()
  }, [cityId])
  const activityName = activity
    ? activity.subs.length === 1 ? activity.subs[0].sub_ar : activity.main_ar
    : query.trim()

  if (!activityName || !populationRows.length || !districts?.features.length || !countsAvailable) return null

  const populationById = new Map(populationRows.filter((row) => row.coverage_pct >= 50).map((row) => [String(row.district_id), row]))
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
    return [{ districtName: districtName.trim(), population: populationRow.population, validCells: populationRow.valid_cells, polygonCells: populationRow.polygon_cells }]
  })
  // Some official city boundaries split one named district into multiple
  // polygons. Join each polygon by ID first, then sum exact same-label pieces.
  const groupedAreas = new Map<string, { districtName: string; population: number; validCells: number; polygonCells: number }>()
  for (const part of areaParts) {
    const current = groupedAreas.get(part.districtName)
    if (current) {
      current.population += part.population
      current.validCells += part.validCells
      current.polygonCells += part.polygonCells
    } else groupedAreas.set(part.districtName, { ...part })
  }
  const areas = [...groupedAreas.values()].map((area) => {
    const competitorCount = countByName.get(normalizeDistrictName(area.districtName)) ?? 0
    const coverage = area.polygonCells > 0 ? (100 * area.validCells) / area.polygonCells : 0
    return { ...area, coverage, competitorCount, residentsPerBusiness: competitorCount > 0 ? area.population / competitorCount : null }
  })
  const candidates = areas.filter((area) => area.competitorCount > 0)
    .sort((a, b) => (b.residentsPerBusiness ?? 0) - (a.residentsPerBusiness ?? 0) || b.population - a.population)
    .slice(0, 6)
  const noMatches = areas.filter((area) => area.competitorCount === 0).sort((a, b) => b.population - a.population).slice(0, 3)

  if (!candidates.length && !noMatches.length) return null

  return (
    <section className="rounded-xl border border-primary/20 bg-card p-4" aria-label="مؤشر فرص التوسع">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><MapPinned className="size-4" aria-hidden /></span>
        <div>
          <h2 className="text-sm font-semibold">أحياء تستحق دراسة التوسع</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{activityName} · ترتيب أولي حسب السكان لكل منشأة مرصودة</p>
        </div>
      </div>
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
                <span><strong className="text-foreground tabular-nums">{formatNumber(candidate.competitorCount)}</strong> منشأة مرصودة · <strong className="text-foreground tabular-nums">{formatNumber(candidate.residentsPerBusiness ?? 0)}</strong> ساكن/منشأة</span>
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
        <p className="mt-1.5">السكان تقديرات WorldPop لعام 2025 مجمّعة داخل حدود الحي من خلايا تقارب 100 م. تُعرض الأحياء التي تغطي خلاياها 50٪ على الأقل من مساحة الحي، ويظهر مستوى التغطية. عدد المنشآت من بيانات النشاط المرصودة في أطلس. ارتفاع النسبة إشارة للمراجعة فقط؛ لا يثبت وجود طلب أو غياب المنافسة، ويتأثر باكتمال بيانات المنشآت.</p>
        <a className="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline" href="https://hub.worldpop.org/geodata/listing?id=135" target="_blank" rel="noreferrer">منهجية بيانات WorldPop</a>
      </details>
    </section>
  )
}
