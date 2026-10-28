import type { Metadata } from 'next'
import { HomesPage } from '@/components/homes/homes-page'

export const metadata: Metadata = {
  title: 'العقار | فرق أطلس',
}

export default function Page() {
  return <HomesPage />
}
