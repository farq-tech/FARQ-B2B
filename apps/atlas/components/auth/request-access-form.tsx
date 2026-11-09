'use client'

import { ArrowRight, CheckCircle2, Loader2, Map as MapIcon, Send } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ACCESS_CATEGORIES, ACCESS_FIELD_ORDER, DELETE_DETAILS_PATH, accessRequestBody, categoryFromNext, safeNext, validateAccessRequest, type AccessErrors, type AccessField, type AccessRequestInput } from '@/lib/access-request'
import { numberFormat, useCityCatalog } from '@/lib/insights-api'
import { cn } from '@/lib/utils'

const OFFLINE = 'تعذر الاتصال. تحقق من الإنترنت ثم أعد المحاولة.'
const EMPTY: AccessRequestInput = { name: '', company: '', contact: '', city: '', category: '', purpose: '' }
const PURPOSE_MAX = 500

/**
 * «اطلب حساباً»: a new customer asks for an Atlas account in six plain fields. The request is kept for Farq to review
 * by hand (app/api/access-request/route.ts); nothing is sent to anyone and no account is made automatically. After
 * sending, the page says what happens next and offers the way back to where the person was (`?next=`).
 */
export function RequestAccessForm() {
  const search = useSearchParams()
  const next = safeNext(search.get('next'))
  const cities = useCityCatalog()
  // the group the person came from on the map is chosen already; one tap changes it
  const [value, setValue] = useState<AccessRequestInput>(() => ({ ...EMPTY, category: categoryFromNext(next) }))
  const [errors, setErrors] = useState<AccessErrors>({})
  const [tried, setTried] = useState(false)
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  // one «وصل طلبك» for every accepted request: whether the contact had asked before is never shown
  const [sent, setSent] = useState(false)
  const trap = useRef<HTMLInputElement>(null)
  const done = useRef<HTMLHeadingElement>(null)
  const cityNames = cities.map((city) => city.en)

  useEffect(() => { if (sent) done.current?.focus() }, [sent])

  const set = (field: AccessField, text: string) => {
    const updated = { ...value, [field]: text }
    setValue(updated)
    // once a send was tried, each field says at once whether it is fixed
    if (tried) setErrors(validateAccessRequest(updated, cityNames))
  }

  const focusFirst = (found: AccessErrors) => {
    const first = ACCESS_FIELD_ORDER.find((field) => found[field])
    if (!first) return
    const target = first === 'category' ? document.querySelector<HTMLInputElement>('input[name="access-category"]') : document.getElementById(`access-${first}`)
    target?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setTried(true)
    setFailure('')
    const found = validateAccessRequest(value, cityNames)
    setErrors(found)
    if (Object.keys(found).length) { focusFirst(found); return }
    setPending(true)
    let response: Response
    try {
      response = await fetch('/api/access-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...accessRequestBody(value, next), website: trap.current?.value ?? '' }),
      })
    } catch {
      setFailure(OFFLINE)
      setPending(false)
      return
    }
    const payload = await response.json().catch(() => null) as { error?: string; fields?: AccessErrors } | null
    setPending(false)
    if (!response.ok) {
      if (payload?.fields) { setErrors(payload.fields); focusFirst(payload.fields) }
      setFailure(payload?.error || 'تعذر إرسال طلبك. أعد المحاولة.')
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-5">
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm" aria-labelledby="access-done">
          <div className="mb-5 flex flex-col items-center gap-3 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><CheckCircle2 className="size-6" aria-hidden /></span>
            <h1 id="access-done" ref={done} tabIndex={-1} className="text-xl font-bold outline-none">وصل طلبك</h1>
            <p className="text-sm leading-7 text-muted-foreground">شكراً لك. هذا ما يحدث بعد الآن:</p>
          </div>
          <ol className="flex flex-col gap-3 text-sm leading-7">
            {[
              'يراجع فريق فرق طلبك بنفسه. لا يُنشأ حساب ولا تُرسل رسالة تلقائياً.',
              'نتواصل معك على البريد أو الجوال الذي كتبته، لنفهم ما تحتاجه.',
              'إن وافقنا على الطلب، نجهّز حسابك ونخبرك كيف تدخل.',
            ].map((line, index) => (
              <li key={line} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground" aria-hidden>{numberFormat.format(index + 1)}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 rounded-xl bg-muted/60 px-3 py-2 text-sm leading-6 text-muted-foreground">الخريطة مفتوحة لك الآن بلا حساب، فتابع منها ما بدأته.</p>
          {/* how to have the details deleted, in place: a form of its own, the owner deletes by hand */}
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            تريد حذف بياناتك من طلبك؟{' '}
            <Link href={DELETE_DETAILS_PATH} className="font-semibold text-primary underline-offset-4 hover:underline">اطلب حذفها</Link>
            {' '}في أي وقت، ويحذفها فريق فرق يدوياً. ولا تُحفظ بلا نهاية: تُحذف تلقائياً بعد مدة محددة.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link href={next ?? '/map'} className={buttonVariants({ className: 'sm:flex-1' })}>
              <MapIcon data-icon="inline-start" aria-hidden />{next ? 'العودة إلى حيث كنت' : 'افتح الخريطة'}
            </Link>
            <Link href="/" className={buttonVariants({ variant: 'outline', className: 'sm:flex-1' })}>الرئيسية</Link>
          </div>
        </section>
      </main>
    )
  }

  const count = Object.keys(errors).length
  const describe = (field: AccessField, hint?: string) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': [hint, errors[field] ? `access-${field}-error` : null].filter(Boolean).join(' ') || undefined,
  })
  const fieldError = (field: AccessField) => errors[field]
    ? <p id={`access-${field}-error`} className="mt-1.5 text-sm text-destructive">{errors[field]}</p>
    : null
  const label = 'mb-1.5 block text-sm font-medium'

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-5">
      <form onSubmit={submit} noValidate className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm" aria-labelledby="access-title">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex items-center gap-1.5" aria-hidden><img src="/brand/farq-b2b-light.svg" alt="" className="h-8 w-auto" /><span className="text-lg font-bold text-foreground">أطلس</span></span>
          <div>
            <h1 id="access-title" className="text-xl font-bold">اطلب حساباً</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">الخريطة مفتوحة بلا حساب. الحساب يفتح الأدوات التي تحتاج الدخول، ويراجع فريق فرق كل طلب بنفسه.</p>
          </div>
        </div>

        {/* one announcement per try: the count of fields to fix, or why the request did not go */}
        <div role="alert" className="empty:hidden">
          {failure ? <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{failure}</p>
            : tried && count ? <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{count === 1 ? 'راجع الحقل المعلّم.' : `راجع الحقول المعلّمة (${numberFormat.format(count)}).`}</p>
              : null}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className={label} htmlFor="access-name">اسمك</label>
            <Input id="access-name" autoComplete="name" value={value.name} maxLength={80} onChange={(event) => set('name', event.target.value)} {...describe('name')} />
            {fieldError('name')}
          </div>
          <div>
            <label className={label} htmlFor="access-company">الجهة التي تعمل فيها</label>
            <Input id="access-company" autoComplete="organization" value={value.company} maxLength={120} placeholder="اسم الشركة أو المنشأة" onChange={(event) => set('company', event.target.value)} {...describe('company')} />
            {fieldError('company')}
          </div>
          <div>
            <label className={label} htmlFor="access-contact">بريد العمل أو رقم الجوال</label>
            <Input id="access-contact" dir="ltr" inputMode="email" autoComplete="email" value={value.contact} maxLength={254} placeholder="name@company.sa  ·  05XXXXXXXX"
              onChange={(event) => set('contact', event.target.value)} className="text-start" {...describe('contact', 'access-contact-hint')} />
            <p id="access-contact-hint" className="mt-1.5 text-xs leading-5 text-muted-foreground">نتواصل معك عليه بخصوص طلبك فقط، ولا يراه أحد غير فريق فرق.</p>
            {fieldError('contact')}
          </div>
          <div>
            <span id="access-city-label" className={label}>مدينتك</span>
            <Select items={cities.map((city) => ({ value: city.en, label: city.ar }))} value={value.city || null} onValueChange={(picked) => set('city', (picked as string | null) ?? '')}>
              <SelectTrigger id="access-city" aria-labelledby="access-city-label" className="h-10 w-full bg-background text-base md:text-sm" {...describe('city')}><SelectValue placeholder="اختر المدينة" /></SelectTrigger>
              <SelectContent>
                {cities.map((city) => <SelectItem key={city.en} value={city.en}>{city.ar}</SelectItem>)}
              </SelectContent>
            </Select>
            {fieldError('city')}
          </div>
          <fieldset aria-describedby={errors.category ? 'access-category-error' : undefined}>
            <legend className={label}>ما الذي تريده من أطلس؟</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ACCESS_CATEGORIES.map((category) => (
                <label key={category.id} className={cn('flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring', errors.category && 'border-destructive/60')}>
                  <input type="radio" name="access-category" value={category.id} checked={value.category === category.id} onChange={() => set('category', category.id)}
                    aria-invalid={errors.category ? true : undefined} className="size-4 shrink-0 accent-primary" />
                  {category.label}
                </label>
              ))}
            </div>
            {fieldError('category')}
          </fieldset>
          <div>
            <label className={label} htmlFor="access-purpose">ماذا تريد أن تفعل؟ <span className="font-normal text-muted-foreground">(اختياري)</span></label>
            <Textarea id="access-purpose" rows={3} value={value.purpose} maxLength={PURPOSE_MAX} placeholder="مثال: أبحث عن حي لفرع مطعمي الثاني في شمال الرياض."
              onChange={(event) => set('purpose', event.target.value)} {...describe('purpose', 'access-purpose-count')} />
            <p id="access-purpose-count" className="mt-1 text-end text-xs text-muted-foreground" dir="ltr">{numberFormat.format(value.purpose.length)}/{numberFormat.format(PURPOSE_MAX)}</p>
            {fieldError('purpose')}
          </div>
          {/* left empty by people (it is never shown); a script that fills every field is told «received» and dropped */}
          <div aria-hidden className="sr-only">
            <label htmlFor="access-website">الموقع</label>
            <input ref={trap} id="access-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
        </div>

        <Button type="submit" className="mt-6 w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
          {pending ? 'جارٍ الإرسال…' : 'أرسل الطلب'}
        </Button>
        <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">لا يُرسل إليك شيء تلقائياً. يراجع فريق فرق الطلب ثم يتواصل معك.</p>
        {/* what is kept, who sees it, for how long, and how to have it deleted: before sending, in one place */}
        <section aria-labelledby="access-privacy" className="mt-4 rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <h2 id="access-privacy" className="mb-1 font-semibold text-foreground">بياناتك</h2>
          <p>
            نحفظ ما تكتبه هنا لمراجعة طلبك والتواصل معك بخصوصه فقط. لا يراه أحد غير فريق فرق، ولا نشاركه مع أي جهة.
            يُحذف تلقائياً بعد مدة محددة، ولك أن{' '}
            <Link href={DELETE_DETAILS_PATH} className="font-semibold text-primary underline-offset-4 hover:underline">تطلب حذفه</Link>
            {' '}في أي وقت.
          </p>
        </section>
        <p className="mt-5 border-t pt-4 text-center text-sm text-muted-foreground">
          لديك حساب؟{' '}
          <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="font-semibold text-primary underline-offset-4 hover:underline">سجّل الدخول</Link>
        </p>
      </form>
      <Link href={next ?? '/'} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4" aria-hidden />{next ? 'العودة إلى حيث كنت' : 'العودة إلى الرئيسية'}
      </Link>
    </main>
  )
}
