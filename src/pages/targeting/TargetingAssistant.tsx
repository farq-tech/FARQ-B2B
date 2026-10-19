import { useState } from 'react'
import { Button, Icon } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'

type Plan = { target: string; purpose: string; prompt: string }
type Props = {
  city: string
  cityLabel: string
  onPrepare: (plan: Plan) => Promise<{ count: number; campaignId: string }>
  onOpenDraft?: () => void
  mobile: boolean
}

const purposeOf = (text: string) => {
  if (/طلبات|عرض سعر|مورد|شراء|مشتريات/.test(text)) return 'التعرّف على فرق ومقارنة خيارات الشراء'
  if (/زيارة|تجربة|اشتراك|تسجيل/.test(text)) return 'دعوة مناسبة للتعرّف على الخدمة'
  return 'التعرّف على فرق وبدء متابعة يدوية للمهتمين'
}

const targetOf = (text: string) => {
  const groups: Array<[RegExp, string]> = [
    [/مقاول|بناء|تشطيب|حديد|سباك|كهربائ/, 'شركات المقاولات والبناء والتشطيب'],
    [/مطعم|مقهى|كافيه|أغذية|تموين/, 'المطاعم والمقاهي ومنشآت الأغذية'],
    [/بقال|تجزئة|متجر|سوبر/, 'تجار التجزئة والبقالات'],
    [/مصنع|صناع/, 'المصانع والمنشآت الصناعية'],
    [/عياد|طبي|صحة/, 'العيادات والمنشآت الصحية'],
    [/عقار|مكتب عقار/, 'مكاتب وشركات العقار'],
  ]
  return groups.find(([pattern]) => pattern.test(text))?.[1] || text
    .replace(/(?:ابي|أبي|ابغى|أبغى|استهدف|استهداف|الشريحة|العملاء|المنشآت|الشركات|الغاية|الهدف|الحملة|واتساب|في الرياض|في جدة|في الدمام)/g, ' ')
    .replace(/\s+/g, ' ').trim() || 'منشآت أعمال مناسبة'
}

export default function TargetingAssistant({ city, cityLabel, onPrepare, onOpenDraft, mobile }: Props) {
  const [prompt, setPrompt] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [ready, setReady] = useState<{ count: number; campaignId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const understand = () => {
    const text = prompt.trim()
    if (!text) return
    setReady(null); setError(null)
    setPlan({ target: targetOf(text), purpose: purposeOf(text), prompt: text })
  }
  const prepare = async () => {
    if (!plan || preparing) return
    setPreparing(true); setError(null)
    try { setReady(await onPrepare(plan)) }
    catch { setError('تعذّر تجهيز المسودة الآن. حاول مرة ثانية.') }
    finally { setPreparing(false) }
  }

  return (
    <section aria-label="مساعد استهداف فرق" className={`rounded-[18px] border border-[color-mix(in_srgb,var(--color-border-primary)_32%,var(--color-border-default))] bg-[color-mix(in_srgb,var(--color-bg-primary-subtle)_34%,var(--color-bg-surface))] shadow-[var(--farq-soft-shadow)] ${mobile ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-brand)] text-[var(--color-text-on-brand)] shadow-sm"><Icon name="message" size={18} /></span>
        <div className="min-w-0">
          <h2 className="text-[16px] leading-[24px] font-semibold">مساعد استهداف فرق</h2>
          <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--color-text-secondary)]">اكتب من تريد استهدافه والغاية. أفهم الطلب، أبحث في الدليل، وأجهز مسودة من دون إرسال.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="targeting-assistant-prompt">طلب الاستهداف</label>
        <textarea id="targeting-assistant-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') understand() }} rows={mobile ? 3 : 2} placeholder="مثال: استهدف شركات المقاولات في الرياض، والغاية تعريفهم بفرق لتقليل تكلفة المشتريات" className={`min-w-0 flex-1 resize-none rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-[14px] leading-[22px] outline-none shadow-sm focus:border-[var(--color-border-primary)] ${FOCUS_RING}`} />
        <Button type="button" variant="Primary" size={mobile ? 'S' : 'M'} icon="arrow-forward" disabled={!prompt.trim()} onClick={understand}>افهم طلبي</Button>
      </div>
      {plan ? <div aria-live="polite" className="mt-3 rounded-[12px] border border-[color-mix(in_srgb,var(--color-border-primary)_24%,var(--color-border-default))] bg-[var(--color-bg-surface)] p-3 text-[14px] leading-[22px] shadow-sm">
        <p className="font-medium text-[var(--color-text-brand)]">فهمت طلبك.</p>
        <p className="mt-1 text-[var(--color-text-secondary)]">سأستهدف <b>{plan.target}</b> في <b>{cityLabel || city}</b> بهدف <b>{plan.purpose}</b>. سأختار فقط المنشآت التي لديها إشارة واتساب برقم صالح.</p>
        {!ready ? <Button type="button" variant="Primary" size="S" icon="check" loading={preparing} loadingLabel="نجهز المسودة…" className="mt-3" onClick={() => void prepare()}>جهّز مسودة الحملة</Button> : <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-[13px] text-[var(--color-text-success)]">تم تجهيز مسودة لـ {ready.count.toLocaleString('ar-SA')} منشأة. لم تُرسل أي رسالة.</span>{onOpenDraft ? <Button type="button" variant="Primary" size="S" icon="arrow-forward" onClick={onOpenDraft}>فتح المسودة</Button> : null}</div>}
      </div> : null}
      {error ? <p role="alert" className="mt-2 rounded-[10px] bg-[var(--color-bg-danger)] px-3 py-2 text-[13px] leading-[20px] text-[var(--color-text-danger)]">{error}</p> : null}
    </section>
  )
}
