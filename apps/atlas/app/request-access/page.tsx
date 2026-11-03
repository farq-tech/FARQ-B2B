import { Suspense } from 'react'
import { RequestAccessForm } from '@/components/auth/request-access-form'
import { RouteLoading } from '@/components/shared/route-loading'

export const metadata = { title: 'اطلب حساباً | فرق أطلس' }

export default function RequestAccessPage() {
  // the form reads ?next= on the client: until it does, the static page shows the card's shape, not a blank screen
  return <Suspense fallback={<RouteLoading label="اطلب حساباً" shape="form" />}><RequestAccessForm /></Suspense>
}
