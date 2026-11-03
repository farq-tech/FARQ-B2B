import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/login-form'
import { RouteLoading } from '@/components/shared/route-loading'

export const metadata = { title: 'تسجيل الدخول | فرق أطلس' }

export default function LoginPage() {
  // the form reads ?next= on the client: until it does, the static page shows the card's shape, not a blank screen
  return <Suspense fallback={<RouteLoading label="تسجيل الدخول" shape="form" />}><LoginForm /></Suspense>
}
