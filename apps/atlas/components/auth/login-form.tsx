'use client'

import { Loader2, LogIn } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/map'
}

export function LoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError('')
    setPending(true)
    try {
      const response = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'تعذر تسجيل الدخول.')
      setPassword('')
      router.replace(safeNext(search.get('next')))
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تسجيل الدخول.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-7 flex items-center gap-3">
          <span className="flex items-center gap-1.5" aria-hidden><img src="/brand/farq-b2b-light.svg" alt="" className="h-7 w-auto" /><span className="font-bold text-foreground">أطلس</span></span>
          <div><h1 className="font-bold">تسجيل الدخول إلى فرق أطلس</h1><p className="mt-0.5 text-sm text-muted-foreground">لعرض الجهات وبياناتها التجارية.</p></div>
        </div>
        {error ? <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        <label className="mb-1.5 block text-sm font-medium" htmlFor="atlas-email">البريد الإلكتروني</label>
        <Input id="atlas-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required dir="ltr" className="mb-4" />
        <label className="mb-1.5 block text-sm font-medium" htmlFor="atlas-password">كلمة المرور</label>
        <Input id="atlas-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className="mb-6" />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
          {pending ? 'جارٍ الدخول…' : 'دخول'}
        </Button>
      </form>
    </main>
  )
}
