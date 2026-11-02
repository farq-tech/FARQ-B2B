'use client'

import { ArrowRight, Eye, EyeOff, Loader2, LogIn } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/map'
}

// a fetch that never reached the server throws the browser's own English text («Failed to fetch»): say it in Arabic
const OFFLINE = 'تعذر الاتصال. تحقق من الإنترنت ثم أعد المحاولة.'

export function LoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const passwordField = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError('')
    setPending(true)
    let response: Response
    try {
      response = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      setError(OFFLINE)
      setPending(false)
      return
    }
    const payload = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) {
      setError(payload?.error || 'تعذر تسجيل الدخول. أعد المحاولة.')
      setPending(false)
      // a wrong password is the usual cause: put the cursor back where the fix is
      passwordField.current?.focus()
      passwordField.current?.select()
      return
    }
    setPassword('')
    setPending(false)
    router.replace(safeNext(search.get('next')))
    router.refresh()
  }

  const invalid = error ? { 'aria-invalid': true, 'aria-describedby': 'atlas-login-error' } : {}

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-5">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        {/* the mark on its own line, then the heading: side by side they wrapped into «أطلس أطلس» on a narrow card */}
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="flex items-center gap-1.5" aria-hidden><img src="/brand/farq-b2b-light.svg" alt="" className="h-8 w-auto" /><span className="text-lg font-bold text-foreground">أطلس</span></span>
          <div><h1 className="text-xl font-bold">تسجيل الدخول</h1><p className="mt-1 text-sm text-muted-foreground">إلى فرق أطلس، لعرض الجهات وبياناتها التجارية.</p></div>
        </div>
        {error ? <p id="atlas-login-error" role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        <label className="mb-1.5 block text-sm font-medium" htmlFor="atlas-email">البريد الإلكتروني</label>
        <Input id="atlas-email" type="email" inputMode="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)}
          required dir="ltr" className="mb-4" {...invalid} />
        <label className="mb-1.5 block text-sm font-medium" htmlFor="atlas-password">كلمة المرور</label>
        <div className="relative mb-6">
          <Input ref={passwordField} id="atlas-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required className="pe-11" {...invalid} />
          <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-pressed={showPassword}
            aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} aria-controls="atlas-password"
            className="absolute inset-y-0 end-0 grid w-11 place-items-center rounded-e-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
          {pending ? 'جارٍ الدخول…' : 'دخول'}
        </Button>
      </form>
      <Link href="/" className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4" aria-hidden />العودة إلى الرئيسية
      </Link>
    </main>
  )
}
