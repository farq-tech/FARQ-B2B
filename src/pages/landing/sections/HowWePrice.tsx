import { cx } from '../../../ui/cx'
import { T } from '../kit'

/*
 * «كيف نسعّر لك؟» — Figma 85:1351 (desktop) · 86:629 (mobile). Now the second half of «كيف تعمل» (one section, owner 2026-10-08).
 * The living background runs inside the rounded frame (data-live-bg="light"); the Lead mounts <LiveBackground>.
 * Legend: dashed = request going out (live-go), solid = price coming back (live-back) — same colours as the canvas.
 */
const STEPS = [
  { title: 'طلبك يطلع من شركتك', body: 'مقر شركتك هو نقطة البداية. نكتب الطلب مرة وحدة، وهو يتوزع على الكل.', short: 'نكتبه مرة وحدة ويتوزع على الكل.' },
  { title: 'نوصل لكل مورد بكل قناة', body: 'طلب عرض سعر يروح بالواتساب، اتصال من مركز فرق، رسالة نصية، حراج، والإيميل — كل مسار لمورد مختلف.', short: 'واتساب · اتصال من مركز فرق · رسالة · حراج · إيميل.' },
  { title: 'يرجع لك بالسعر', body: 'كل مورد يرد بسعره على نفس الطريق، ومساعد المشتريات أحمد يتابع لين يوصل الرد.', short: 'كل مورد يرد بسعره، وأحمد يتابع لين يوصل الرد.' },
  { title: 'نطلع لك الفرق', body: 'نرتب الردود في مكان واحد ونطلع لك أرخص سعر والفرق بين العروض — والقرار لك.', short: 'أرخص سعر والفرق بين العروض — والقرار لك.' },
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
            اللي يتحرك في الخلفية هو اللي يصير فعلًا لطلبك: يطلع من شركتك، يوصل لكل مورد بكل قناة، ويرجع لك بالسعر — وفي الأخير نطلع لك أرخص سعر والفرق.
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
