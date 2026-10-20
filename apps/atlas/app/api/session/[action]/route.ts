import { NextRequest, NextResponse } from 'next/server'
import { clearSession, publicSession, readSession, sessionForRequest, setSession, signIn } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin') || request.headers.get('referer') || ''
  return origin.startsWith(request.nextUrl.origin)
}

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params
  if (action !== 'me') return responseError('المسار غير متاح.', 404)
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return responseError('لا توجد جلسة دخول.', 401)
  const response = NextResponse.json({ data: publicSession(session) }, { headers: { 'cache-control': 'no-store' } })
  if (refreshed) setSession(response, session)
  return response
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params
  if (!sameOrigin(request)) return responseError('طلب غير موثوق.', 403)
  if (action === 'logout') {
    const response = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
    clearSession(response)
    return response
  }
  if (action !== 'login') return responseError('المسار غير متاح.', 404)
  let body: { email?: unknown; password?: unknown }
  try { body = await request.json() } catch { return responseError('بيانات الدخول غير صالحة.', 400) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password || email.length > 254 || password.length > 512) return responseError('أدخل البريد الإلكتروني وكلمة المرور.', 400)
  const { status, session } = await signIn(email, password)
  if (!session) return responseError(status === 401 || status === 403 ? 'بيانات الدخول غير صحيحة.' : 'تعذر الوصول إلى خدمة الحسابات.', status >= 400 ? status : 502)
  const response = NextResponse.json({ data: publicSession(session) }, { headers: { 'cache-control': 'no-store' } })
  setSession(response, session)
  return response
}
