'use client'

import { MousePointerClick } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { AdvisorPanel } from '../advisor-panel'
import type { DistrictRow } from '../city-data'

/**
 * «قارن حيين»: two districts picked on the map go to the comparison assistant, which asks what the comparison is
 * for and compares them from Atlas figures only.
 */
export function CompareTool({ rows, selected }: { rows: DistrictRow[]; selected: DistrictRow[] }) {
  if (selected.length !== 2) {
    return selected.length < 2
      ? <EmptyState icon={MousePointerClick} title={selected.length ? 'اختر حياً ثانياً' : 'اختر حيين'} body={`اضغط ${selected.length ? 'حياً ثانياً' : 'حيين'} على الخريطة، فتبدأ المقارنة هنا.`} />
      : <EmptyState icon={MousePointerClick} title="اختر حيين فقط" body="أزل الزائد بالضغط عليه في الخريطة، فتبدأ المقارنة بين الاثنين الباقيين." />
  }
  return <AdvisorPanel key={selected.map((row) => row.id).join('|')} subject={{ kind: 'districts', rows: selected }} rows={rows} />
}
