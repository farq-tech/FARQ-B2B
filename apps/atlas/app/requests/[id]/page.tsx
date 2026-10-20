import type { Metadata } from 'next'
import { RequestDetailView } from '@/components/requests/request-detail-view'

export const metadata: Metadata = {
  title: 'تفاصيل الطلب | فرق أطلس',
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RequestDetailView id={id} />
}
