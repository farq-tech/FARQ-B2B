import type { Metadata } from 'next'
import { LensMap } from '@/components/lens/lens-map'

export const metadata: Metadata = {
  title: 'الخريطة | فرق أطلس',
}

export default function Page() {
  return <LensMap />
}
