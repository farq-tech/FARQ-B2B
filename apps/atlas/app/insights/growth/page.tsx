import type { Metadata } from 'next'
import { GrowthView } from '@/components/insights/growth-view'

export const metadata: Metadata = {
  title: 'خريطة النمو | فرق أطلس',
}

export default function Page() {
  return <GrowthView />
}
