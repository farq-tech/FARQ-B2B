import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { FOCUS_RING, cx } from '../../ui/cx'
import { WHATSAPP_HREF } from './contact'

type City = { en: string; ar: string }
type Supplier = { name: string; category: string; district: string; match: 'product' | 'seller'; fit: 'L' | 'M' | null }
type Result = { suppliers: Supplier[]; additional: number; directoryMatches: number; screenedOut: number }
const field = cx('w-full rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-[var(--color-text-primary)]', FOCUS_RING)

export default function Trial({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null)
  const [cities, setCities] = useState<City[]>([]), [city, setCity] = useState(''), [item, setItem] = useState('')
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  useEffect(() => {
    const c = new AbortController(); dialog.current?.showModal()
    void fetch('/_trial/cities', { signal: c.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<City[]> }).then(data => { setCities(data); setCity(data.find(c => c.en === 'Riyadh')?.en || data[0]?.en || '') }).catch(() => { if (!c.signal.aborted) setError('تعذّر تحميل البحث الآن. حاول مجددًا أو تواصل معنا.') }).finally(() => { if (!c.signal.aborted) setLoading(false) })
    return () => { c.abort(); controller.current?.abort(); dialog.current?.close() }
  }, [])
  async function search() {
    if (busy || !city || item.trim().length < 3) return
    if (/[\n\r;؛]/.test(item)) { setError('التجربة لبند واحد. اكتب منتجًا أو احتياجًا واحدًا.'); return }
    const c = new AbortController(); controller.current = c; setBusy(true); setError(''); setResult(null)
    const timer = window.setTimeout(() => c.abort(), 105000)
    try {
      const r = await fetch('/_trial/search', { method: 'POST', signal: c.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: item.trim(), city }) })
      if (!r.ok) throw new Error(r.status === 429 ? 'وصلت لحد البحث في التجربة. حاول لاحقًا.' : r.status === 400 ? 'راجع البند والمدينة، ثم جرّب مجددًا.' : 'تعذّر البحث الآن. حاول مجددًا أو تواصل معنا.')
      const data = await r.json() as Result; setResult(data)
    } catch (e) { if (dialog.current?.open) setError(c.signal.aborted ? 'استغرق البحث وقتًا أطول من المتوقع. حاول مجددًا.' : e instanceof Error ? e.message : 'تعذّر البحث.') }
    finally { clearTimeout(timer); if (dialog.current?.open) setBusy(false) }
  }
  return <dialog ref={dialog} dir="rtl" lang="ar" onCancel={e => { e.preventDefault(); onClose() }} className="m-auto max-h-[90dvh] w-[min(760px,calc(100vw-24px))] overflow-y-auto rounded-3xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5 text-[var(--color-text-primary)] shadow-xl backdrop:bg-[color-mix(in_srgb,var(--color-bg-inverse)_48%,transparent)] sm:p-8" aria-labelledby="trial-title">
    <div className="mb-5 flex items-start justify-between gap-4"><div><p className="mb-2 text-sm text-[var(--color-text-secondary)]">جرّب فرق تسعير على احتياجك</p><h2 id="trial-title" className="font-display text-2xl font-semibold">بند واحد. دائرة موردين أوسع.</h2></div><button type="button" onClick={onClose} className={cx('rounded-lg px-3 py-2', FOCUS_RING)} aria-label="إغلاق تجربة البحث">✕</button></div>
    <p className="mb-5 text-sm leading-6 text-[var(--color-text-secondary)]">ابحث عن احتياج منشأتك، من القهوة إلى المعدات. نقترح لك حتى 10 موردين أقرب لطلبك. تقدر تعتمد على قائمة مورديك الحالية وتستخدم فرق لتوسيع خياراتك.</p>
    <form onSubmit={e => { e.preventDefault(); void search() }} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm font-medium">وش تحتاج منشأتك؟<input autoFocus required minLength={3} maxLength={120} value={item} disabled={busy} onChange={e => { setItem(e.target.value); setResult(null) }} placeholder="مثل: كرسي انتظار للعيادة، أو حبوب قهوة للمكتب" className={field} /></label>
      <label className="flex flex-col gap-2 text-sm font-medium">المدينة<select required value={city} disabled={busy || loading} onChange={e => { setCity(e.target.value); setResult(null) }} className={field}><option value="">{loading ? 'جارٍ تحميل المدن…' : 'اختر المدينة'}</option>{cities.map(c => <option key={c.en} value={c.en}>{c.ar}</option>)}</select></label>
      <Button type="submit" variant="Primary" disabled={busy || loading || !city || item.trim().length < 3}>{busy ? 'نبحث في دليل الموردين…' : 'ابحث عن الموردين'}</Button>
    </form>
    <p className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">بحث فقط؛ لا يُنشئ طلب شراء ولا يرسل أي رسالة للموردين.</p>
    {error && <p role="alert" className="mt-4 rounded-xl border border-[var(--color-border-default)] p-4 text-sm">{error} <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className={cx('underline', FOCUS_RING)}>تواصل معنا</a></p>}
    <div aria-live="polite" aria-busy={busy}>
      {result && <section className="mt-6" aria-labelledby="trial-results"><h3 id="trial-results" className="mb-2 font-display text-lg font-semibold">{result.suppliers.length ? 'موردون نقترحهم لاحتياجك' : 'ما لقينا ترشيحًا مناسبًا بهذا الوصف'}</h3><p className="mb-4 text-sm text-[var(--color-text-secondary)]">{result.suppliers.length ? `نعرض ${result.suppliers.length} من الموردين المقترحين لك.` : 'جرّب اسم المنتج ومواصفاته بشكل أوضح، أو غيّر المدينة. ما نضيف أسماء افتراضية للنتائج.'}</p>
        <ol className="grid gap-3 sm:grid-cols-2">{result.suppliers.map((s, i) => <li key={`${s.name}-${i}`} className="rounded-2xl border border-[var(--color-border-default)] p-4"><span className="text-xs text-[var(--color-text-secondary)]">مرشح {i + 1} · {s.match === 'product' ? 'مرتبط بالمنتج' : 'مرتبط بالنشاط'}</span><h4 className="mt-2 font-semibold">{s.name}</h4><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{s.category}</p>{s.district && <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{s.district}</p>}</li>)}</ol>
        {result.additional > 0 && <div className="mt-4 rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] p-4"><p className="font-semibold">{result.additional.toLocaleString('ar-SA')} نتيجة إضافية في الدليل</p><p className="mt-1 text-sm text-[var(--color-text-secondary)]">بياناتها محجوبة في التجربة.</p><div aria-hidden="true" className="mt-4 grid gap-3 sm:grid-cols-2">{Array.from({ length: Math.min(4, result.additional) }, (_, i) => <div key={i} className="rounded-xl bg-[var(--color-bg-surface)] p-4"><div className="h-3 w-2/3 rounded-full bg-[var(--color-border-default)] blur-[3px]" /><div className="mt-3 h-2 w-1/2 rounded-full bg-[var(--color-border-default)] blur-[3px]" /></div>)}</div><a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className={cx('mt-4 inline-block underline', FOCUS_RING)}>تواصل معنا لتوسيع البحث</a></div>}
      </section>}
    </div>
  </dialog>
}
