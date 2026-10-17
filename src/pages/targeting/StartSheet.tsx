import { useEffect, useRef, useState } from 'react'
import { suggestSpecialties, TargetingError, type SpecialtySuggestion } from '../../api/targetingClient'
import { readBooklet } from '../../lib/readBooklet'
import { Button, Chip, Icon, IconFrom, PricingRequestsIcon, SearchIcon, SpecialtiesIcon, UploadBookletIcon, UploadCatalogIcon, WriteProductsIcon, type IconSource } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'

/*
 * «طلب جديد» on خريطة الفرص — the one place to start. Every start lands in the same search → filters → map:
 *   · a booklet or purchase request (the page's own «ارفع كراسة» reader),
 *   · what I sell: a catalog file (same reader: PDF, Excel, photo) or typed products → POST /suggest-specialties →
 *     confirm the chips → one buyer («مشترون — أبي أبيع») search line per specialty,
 *   · a free search.
 * The buyer price-request wizard (/new) is a different flow (it creates and sends an RFQ); it is linked from here.
 */

type Props = {
  mobile: boolean
  onClose: () => void
  onBooklet: () => void
  onFreeSearch: () => void
  /** confirmed specialties; files = names of the catalog files read (none when typed) */
  onSellLines: (names: string[], files: string[]) => void
  onRfq?: () => void
}

function Row({ icon, title, hint, onClick }: { icon: IconSource; title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`fi-host flex w-full items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3.5 text-start hover:border-[var(--color-border-strong)] ${FOCUS_RING}`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-surface-2)]"><IconFrom icon={icon} size={20} /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[16px] leading-[26px] font-medium">{title}</span>
        <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{hint}</span>
      </span>
      <Icon name="chevron-back" size={18} className="shrink-0 text-[var(--color-icon-secondary)]" />
    </button>
  )
}

