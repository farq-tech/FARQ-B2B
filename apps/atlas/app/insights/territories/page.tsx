import type { Metadata } from 'next'
import { TerritoriesView } from '@/components/insights/territories-view'

export const metadata: Metadata = {
  title: 'مناطق المندوبين | فرق أطلس',
}

export default function Page() {
  return <TerritoriesView />
}
