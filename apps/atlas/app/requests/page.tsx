import type { Metadata } from 'next'
import { RequestsListView } from '@/components/requests/requests-list-view'

export const metadata: Metadata = {
  title: 'الطلبات | فرق أطلس',
}

export default function RequestsPage() {
  return <RequestsListView />
}
