import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { FOCUS_RING, cx } from '../../ui/cx'
import { WHATSAPP_HREF } from './contact'
import { GOALS, useLandingGoal } from './GoalStart'

type City = { en: string; ar: string }
type Supplier = { name: string; category: string; district: string; match: 'product' | 'seller'; fit: 'L' | 'M' | null; reason?: string }
type Result = { suppliers: Supplier[]; additional: number; directoryMatches: number; screenedOut: number; intent?: string }
const field = cx('w-full rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-[var(--color-text-primary)]', FOCUS_RING)

export default function Trial({ onClose }: { onClose: () => void }) {
  const { goal } = useLandingGoal()
  const marketing = goal === 'marketing'
  const dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null)
  const [cities, setCities] = useState<City[]>([]), [city, setCity] = useState(''), [item, setItem] = useState('')
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const c = new AbortController(); dialog.current?.showModal()
    void fetch('/_trial/cities', { signal: c.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<City[]> }).then(data => { setCities(data); setCity(data.find(c => c.en === 'Riyadh')?.en || data[0]?.en || '') }).catch(() => { if (!c.signal.aborted) setError('تعذّر تحميل البحث الآن. حاول مجددًا أو تواصل معنا.') }).finally(() => { if (!c.signal.aborted) setLoading(false) })
    return () => { c.abort(); controller.current?.abort(); dialog.current?.close(); if (previous?.isConnected) previous.focus() }
  }, [marketing])
  useEffect(() => { if (result) document.getElementById('trial-results')?.focus() }, [result])
  async function search() {
    if (busy || !city || item.trim().length < 3) return
    if (/[\n\r;؛]/.test(item)) { setError('التجربة لبند واحد. اكتب منتجًا أو احتياجًا واحدًا.'); return }
    const c = new AbortController(); controller.current = c; setBusy(true); setError(''); setResult(null)
    const timer = window.setTimeout(() => c.abort(), 15000)
    try {
      const r = await fetch('/_trial/search', { method: 'POST', signal: c.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: item.trim(), city, objective: marketing ? 'marketing' : 'purchase' }) })
      if (!r.ok) throw new Error(r.status === 429 ? 'وصلت لحد البحث في التجربة. حاول لاحقًا.' : r.status === 400 ? 'راجع البند والمدينة، ثم جرّب مجددًا.' : 'تعذّر البحث الآن. حاول مجددًا أو تواصل معنا.')
      const data = await r.json() as Result; if (!c.signal.aborted) setResult(data)
    } catch (e) { if (dialog.current?.open && controller.current === c) setError(c.signal.aborted ? 'استغرق البحث وقتًا أطول من المتوقع. حاول مجددًا.' : e instanceof Error ? e.message : 'تعذّر البحث.') }
    finally { clearTimeout(timer); if (dialog.current?.open && controller.current === c) setBusy(false) }
  }
  return <dialog ref={dialog} dir="rtl" lang="ar" onCancel={e => { e.preventDefault(); onClose() }} className="m-auto max-h-[90dvh] w-[min(760px,calc(100vw-24px))] overflow-y-auto rounded-3xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5 text-[var(--color-text-primary)] shadow-xl backdrop:bg-[color-mix(in_srgb,var(--color-bg-inverse)_48%,transparent)] sm:p-8" aria-labelledby="trial-title">
    <div className="mb-5 flex items-start justify-between gap-4"><div><p className="mb-2 text-sm text-[var(--color-text-secondary)]">جرّب فرق على هدف منشأتك</p><h2 id="trial-title" className="font-display text-2xl font-semibold">{goal ? GOALS[goal].action : GOALS.pricing.action}</h2></div><button type="button" onClick={onClose} className={cx('rounded-lg px-3 py-2', FOCUS_RING)} aria-label="إغلاق تجربة البحث">✕</button></div>
    <>
    {!result && <>
    <p className="mb-5 text-sm leading-6 text-[var(--color-text-secondary)]">{marketing ? 'اكتب المنتج أو الخدمة اللي تبيعها. نقترح جهات قد تستفيد منها بحسب نشاطها في الدليل، وليس بناءً على طلب شراء معلن.' : 'اكتب المنتج أو الخدمة اللي تحتاجها. نقترح بائعين مرتبطين بطلبك. تقدر تعتمد على قائمتك الحالية وتستخدم فرق لتوسيع خياراتك.'}</p>
    <div className="mb-4 flex flex-wrap items-center gap-2"><span className="text-xs text-[var(--color-text-secondary)]">جرّب احتياجًا:</span>{(marketing ? ['خدمات موارد بشرية', 'أدوية طبية تجميلية', 'أكواب ورق أو بلاستيك'] : ['حبوب قهوة للمكتب', 'كرسي انتظار للعيادة', 'مواد غذائية للمطعم']).map(example => <button key={example} type="button" disabled={busy} onClick={() => { setItem(example); setResult(null); setError(''); dialog.current?.querySelector('input')?.focus() }} className={cx('rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-xs', FOCUS_RING)}>{example}</button>)}</div>
    <form onSubmit={e => { e.preventDefault(); void search() }} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm font-medium">{marketing ? 'وش المنتج أو الخدمة اللي تبيعها؟' : 'وش تحتاج منشأتك؟'}<input autoFocus required minLength={3} maxLength={120} value={item} disabled={busy} onChange={e => { setItem(e.target.value); setResult(null) }} placeholder={marketing ? 'مثل: خدمات موارد بشرية، أو أكواب ورقية' : 'مثل: كرسي انتظار للعيادة، أو حبوب قهوة للمكتب'} className={field} /></label>
      <label className="flex flex-col gap-2 text-sm font-medium">المدينة<select aria-label="المدينة" required value={city} disabled={busy || loading} onChange={e => { setCity(e.target.value); setResult(null) }} className={field}><option value="">{loading ? 'جارٍ تحميل المدن…' : 'اختر المدينة'}</option>{cities.map(c => <option key={c.en} value={c.en}>{c.ar}</option>)}</select></label>
      <Button type="submit" variant="Primary" disabled={busy || loading || !city || item.trim().length < 3}>{busy ? 'نبحث عن الجهات المناسبة…' : marketing ? 'ابحث عن مشترين' : 'ابحث عن بائعين'}</Button>
    </form>
    <p className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">بحث فقط؛ لا يُنشئ طلبًا ولا يرسل أي رسالة للجهات.</p>
    </>}
    {result && <button type="button" onClick={() => { setResult(null); setError('') }} className={cx('rounded-full border border-[var(--color-border-default)] px-3 py-2 text-sm', FOCUS_RING)}>تغيير الاحتياج أو المدينة</button>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-[var(--color-border-default)] p-4 text-sm">{error} <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className={cx('underline', FOCUS_RING)}>تواصل معنا</a></p>}
    <div aria-live="polite" aria-busy={busy}>
      {busy && <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-hidden="true">{[0, 1].map(i => <div key={i} className="rounded-2xl border border-[var(--color-border-default)] p-4 motion-safe:animate-pulse"><div className="h-3 w-2/3 rounded-full bg-[var(--color-border-default)]" /><div className="mt-4 h-2 w-1/2 rounded-full bg-[var(--color-border-default)]" /></div>)}</div>}
      {result && <section className="mt-6" aria-labelledby="trial-results"><h3 id="trial-results" tabIndex={-1} className="mb-2 font-display text-lg font-semibold">{result.suppliers.length ? marketing ? 'مشترون محتملون نقترحهم لمنتجك' : 'بائعون نقترحهم لاحتياجك' : 'ما لقينا ترشيحًا مناسبًا بهذا الوصف'}</h3><p className="mb-4 text-sm text-[var(--color-text-secondary)]">{result.suppliers.length ? `هذه ${result.suppliers.length.toLocaleString('ar-SA')} اقتراحات في ${cities.find(c => c.en === city)?.ar || city}${result.intent ? ` لاحتياجك: ${result.intent}` : ''}.` : 'جرّب اسم المنتج ومواصفاته بشكل أوضح، أو غيّر المدينة. '}</p>
        <ol className="grid gap-3 sm:grid-cols-2">{result.suppliers.map((s, i) => <li key={`${s.name}-${i}`} className="rounded-2xl border border-[var(--color-border-default)] p-4"><span className="text-xs text-[var(--color-text-secondary)]">مرشح {i + 1} · {marketing ? 'نشاط قد يستفيد من منتجك' : s.match === 'product' ? 'مرتبط بالمنتج' : 'مرتبط بالنشاط'}</span><h4 className="mt-2 font-semibold">{s.name}</h4><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{s.reason || s.category}</p>{s.district && <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{s.district}</p>}<a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.district} ${cities.find(c => c.en === city)?.ar || city}`)}`} target="_blank" rel="noopener noreferrer" aria-label={`ابحث عن ${s.name} على الخريطة`} className={cx('mt-3 inline-block rounded-md text-xs underline underline-offset-4', FOCUS_RING)}>ابحث عنه على الخريطة ↗</a></li>)}</ol>
        {result.additional > 0 && <div className="mt-4 rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] p-4"><p className="font-semibold">{result.additional.toLocaleString('ar-SA')} نتيجة إضافية في الدليل</p><p className="mt-1 text-sm text-[var(--color-text-secondary)]">هذه أول دائرة من الجهات المرتبطة بالبحث. تقدر تعتمد على قائمتك الحالية وتوسع خياراتك.</p><div aria-hidden="true" className="mt-4 grid gap-3 sm:grid-cols-2">{Array.from({ length: Math.min(4, result.additional) }, (_, i) => <div key={i} className="rounded-xl bg-[var(--color-bg-surface)] p-4"><div className="h-3 w-2/3 rounded-full bg-[var(--color-border-default)] blur-[3px]" /><div className="mt-3 h-2 w-1/2 rounded-full bg-[var(--color-border-default)] blur-[3px]" /></div>)}</div><a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className={cx('mt-4 inline-block underline', FOCUS_RING)}>فعّل حساب منشأتك ووسّع خياراتك</a></div>}
      </section>}
    </div>
    </>
  </dialog>
}
