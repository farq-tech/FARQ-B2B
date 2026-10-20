import type { Metadata } from 'next'
import { OpportunityMapView } from '@/components/opportunity/opportunity-map-view'

export const metadata: Metadata = {
  title: 'خريطة الفرص | فرق أطلس',
}

export default function OpportunityMapPage() {
  return <OpportunityMapView />
}
