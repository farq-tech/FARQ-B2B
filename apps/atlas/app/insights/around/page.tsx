import type { Metadata } from 'next'
import { AroundView } from '@/components/insights/around-view'

export const metadata: Metadata = {
  title: 'السكان حول موقع | فرق أطلس',
}

export default function Page() {
  return <AroundView />
}
