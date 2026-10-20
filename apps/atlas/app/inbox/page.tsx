import type { Metadata } from 'next'
import { Suspense } from 'react'
import { InboxView } from '@/components/inbox/inbox-view'

export const metadata: Metadata = {
  title: 'الوارد | فرق أطلس',
  description: 'ردود طلبات التسعير وتفاعلات الحملات التسويقية.',
}

export default function InboxPage() {
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  )
}
