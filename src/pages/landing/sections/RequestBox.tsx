import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon, type IconName } from '../../../ui/Icon'
import { cx, FOCUS_RING } from '../../../ui/cx'
import { saveLandingDraft } from '../../../lib/landingDraft'
import { T } from '../kit'
import Shayeb, { type ShayebMood } from './Shayeb'

/*
 * The hero request (owner brief §3–4). The visitor writes what the company needs; nothing is sent from this page.
 *   1. POST /_demo/understand → «هذا اللي فهمناه»: item · quantity · city · use, and at most one question that
 *      changes the price (plus the quantity question when the number can be read two ways).
 *   2. POST /_demo/search (real targeting data) → how many suppliers in that city can be reached — totals only,
 *      never a name or a number.
 *   3. «كمّل الطلب»: the request is saved in this browser; signing in opens «طلب جديد» with it filled in
 *      (src/lib/landingDraft). Without an account: the same request, ready, on WhatsApp.
 * ارفع ملف / أرفق صورة: reading files needs a Farq account — the modes say so and offer sign-in or WhatsApp.
 */

const WA = '966510197017'
const waHref = (text: string) => `https://wa.me/${WA}?text=${encodeURIComponent(text)}`
const EXAMPLES = [
  'أبي 20 كرسي انتظار لعيادة بالرياض',
  'نحتاج 5000 علبة تغليف لمطعم',
  'أبي 30 جهاز كمبيوتر لموظفي الشركة',
  'نحتاج تجهيزات نظافة لـ 12 فرع',
  'أبي معدات مطبخ لمطعم جديد',
]
const FALLBACK_CITIES = [{ en: 'Riyadh', ar: 'الرياض' }, { en: 'Jeddah', ar: 'جدة' }, { en: 'Dammam', ar: 'الدمام' }, { en: 'Makkah Al Mukarramah', ar: 'مكة المكرمة' }, { en: 'Al Madinah Al Munawwarah', ar: 'المدينة المنورة' }]
const n = (v: number) => v.toLocaleString('en-US')

type City = { en: string; ar: string | null }
type Understood = { ok: boolean; error?: string; q: string; item: string; quantity: number | null; unit: string | null; city: string | null; city_en: string | null; use: string | null; quantity_note: string | null; question: { text: string; options: string[] } | null }
type Reach = { ok: boolean; total: number; with_whatsapp: number }
type Mode = 'write' | 'file' | 'photo'
const MODES: { id: Mode; label: string; icon: IconName }[] = [
  { id: 'write', label: 'اكتب طلبك', icon: 'edit' },
  { id: 'file', label: 'ارفع ملف', icon: 'upload' },
  { id: 'photo', label: 'أرفق صورة', icon: 'camera' },
]

let citiesCache: Promise<City[]> | null = null
const loadCities = () => (citiesCache ??= fetch('/_demo/cities').then((r) => (r.ok ? r.json() : FALLBACK_CITIES)).then((d) => (Array.isArray(d) && d.length ? d : FALLBACK_CITIES)).catch(() => FALLBACK_CITIES))

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (r.status === 429) throw new Error('جرّبت كثير اليوم. كمّل طلبك معنا على واتساب، أو جرّب بكرة.')
  const d = (await r.json().catch(() => null)) as T & { ok?: boolean; error?: string }
  if (!r.ok || !d || d.ok === false) throw new Error(d?.error === 'QUERY_SHORT' ? 'اكتب طلبك بكلمتين على الأقل.' : 'ما قدرنا نكمّل الحين. جرّب بعد شوي.')
  return d
}