export default function StartSheet({ mobile, onClose, onBooklet, onFreeSearch, onSellLines, onRfq }: Props) {
  const [step, setStep] = useState<'pick' | 'sell'>('pick')
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy')
  const [text, setText] = useState('')
  const [reading, setReading] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SpecialtySuggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [read, setRead] = useState<string[]>([])
  const file = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => { panel.current?.querySelector<HTMLElement>('button, textarea')?.focus() }, [step])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const keyOf = (s: SpecialtySuggestion) => String(s.specialty_id)
  async function suggest() {
    if (!text.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const r = await suggestSpecialties(text.trim().slice(0, 4000))
      const list = r?.suggestions || []
      setSuggestions(list); setPicked(new Set(list.map(keyOf)))
      if (!list.length) setError('ما طلع لنا تخصص واضح. اكتب منتجاتك بكلمات أوضح.')
    } catch (e) {
      setError(e instanceof TargetingError ? e.message : 'تعذّر اقتراح التخصصات.')
    } finally { setBusy(false) }
  }
  async function onCatalog(files: File[]) {
    if (!files.length) return
    setError(null); setReading('نقرأ الكتالوج…')
    try {
      const lines = await readBooklet(files, setReading)
      if (!lines.length) throw new Error('ما لقينا منتجات في الملف. اكتبها بنفسك تحت.')
      setText((t) => [t.trim(), ...lines.map((l) => l.name)].filter(Boolean).join('\n'))
      setRead((cur) => [...cur, ...files.map((f) => f.name)])
      setSuggestions(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّرت قراءة الملف.')
    } finally { setReading(null); if (file.current) file.current.value = '' }
  }
  const chosen = (suggestions || []).filter((s) => picked.has(keyOf(s)))

  return (
    <div className={`fixed inset-0 z-50 flex bg-[var(--color-bg-inverse)]/40 ${mobile ? 'items-end' : 'items-center justify-center p-6'}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="start-title"
        className={`flex max-h-[90dvh] flex-col gap-4 overflow-y-auto bg-[var(--color-bg-surface)] p-5 shadow-[var(--elevation-lg)] ${mobile ? 'w-full rounded-t-[var(--radius-xl)] pb-8' : 'w-[560px] rounded-[var(--radius-xl)]'}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 id="start-title" className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">{step === 'pick' ? 'طلب جديد' : 'وش تبيع؟'}</h2>
          <button type="button" aria-label="إغلاق" onClick={onClose} className={`rounded-full p-1 ${FOCUS_RING}`}><Icon name="x" size={20} /></button>
        </div>
        {step === 'pick' ? (
          <>
            <div role="group" aria-label="اتجاه البحث" className="relative isolate grid grid-cols-2 rounded-full bg-[var(--color-bg-surface-2)]/90 p-1 backdrop-blur-md">
              <span aria-hidden className={`pointer-events-none absolute inset-y-1 start-1 w-[calc(50%-4px)] rounded-full bg-[var(--color-bg-surface)] shadow-[var(--farq-button-shadow)] transition-transform duration-300 motion-reduce:transition-none ${direction === 'sell' ? '-translate-x-full' : ''}`} />
              <button type="button" aria-pressed={direction === 'buy'} onClick={() => setDirection('buy')}
                className={`relative z-10 min-h-11 rounded-full px-3 py-2 text-[14px] font-semibold transition-colors ${direction === 'buy' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'} ${FOCUS_RING}`}>
                أبحث عن مورد
              </button>
              <button type="button" aria-pressed={direction === 'sell'} onClick={() => setDirection('sell')}
                className={`relative z-10 min-h-11 rounded-full px-3 py-2 text-[14px] font-semibold transition-colors ${direction === 'sell' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'} ${FOCUS_RING}`}>
                أبحث عن مشتري
              </button>
            </div>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{direction === 'buy' ? 'ابحث عن الموردين من احتياجك أو من كراسة الشروط.' : 'اعرض منتجاتك على المشترين المناسبين من خلال الكتالوج أو وصف المنتجات.'}</p>
            <div className="flex flex-col gap-2">
              {direction === 'buy' ? <>
                <Row icon={UploadBookletIcon} title="كراسة أو طلب شراء" hint="ارفع الملف ونطلع بنوده، وتبحث عن بائعين لكل بند" onClick={onBooklet} />
                <Row icon={SearchIcon} title="بحث حر عن مورد" hint="اكتب المنتج أو المادة التي تبحث عنها" onClick={onFreeSearch} />
              </> : (
                <Row icon={UploadCatalogIcon} title="أضف منتجاتك" hint="ارفع كتالوجك أو اكتب منتجاتك لنقترح تخصصات المشترين" onClick={() => setStep('sell')} />
              )}
            </div>
            {direction === 'buy' && onRfq ? (
              <button type="button" onClick={onRfq} className={`flex items-center gap-2 self-start text-[14px] leading-[22px] font-medium text-[var(--color-text-link)] hover:underline ${FOCUS_RING}`}>
                <PricingRequestsIcon size={16} />طلب تسعير من الموردين
                <span className="font-normal text-[var(--color-text-tertiary)]">· بنود وتوصيل وإرسال للموردين</span>
              </button>
            ) : null}
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[14px] leading-[22px] text-[var(--color-text-secondary)]"><WriteProductsIcon size={16} />اكتب منتجاتك، سطر لكل منتج، أو ارفع الكتالوج</span>
              <textarea value={text} onChange={(e) => { setText(e.target.value); setSuggestions(null) }} rows={5} maxLength={4000} placeholder={'مثال:\nحدايد وبويات\nبلاط وسيراميك\nقطع غيار كوري وصيني\nمواسير PPR جملة وقطاعي'}
                className={`w-full resize-none rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-[16px] leading-[26px] placeholder:text-[var(--color-text-tertiary)] ${FOCUS_RING}`} />
            </label>
            <input ref={file} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden
              accept=".pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*"
              onChange={(e) => void onCatalog([...(e.target.files || [])])} />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="Secondary" size="S" icon={UploadCatalogIcon} disabled={Boolean(reading)} loading={Boolean(reading)} loadingLabel="نقرأ…" onClick={() => file.current?.click()}>ارفع الكتالوج</Button>
              <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">PDF أو Excel أو صورة</span>
            </div>
            {reading ? <p role="status" className="text-[14px] text-[var(--color-text-secondary)]">{reading}</p> : null}
            {error ? <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">{error}</p> : null}
            {suggestions?.length ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-1.5 text-[14px] leading-[22px] font-medium"><SpecialtiesIcon size={16} />تخصصاتك — شِل اللي ما يناسب</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <Chip key={keyOf(s)} label={s.specialty_ar} selected={picked.has(keyOf(s))}
                      onClick={() => setPicked((cur) => { const x = new Set(cur); if (x.has(keyOf(s))) x.delete(keyOf(s)); else x.add(keyOf(s)); return x })} />
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <Button variant="Ghost" size="S" onClick={() => setStep('pick')}>رجوع</Button>
              {suggestions?.length ? (
                <Button variant="Primary" size="M" disabled={!chosen.length} onClick={() => onSellLines(chosen.map((s) => s.specialty_ar), read)}>ابحث عن مشترين ({chosen.length})</Button>
              ) : (
                <Button variant="Primary" size="M" disabled={!text.trim() || busy} loading={busy} loadingLabel="نقترح…" onClick={() => void suggest()}>اقترح التخصصات</Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
