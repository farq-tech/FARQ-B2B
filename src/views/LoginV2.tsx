import { useState } from 'react'
import { FarqAuthError, farqSession } from '../api/farqSession'
import type { View } from '../procurementContext'
import Brand from '../b2b/Brand'
import { FarqGlassButton } from '../ui/FarqGlassButton'

/* Sign in with the Farq account (POST /api/auth/login). Only allowed accounts pass App's gate afterwards. */
export function LoginV2({ navigate }: { navigate: (view: View) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (!email.trim() || !password || loading) return
    setError(''); setLoading(true)
    try { await farqSession.signIn(email.trim(), password); setPassword(''); navigate('targeting') }
    catch (e) { setError(e instanceof FarqAuthError ? (e.message || 'تعذر تسجيل الدخول') : 'تعذر الوصول إلى الخادم') }
    finally { setLoading(false) }
  }
  return (
    <div className="flex min-h-screen items-center justify-center px-4">{/* transparent: the living background (BG / Facets) shows around the card */}
      <form className="w-full max-w-sm rounded-[24px] border bg-white p-7" style={{ borderColor: 'var(--color-border-default)' }} onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="mb-8 flex flex-col items-center gap-3">
          <Brand />
          <p className="text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}>تسجيل الدخول</p>
        </div>
        {error ? <p role="alert" className="mb-4 rounded-[12px] px-4 py-3 text-[14px] font-medium" style={{ background: 'var(--color-bg-danger)', color: 'var(--color-text-danger)' }}>{error}</p> : null}
        <label htmlFor="login-email" className="mb-1 block text-[14px] font-medium">البريد الإلكتروني</label>
        <input id="login-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" className="mb-4 w-full rounded-[12px] border px-4 py-3 text-[16px] outline-none focus:border-[var(--color-border-primary)]" style={{ borderColor: 'var(--color-border-default)' }} />
        <label htmlFor="login-password" className="mb-1 block text-[14px] font-medium">كلمة المرور</label>
        <input id="login-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" className="mb-6 w-full rounded-[12px] border px-4 py-3 text-[16px] outline-none focus:border-[var(--color-border-primary)]" style={{ borderColor: 'var(--color-border-default)' }} />
        <FarqGlassButton type="submit" loading={loading} disabled={loading || !email.trim() || !password} className="w-full">دخول</FarqGlassButton>
        <a href="/" className="mt-5 block text-center text-sm underline">العودة إلى صفحة البداية</a>
      </form>
    </div>
  )
}
