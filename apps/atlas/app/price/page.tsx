import type { Metadata } from 'next'
import { PriceEstimator } from '@/components/price/price-estimator'

export const metadata: Metadata = { title: 'سعّر عقارك · أطلس' }

export default function PricePage() {
  return <PriceEstimator />
}
