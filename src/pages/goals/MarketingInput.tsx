import { useState } from 'react'
import { useProcurement } from '../../procurementContext'
import { handoff, HANDOFF } from '../../lib/handoff'
import { readBooklet } from '../../lib/readBooklet'

export default function MarketingInput() {
  const { navigate } = useProcurement()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [review, setReview] = useState(false)
  async function read(files: File[]) {
    setBusy(true); setError('')
    try {
      const lines = await readBooklet(files, setNote)
      if (!lines.length) throw new Error('ما لقينا منتجات أو خدمات واضحة في الملف.')
      setText(lines.map(line => line.name).join('\n')); setReview(true)
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذرت قراءة الملف') }
    finally { setBusy(false); setNote('') }
  }
  return <section dir="rtl" className="mx-auto flex min-h-screen w-full max-w-[760px] flex-col gap-6 p-5 sm:p-10">
    <button type="button" className="self-start underline" onClick={() => navigate('targeting')}>رجوع لخريطة الفرص</button>
    <h1 className="text-[32px] font-bold">{review ? 'راجع المنتجات والخدمات اللي تبي تسوّقها' : 'وش تبي نسوّق لك اليوم؟'}</h1>
    <p className="leading-7 text-[var(--color-text-secondary)]">ارفع كتالوجك أو اكتب تخصصك مباشرة، مثل «مواد سباكة». نبحث عن جهات قد تستخدم منتجاتك أو تستفيد من خدماتك.</p>
    <label className="flex flex-col gap-2 font-medium">{review ? 'عدّل العناصر قبل البحث — سطر لكل منتج أو خدمة' : 'اكتب تخصصك أو منتجاتك وخدماتك — سطر لكل عنصر'}
      <textarea rows={6} value={text} disabled={busy} onChange={event => setText(event.target.value)} placeholder="مثل: مواد سباكة، أجهزة كمبيوتر، أو خدمات موارد بشرية" className="rounded-[16px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4" />
    </label>
    <label className="flex flex-col gap-3 rounded-[16px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5">ارفع كتالوجك أو صوّره
      <span className="text-sm text-[var(--color-text-secondary)]">PDF أو Excel أو صور المنتجات والخدمات</span>
      <input type="file" accept=".pdf,.xlsx,image/*" disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); if (files.length) void read(files); event.target.value = '' }} />
    </label>
    {note ? <output>{note}</output> : null}
    {error ? <p role="alert">{error}</p> : null}
    {text.trim() && !busy ? <div className="flex flex-col gap-3"><h2 className="font-semibold">اختر التخصص أو المنتج للبحث عن مشترين</h2>{text.split('\n').map(line => line.trim()).filter(Boolean).map((line, i) => <button key={i} type="button" onClick={() => { handoff.set(HANDOFF.targetDirection, 'marketing'); handoff.set(HANDOFF.targetQuery, line.slice(0, 120)); navigate('targeting') }} className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 text-start">{line}</button>)}</div> : null}
    <p className="text-sm text-[var(--color-text-secondary)]">هذه خطوة اكتشاف؛ لا تنشئ طلب شراء ولا ترسل رسائل للجهات.</p>
  </section>
}
