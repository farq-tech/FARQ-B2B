'use client'

import { ArrowRight, CheckCircle2, Loader2, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { REQUEST_ACCESS_PATH, normalizeContact } from '@/lib/access-request'

const OFFLINE = 'تعذر الاتصال. تحقق من الإنترنت ثم أعد المحاولة.'

/**
 * «احذف بياناتي»: one field, the email or mobile written in the account request. Farq keeps only that contact's hash
 * to find the request, and deletes its details by hand (services/targeting-api/access_requests.py). The answer is the
 * same whether or not a request exists, so this page never says whether someone asked for an account.
 */
export function DeleteDetailsForm() {
  const [contact, setContact] = useState('')
  const [error, setError] = useState('')
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const trap = useRef<HTMLInputElement>(null)
  const done = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (sent) done.current?.focus() }, [sent])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setFailure('')
    const typed = contact.trim()
    const problem = !typed ? 'اكتب البريد أو الجوال الذي كتبته في طلبك.' : !normalizeContact(typed) ? 'اكتب البريد أو الجوال كما كتبته في طلبك. مثال: 05XXXXXXXX' : ''
    setError(problem)
    if (problem) { field.current?.focus(); return }
    setPending(true)
    let response: Response
    try {
      response = await fetch('/api/access-request/deletion', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contact: typed, website: trap.current?.value ?? '' }),
      })
    } catch {
      setFailure(OFFLINE); setPending(false); return
    }
    const payload = await response.json().catch(() => null) as { error?: string; fields?: { contact?: string } } | null
    setPending(false)
    if (!response.ok) {
      if (payload?.fields?.contact) { setError(payload.fields.contact); field.current?.focus() }
      setFailure(payload?.error || 'تعذر إرسال طلبك. أعد المحاولة.')
      return
    }
    setSent(true)
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-5">
      {sent ? (
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm" aria-labelledby="delete-done">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><CheckCircle2 className="size-6" aria-hidden /></span>
          <h1 id="delete-done" ref={done} tabIndex={-1} className="text-xl font-bold outline-none">وصل طلب الحذف</h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            إن كان لدينا طلب حساب بهذا البريد أو الجوال، يحذف فريق فرق بياناته يدوياً: الاسم والجهة والتواصل وما كتبته.
            لا يُرسل إليك شيء تلقائياً.
          </p>
          <Link href="/" className={buttonVariants({ variant: 'outline', className: 'mt-5 w-full' })}>الرئيسية</Link>
        </section>
      ) : (
        <form onSubmit={submit} noValidate className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm" aria-labelledby="delete-title">
          <h1 id="delete-title" className="text-xl font-bold">احذف بيانات طلبك</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            اكتب البريد أو الجوال الذي كتبته في طلب الحساب. نحتفظ به لنجد طلبك فقط، ويحذف فريق فرق بياناته يدوياً.
          </p>
          <div role="alert" className="empty:hidden">
            {failure ? <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{failure}</p> : null}
          </div>
          <label className="mb-1.5 mt-5 block text-sm font-medium" htmlFor="delete-contact">بريد العمل أو رقم الجوال</label>
          <Input ref={field} id="delete-contact" dir="ltr" inputMode="email" autoComplete="email" value={contact} maxLength={254}
            placeholder="name@company.sa  ·  05XXXXXXXX" className="text-start" onChange={(event) => setContact(event.target.value)}
            aria-invalid={error ? true : undefined} aria-describedby={error ? 'delete-contact-error' : undefined} />
          {error ? <p id="delete-contact-error" className="mt-1.5 text-sm text-destructive">{error}</p> : null}
          <div aria-hidden className="sr-only">
            <label htmlFor="delete-website">الموقع</label>
            <input ref={trap} id="delete-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
          <Button type="submit" variant="destructive" className="mt-6 w-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            {pending ? 'جارٍ الإرسال…' : 'اطلب حذف بياناتي'}
          </Button>
        </form>
      )}
      <Link href={REQUEST_ACCESS_PATH} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4" aria-hidden />العودة إلى طلب الحساب
      </Link>
    </main>
  )
}
