import type { Metadata } from 'next'
import { MarketGapsView } from '@/components/insights/market-gaps-view'

export const metadata: Metadata = {
  title: 'فجوات السوق | فرق أطلس',
}

export default function MarketGapsPage() {
  return <MarketGapsView />
}
