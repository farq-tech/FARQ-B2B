import type { Metadata } from 'next'
import { DistrictReportView } from '@/components/insights/district-report-view'

export const metadata: Metadata = {
  title: 'تقرير الحي | فرق أطلس',
}

export default function Page() {
  return <DistrictReportView />
}
