'use client'

import { MousePointerClick } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { AdvisorPanel } from '../advisor-panel'
import { figure } from '../advisor-facts'
import type { DistrictRow } from '../city-data'
import { districtsVerdict, type DistrictFigure } from './tool-answers'
import { Verdict } from './verdict'

/**
 * The figures the pair's summary weighs, each read from the district's golden row and shown as the comparison table
 * shows it (advisor-facts `figure`), so the line and the table never disagree.
 */
const FIGURES: { label: string; value: (row: DistrictRow) => number | null; unit?: string }[] = [
  { label: 'السكان', value: (row) => row.population },
  { label: 'المنشآت', value: (row) => row.businesses },
  { label: 'ساكن لكل منشأة', value: (row) => row.residentsPerBusiness },
  { label: 'متوسط الدخل الشهري', value: (row) => row.income, unit: ' ريال' },
  { label: 'حصة الفلل من المساكن', value: (row) => row.villaShare, unit: '%' },
  { label: 'مبانٍ تحت الإنشاء', value: (row) => row.underConstruction },
]

/**
 * «قارن حيين»: two districts picked on the map open with one line on where they differ most (no recommendation: the
 * analyst reads the figures), then go to the comparison assistant, which asks what the comparison is for and compares
 * them from Atlas figures only.
 */
export function CompareTool({ rows, selected }: { rows: DistrictRow[]; selected: DistrictRow[] }) {
  if (selected.length !== 2) {
    return selected.length < 2
      ? <EmptyState icon={MousePointerClick} title={selected.length ? 'اختر حياً ثانياً' : 'اختر حيين'} body={`اضغط ${selected.length ? 'حياً ثانياً' : 'حيين'} على الخريطة، فتبدأ المقارنة هنا.`} />
      : <EmptyState icon={MousePointerClick} title="اختر حيين فقط" body="أزل الزائد بالضغط عليه في الخريطة، فتبدأ المقارنة بين الاثنين الباقيين." />
  }
  const [a, b] = selected
  const figures: DistrictFigure[] = FIGURES.map((item) => ({
    label: item.label, a: item.value(a), b: item.value(b), shown: [figure(item.value(a), item.unit), figure(item.value(b), item.unit)],
  }))
  return (
    <div className="flex flex-col gap-3">
      <Verdict verdict={districtsVerdict([a.name, b.name], figures)} />
      <AdvisorPanel key={selected.map((row) => row.id).join('|')} subject={{ kind: 'districts', rows: selected }} rows={rows} />
    </div>
  )
}
