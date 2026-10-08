import { useState } from 'react'
import { FarqAuthError, farqSession } from '../api/farqSession'
import type { NavProps } from '../types'
import mark from '../assets/pricing-v2/mark.svg'

/* Sign in with the Farq account (POST /api/auth/login). Only allowed accounts pass App's gate afterwards. */
export function LoginV2({ navigate }: NavProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (!email.trim() || !password || loading) return
    setError(''); setLoading(true)
    try { await farqSession.signIn(email.trim(), password); setPassword(''); navigate('rfq-list') }
    catch (e) { setError(e instanceof FarqAuthError ? (e.message || 'تعذر تسجيل الدخول') : 'تعذر الوصول إلى الخادم') }
    finally { setLoading(false) }
  }
  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: 'var(--color-bg-canvas)' }}>
      <form className="w-full max-w-sm rounded-[24px] border bg-white p-7" style={{ borderColor: 'var(--color-border-default)' }} onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src={mark} alt="" width={48} height={48} />
          <div className="flex items-baseline gap-1"><span className="text-[18px]" style={{ color: 'var(--color-text-secondary)' }}>تسعير</span><span className="font-[Readex_Pro] text-[24px] font-semibold">فرق</span></div>
          <p className="text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}>صفحة خاصة بالمالك</p>
        </div>
        {error ? <p className="mb-4 rounded-[12px] px-4 py-3 text-[14px] font-medium" style={{ background: 'var(--color-bg-danger)', color: 'var(--color-text-danger)' }}>{error}</p> : null}
        <label htmlFor="login-email" className="mb-1 block text-[14px] font-medium">البريد</label>
        <input id="login-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" className="mb-4 w-full rounded-[12px] border px-4 py-3 text-[16px] outline-none focus:border-[var(--color-border-primary)]" style={{ borderColor: 'var(--color-border-default)' }} />
        <label htmlFor="login-password" className="mb-1 block text-[14px] font-medium">كلمة المرور</label>
        <input id="login-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" className="mb-6 w-full rounded-[12px] border px-4 py-3 text-[16px] outline-none focus:border-[var(--color-border-primary)]" style={{ borderColor: 'var(--color-border-default)' }} />
        <button type="submit" disabled={loading || !email.trim() || !password} className="h-12 w-full rounded-[12px] text-[16px] font-medium text-white disabled:opacity-40" style={{ background: 'var(--color-bg-cta)' }}>{loading ? 'جارٍ الدخول…' : 'دخول'}</button>
      </form>
    </div>
  )
}
