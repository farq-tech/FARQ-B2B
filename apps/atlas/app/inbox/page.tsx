import type { Metadata } from 'next'
import { Suspense } from 'react'
import { InboxView } from '@/components/inbox/inbox-view'
import { RouteLoading } from '@/components/shared/route-loading'

export const metadata: Metadata = {
  title: 'الوارد | فرق أطلس',
  description: 'ردود طلبات التسعير وتفاعلات الحملات التسويقية.',
}

export default function InboxPage() {
  return (
    // the view reads ?m= and ?f= on the client: until then the page keeps its shape instead of drawing nothing
    <Suspense fallback={<RouteLoading label="الوارد" width="max-w-6xl" />}>
      <InboxView />
    </Suspense>
  )
}
