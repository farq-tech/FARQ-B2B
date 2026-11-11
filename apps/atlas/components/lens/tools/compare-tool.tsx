'use client'

import { MousePointerClick } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { AdvisorPanel } from '../advisor-panel'
import { figure } from '../advisor-facts'
import { counted } from '@/lib/insights-api'
import type { DistrictRow } from '../city-data'
import { districtsVerdict, sparseLine, type DistrictFigure, type VerdictText } from './tool-answers'

/** The pair's verdict with a sparsely settled district said in its caution. */
const withSparse = (verdict: VerdictText | null, line: string | null) => (verdict && line ? { ...verdict, caution: [verdict.caution, line].filter(Boolean).join(' ') } : verdict)
import { RELIABLE_LISTINGS } from '../lenses'
import { Verdict } from './verdict'

/**
 * The figures the pair's summary weighs, each read from the district's golden row and shown as the comparison table
 * shows it (advisor-facts `figure`), so the line and the table never disagree.
 */
const FIGURES: { label: string; value: (row: DistrictRow) => number | null; unit?: string; listings?: (row: DistrictRow) => number | null }[] = [
  { label: 'السكان', value: (row) => row.population },
  { label: 'المنشآت', value: (row) => row.businesses },
  { label: 'ساكن لكل منشأة', value: (row) => row.residentsPerBusiness },
  { label: 'متوسط الدخل الشهري', value: (row) => row.income, unit: ' ريال' },
  { label: 'حصة الفلل من المساكن', value: (row) => row.villaShare, unit: '%' },
  { label: 'مبانٍ تحت الإنشاء', value: (row) => row.underConstruction },
  // the listing medians, under the advisor table's own labels; one from fewer than RELIABLE_LISTINGS ads is never
  // weighed (the summary names it as a small sample), as it never shades the map or enters a ranking
  ...([
    ['وسيط إيجار السكن السنوي للمتر', 'rent_year_residential'],
    ['وسيط سعر بيع السكن للمتر', 'sale_residential'],
    ['وسيط إيجار المحل السنوي للمتر', 'rent_year_commercial'],
  ] as const).map(([label, key]) => ({
    label, unit: ' ريال',
    value: (row: DistrictRow) => row.realEstate[key]?.median ?? null,
    listings: (row: DistrictRow) => row.realEstate[key]?.listings ?? null,
  })),
]

/**
 * «قارن حيين»: two districts picked on the map open with one line on where they differ most (no recommendation: the
 * analyst reads the figures), then go to the comparison assistant, which asks what the comparison is for and compares
 * them from Atlas figures only.
 */
function shownWith(item: (typeof FIGURES)[number], row: DistrictRow): string {
  const shown = figure(item.value(row), item.unit)
  const listings = item.listings?.(row)
  return item.value(row) != null && listings ? `${shown} من ${counted(listings, 'listing')}` : shown
}

export function CompareTool({ rows, selected }: { rows: DistrictRow[]; selected: DistrictRow[] }) {
  if (selected.length !== 2) {
    return selected.length < 2
      ? <EmptyState icon={MousePointerClick} title={selected.length ? 'اختر حياً ثانياً' : 'اختر حيين'} body={`اضغط ${selected.length ? 'حياً ثانياً' : 'حيين'} على الخريطة، فتبدأ المقارنة هنا.`} />
      : <EmptyState icon={MousePointerClick} title="اختر حيين فقط" body="أزل الزائد بالضغط عليه في الخريطة، فتبدأ المقارنة بين الاثنين الباقيين." />
  }
  const [a, b] = selected
  const figures: DistrictFigure[] = FIGURES.map((item) => ({
    label: item.label, a: item.value(a), b: item.value(b),
    // a listing median carries how many ads it rests on («900 ريال من 25 عرضاً»), so its weight is read with it
    shown: [shownWith(item, a), shownWith(item, b)],
    ...(item.listings ? { thin: [(item.listings(a) ?? 0) < RELIABLE_LISTINGS, (item.listings(b) ?? 0) < RELIABLE_LISTINGS] as [boolean, boolean] } : {}),
  }))
  return (
    <div className="flex flex-col gap-3">
      <Verdict verdict={withSparse(districtsVerdict([a.name, b.name], figures), sparseLine([a.name, b.name], [a.settledPct, b.settledPct]))} />
      <AdvisorPanel key={selected.map((row) => row.id).join('|')} subject={{ kind: 'districts', rows: selected }} rows={rows} />
    </div>
  )
}
