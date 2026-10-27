import type { Metadata } from 'next'
import { InsightsHub } from '@/components/insights/insights-hub'

export const metadata: Metadata = {
  title: 'رؤى السوق | فرق أطلس',
}

export default function Page() {
  return <InsightsHub />
}
