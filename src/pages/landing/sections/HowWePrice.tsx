import { cx } from '../../../ui/cx'
import { T } from '../kit'

/*
 * «كيف نسعّر لك؟» — Figma 85:1351 (desktop) · 86:629 (mobile). Now the second half of «كيف تعمل» (one section, owner 2026-10-08).
 * The living background runs inside the rounded frame (data-live-bg="light"); the Lead mounts <LiveBackground>.
 * Legend: dashed = request going out (live-go), solid = price coming back (live-back) — same colours as the canvas.
 */
const STEPS = [
  { title: 'اكتب احتياجك وراجعه', body: 'حدد البنود والكميات والوحدات ومدينة التوريد. راجع المواصفات قبل تأكيد طلبك.', short: 'حدد البنود والكميات والمواصفات، ثم راجعها.' },
  { title: 'اختر الموردين المناسبين', body: 'نقترح الموردين الأقرب لبنود طلبك، وتحدد الجهات التي تريد دعوتها.', short: 'راجع الترشيحات وحدد الجهات التي تريد دعوتها.' },
  { title: 'تابع العروض المستلمة', body: 'تابع حالة الطلب والعروض التي تصل إليه. التواصل بحسب القنوات المتاحة لكل مورد؛ الرسم محاكاة للرحلة.', short: 'تابع الردود والعروض بحسب القنوات المتاحة.' },
  { title: 'قارن واختر الأنسب', body: 'قارن المواصفات والسعر والتوفر وشروط التوريد. أقل سعر مو دائمًا أفضل اختيار؛ القرار لمنشأتك.', short: 'قارن السعر والمواصفات وشروط التوريد. القرار لك.' },
]

function LegendLine({ dashed }: { dashed?: boolean }) {
  return (
    <svg aria-hidden="true" width="28" height="4" viewBox="0 0 28 4" className="shrink-0">
      <line x1="0" y1="2" x2="28" y2="2" strokeWidth="2" strokeLinecap="round" stroke={dashed ? 'var(--live-go)' : 'var(--live-back)'} strokeDasharray={dashed ? '2 4' : undefined} />
    </svg>
  )
}

export function HowWePrice() {
  return (
    <div id="how-we-price" className="flex w-full flex-col gap-[var(--space-24)] pt-[var(--space-24)] md:gap-[var(--space-32)] md:pt-[var(--space-48)]">
        <div className="flex flex-col gap-[var(--space-12)]">
          <h3 id="how-we-price-title" className={cx(T.h3, 'text-[var(--color-text-primary)]')}>كيف نسعّر لك؟</h3>
          <p className={cx(T.bodyL, 'max-w-[760px] text-[var(--color-text-secondary)]')}>
            من احتياج واضح إلى قرار شراء: راجع البنود، اختر الموردين، تابع العروض، ثم قارن ما يناسب منشأتك. الرسم عرض توضيحي ولا يرسل طلبًا لأي مورد.
          </p>
        </div>

        {/* The animation is the page's own living layer now (one network for the whole page) — no framed copy here. */}

        <ol className="grid gap-[var(--space-24)] md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-[var(--space-12)] md:flex-col md:gap-[10px] md:rounded-[var(--radius-lg)] md:border md:border-[var(--color-border-default)] md:bg-[var(--color-bg-surface)] md:p-[var(--space-20)]">
              <span aria-hidden="true" className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center self-start rounded-[var(--radius-full)] bg-[var(--live-go)] px-[10px] font-display text-[13px] font-bold text-[var(--white)] md:py-[var(--space-4)]">
                {i + 1}
              </span>
              <div className="flex flex-col gap-[var(--space-4)] md:gap-[10px]">
                <h3 className={cx(T.title, 'text-[var(--color-text-primary)]')}>
                  <span className="sr-only">الخطوة {i + 1}: </span>
                  {s.title}
                </h3>
                <p className={cx(T.small, 'text-[var(--color-text-secondary)]')}>
                  <span className="md:hidden">{s.short}</span>
                  <span className="hidden md:inline">{s.body}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-x-[var(--space-24)] gap-y-[var(--space-8)]">
          <p className={cx(T.small, 'flex items-center gap-[var(--space-8)] text-[var(--color-text-secondary)]')}>
            <LegendLine dashed />
            <span><span className="sr-only">خط متقطع: </span>طلب عرض سعر رايح للمورد</span>
          </p>
          <p className={cx(T.small, 'flex items-center gap-[var(--space-8)] text-[var(--color-text-secondary)]')}>
            <LegendLine />
            <span><span className="sr-only">خط متصل: </span>السعر راجع لك</span>
          </p>
          <p className={cx(T.caption, 'text-[var(--color-text-secondary)]')}>· الأسعار في الرسم توضيحية</p>
        </div>
    </div>
  )
}
