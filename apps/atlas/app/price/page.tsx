import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PriceEstimator } from '@/components/price/price-estimator'
import { RouteLoading } from '@/components/shared/route-loading'

export const metadata: Metadata = { title: 'سعّر عقارك · أطلس' }

export default function PricePage() {
  // the answers are read from the address on the client: until then the page keeps its shape
  return <Suspense fallback={<RouteLoading label="سعّر عقارك" shape="split" width="max-w-5xl" />}><PriceEstimator /></Suspense>
}