export default function RequestBox() {
  const [mode, setMode] = useState<Mode>('write')
  const [q, setQ] = useState('')
  const [ex, setEx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [u, setU] = useState<Understood | null>(null)
  const [cities, setCities] = useState<City[]>(FALLBACK_CITIES)
  const [city, setCity] = useState<string>('')
  const [qtyAnswer, setQtyAnswer] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [reach, setReach] = useState<Reach | null>(null)
  const [saved, setSaved] = useState(false)
  const [mood, setMood] = useState<ShayebMood>('idle')
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { void loadCities().then(setCities) }, [])
  // rotating examples in the placeholder (stops while the visitor types)
  useEffect(() => {
    if (q || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setInterval(() => setEx((i) => (i + 1) % EXAMPLES.length), 3200)
    return () => window.clearInterval(t)
  }, [q])
  // «ابدأ طلب تسعير» elsewhere on the page focuses this box
  useEffect(() => {
    const on = () => { setMode('write'); input.current?.focus({ preventScroll: true }) }
    window.addEventListener('farq-start', on)
    return () => window.removeEventListener('farq-start', on)
  }, [])

  const cityAr = (en: string) => cities.find((c) => c.en === en)?.ar || en
  const reset = () => { setU(null); setReach(null); setAnswer(null); setQtyAnswer(null); setSaved(false); setError(null) }

  async function understand(e?: FormEvent) {
    e?.preventDefault()
    const text = q.trim()
    if (text.length < 3 || busy) return
    reset(); setBusy(true); setMood('working')
    try {
      const d = await post<Understood>('/_demo/understand', { q: text })
      setU(d)
      const c = d.city_en || ''
      setCity(c)
      if (c) void checkReach(d.item || text, c)
      setMood('found')
    } catch (err) { setError(err instanceof Error ? err.message : 'ما قدرنا نكمّل الحين.'); setMood('idle') }
    finally { setBusy(false) }
  }
  async function checkReach(item: string, c: string) {
    setReach(null)
    try { setReach(await post<Reach>('/_demo/search', { q: item, city: c })) } catch { setReach(null) }
  }

  const needQty = Boolean(u?.quantity_note) && !qtyAnswer
  const needCity = Boolean(u) && !city
  const needAnswer = Boolean(u?.question) && !answer
  const ready = Boolean(u) && !needQty && !needCity && !needAnswer
  const summary = u ? [
    `المنتج: ${u.item}`, u.quantity ? `الكمية: ${u.quantity}${u.unit ? ` ${u.unit}` : ''}${qtyAnswer ? ` (${qtyAnswer})` : ''}` : null,
    city ? `المدينة: ${cityAr(city)}` : null, u.use ? `الاستخدام: ${u.use}` : null, answer && !answer.includes('ما يفرق') ? `التفاصيل: ${answer}` : null,
  ].filter(Boolean).join('\n') : ''

  function keep() {
    if (!u) return
    saveLandingDraft({ text: u.q, item: u.item, qty: u.quantity ? String(u.quantity) : '', unit: u.unit || '', city: city ? cityAr(city) : null, use: u.use, answer: [answer, qtyAnswer].filter(Boolean).join(' · ') || null })
    setSaved(true)
  }

  const chip = (active: boolean) => cx('rounded-[var(--radius-full)] border px-[var(--space-12)] py-[6px] text-[14px] leading-[22px] transition-colors', active ? 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-text-primary)]' : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]', FOCUS_RING)

  return (
    <div className="relative w-full">
      {mode === 'write' ? (
        <form onSubmit={understand} aria-label="طلب تسعير"
          className="relative flex flex-col gap-[var(--space-12)] rounded-[var(--radius-xl)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] p-[var(--space-12)] shadow-[var(--elevation-lg)] focus-within:border-[var(--color-border-primary)] focus-within:shadow-[var(--glow-primary)] sm:p-[var(--space-16)]">
          <label htmlFor="ld-request" className="sr-only">وش تحتاج نسعّر لشركتك؟</label>
          <textarea id="ld-request" ref={input} rows={2} value={q} maxLength={160}
            onChange={(e) => { setQ(e.target.value); setMood('ready'); if (u) reset() }}
            onFocus={() => setMood((m) => (m === 'idle' ? 'ready' : m))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void understand() } }}
            placeholder={`وش تحتاج نسعّر لشركتك؟ مثلًا: ${EXAMPLES[ex]}`}
            className="w-full resize-none bg-transparent px-[var(--space-4)] text-[18px] leading-[30px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] sm:text-[20px] sm:leading-[32px]" />
          <div className="flex flex-col-reverse gap-[var(--space-12)] sm:flex-row sm:items-center sm:justify-between">
            <ModeChips mode={mode} setMode={setMode} chip={chip} />
            <button type="submit" disabled={busy || q.trim().length < 3}
              className={cx('inline-flex h-12 items-center justify-center gap-[var(--space-8)] rounded-[var(--radius-md)] bg-[var(--color-bg-brand)] px-[var(--space-24)] text-[16px] font-semibold text-[var(--color-text-on-brand)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--glow-primary)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none motion-reduce:transition-none', FOCUS_RING)}>
              {busy ? <span aria-hidden className="ui-spin inline-block size-4 rounded-full border-2 border-current border-e-transparent" /> : <Icon name="bolt" size={18} />}
              {busy ? 'نفهم طلبك…' : 'خلّ فرق يسعّر لي'}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-[var(--space-12)] rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] p-[var(--space-16)] sm:p-[var(--space-24)]">
          <p className={T.bodyM}>{mode === 'file' ? 'ارفع قائمة المشتريات أو عرض سابق (PDF أو Excel) ونطلّع البنود منه.' : 'صوّر الطلب أو المنتج اللي تبي مثله، ونقرأ البنود منه.'}</p>
          <p className={cx(T.small, 'text-[var(--color-text-secondary)]')}>قراءة الملفات تكون داخل حسابك في فرق. سجّل دخولك، أو أرسله لنا واتساب ونرجع لك بالبنود.</p>
          <div className="flex flex-wrap gap-[var(--space-8)]">
            <a href="/new" className={cx('inline-flex h-11 items-center gap-[var(--space-8)] rounded-[var(--radius-md)] bg-[var(--color-bg-brand)] px-[var(--space-16)] text-[15px] font-semibold text-[var(--color-text-on-brand)]', FOCUS_RING)}><Icon name={mode === 'file' ? 'upload' : 'camera'} size={18} />سجّل دخول وارفع</a>
            <a href={waHref(mode === 'file' ? 'هلا، أبي أرسل لكم ملف مشتريات نسعّره' : 'هلا، أبي أرسل لكم صورة طلب نسعّره')} target="_blank" rel="noopener noreferrer" className={cx('inline-flex h-11 items-center gap-[var(--space-8)] rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-[var(--space-16)] text-[15px] font-medium', FOCUS_RING)}><Icon name="whatsapp" size={18} />أرسله واتساب</a>
          </div>
          <ModeChips mode={mode} setMode={setMode} chip={chip} />
        </div>
      )}

      {mode === 'write' ? (
        <div className="mt-[var(--space-16)] flex flex-col items-start gap-[var(--space-8)] sm:flex-row sm:gap-[var(--space-12)]">
          <Shayeb mood={mood} height={u ? 72 : 96} />
          <div aria-live="polite" className="min-w-0 flex-1">
            {busy ? <p className={cx(T.bodyM, 'sm:pt-[var(--space-24)] text-[var(--color-text-secondary)]')}>لحظة، نقرأ طلبك…</p> : null}
            {error ? <p role="alert" className={cx(T.small, 'rounded-[var(--radius-md)] bg-[var(--color-bg-warning)] px-[var(--space-12)] py-[var(--space-8)] text-[var(--color-text-warning)]')}>{error}</p> : null}
            {u ? (
              <section aria-label="هذا اللي فهمناه" className="ld-pop flex flex-col gap-[var(--space-12)] rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-[var(--space-16)] shadow-[var(--elevation-md)]">
                <p className={cx(T.smallM, 'text-[var(--ld-accent-light)]')}>هذا اللي فهمناه</p>
                <dl className="grid grid-cols-2 gap-x-[var(--space-16)] gap-y-[var(--space-8)] text-[15px] leading-[24px]">
                  <Fact k="المنتج" v={u.item} />
                  <Fact k="الكمية" v={u.quantity ? `${n(u.quantity)}${u.unit ? ` ${u.unit}` : ''}` : 'ما ذكرتها'} />
                  <Fact k="المدينة" v={city ? cityAr(city) : 'اختر المدينة'} />
                  <Fact k="الاستخدام" v={u.use || '—'} />
                </dl>
                {needCity ? (
                  <label className="flex flex-col gap-[var(--space-4)]">
                    <span className={T.smallM}>وين التوريد؟</span>
                    <select value={city} onChange={(e) => { setCity(e.target.value); void checkReach(u.item, e.target.value) }} className={cx('h-11 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface-2)] px-[var(--space-12)]', FOCUS_RING)}>
                      <option value="" disabled>اختر المدينة</option>
                      {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
                    </select>
                  </label>
                ) : null}
                {u.quantity_note ? <Ask text={u.quantity_note} options={['للكل', 'لكل واحد']} value={qtyAnswer} onPick={setQtyAnswer} chip={chip} /> : null}
                {u.question ? <Ask text={u.question.text} options={u.question.options} value={answer} onPick={setAnswer} chip={chip} /> : null}
                {reach && reach.total ? (
                  <p className={cx(T.small, 'flex items-center gap-[var(--space-8)] text-[var(--color-text-secondary)]')}>
                    <Icon name="users" size={16} className="text-[var(--color-icon-primary)]" />
                    في {cityAr(city)} عندنا <strong className="text-[var(--color-text-primary)]">{n(reach.total)}</strong> جهة لهالنوع{reach.with_whatsapp ? <>، منها {n(reach.with_whatsapp)} نقدر نراسلها واتساب</> : null}.
                  </p>
                ) : null}
                {!saved ? (
                  <button type="button" disabled={!ready} onClick={keep}
                    className={cx('inline-flex h-12 items-center justify-center gap-[var(--space-8)] rounded-[var(--radius-md)] bg-[var(--color-bg-brand)] px-[var(--space-24)] text-[16px] font-semibold text-[var(--color-text-on-brand)] disabled:opacity-40', FOCUS_RING)}>
                    {ready ? 'كمّل الطلب' : 'جاوب على السؤال فوق'}<Icon name="arrow-forward" size={18} />
                  </button>
                ) : (
                  <div className="flex flex-col gap-[var(--space-8)] rounded-[var(--radius-md)] bg-[var(--color-bg-primary-subtle)] p-[var(--space-12)]">
                    <p className={T.smallM}>حفظنا طلبك في هذا الجهاز. ما راح يروح لأي مورد قبل ما تراجعه وتأكد.</p>
                    <div className="flex flex-wrap gap-[var(--space-8)]">
                      <a href="/new" className={cx('inline-flex h-11 items-center gap-[var(--space-8)] rounded-[var(--radius-md)] bg-[var(--color-bg-brand)] px-[var(--space-16)] text-[15px] font-semibold text-[var(--color-text-on-brand)]', FOCUS_RING)}>سجّل دخول وكمّل الطلب</a>
                      <a href={waHref(`هلا، أبي فرق يسعّر لي:\n${summary}`)} target="_blank" rel="noopener noreferrer" className={cx('inline-flex h-11 items-center gap-[var(--space-8)] rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-[var(--space-16)] text-[15px] font-medium', FOCUS_RING)}><Icon name="whatsapp" size={18} />ما عندي حساب — أرسله واتساب</a>
                    </div>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ModeChips({ mode, setMode, chip }: { mode: Mode; setMode: (m: Mode) => void; chip: (a: boolean) => string }) {
  return (
    <div role="group" aria-label="طريقة الطلب" className="flex flex-wrap gap-[var(--space-8)]">
      {MODES.map((m) => (
        <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={cx(chip(mode === m.id), 'inline-flex items-center gap-[6px]')}>
          <Icon name={m.icon} size={16} />{m.label}
        </button>
      ))}
    </div>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{k}</dt>
      <dd className="truncate font-medium">{v}</dd>
    </div>
  )
}

function Ask({ text, options, value, onPick, chip }: { text: string; options: string[]; value: string | null; onPick: (v: string) => void; chip: (a: boolean) => string }) {
  return (
    <fieldset className="flex flex-col gap-[var(--space-8)]">
      <legend className={cx(T.smallM, 'mb-[var(--space-8)]')}>{text}</legend>
      <div className="flex flex-wrap gap-[var(--space-8)]">
        {options.map((o) => <button key={o} type="button" aria-pressed={value === o} onClick={() => onPick(o)} className={chip(value === o)}>{o}</button>)}
      </div>
    </fieldset>
  )
}
