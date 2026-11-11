import type { Metadata } from 'next'
import { UnlinkedReview } from '@/components/inbox/unlinked-review'

export const metadata: Metadata = {
  title: 'ردود غير مرتبطة | فرق أطلس',
  description: 'مراجعة ردود واتساب التي لم تُطابق حملة.',
}

export default function UnlinkedRepliesPage() {
  return <UnlinkedReview />
}
