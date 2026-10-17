import { Icon } from '../../../ui'

/*
 * The four steps of خريطة الفرص (owner 2026-10-16: «تجربة الخريطة غير واضحة»), the current one highlighted.
 * On a phone the strip is one line: «الخطوة ٢ من ٤ · …».
 */
export const STEPS = ['اكتب وش تبي', 'شوف الشوارع والأحياء الأكثف', 'اختر حي أو شارع', 'اختر المنشآت وأرسل'] as const
const AR = ['١', '٢', '٣', '٤']
const HINTS = [
  'ابحث باسم النشاط أو المنتج لعرض المنشآت المناسبة.',
  'الخطوط تبيّن كثافة النشاط؛ اضغط حيّاً أو شارعاً لاستكشافه.',
  'اختيار حي أو شارع يضيّق النتائج إلى هذا الموقع.',
  'راجع المنشآت المحددة، ثم أرسلها عبر واتساب.',
] as const

export default function StepStrip({ current, mobile }: { current: 1 | 2 | 3 | 4; mobile: boolean }) {
  if (mobile) {
    return (
      <div data-testid="map-steps" aria-label="خطوات الخريطة" className="rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2">
        <div className="flex items-center gap-2 text-[13px] leading-[20px]">
          <span className="shrink-0 rounded-full bg-[var(--map-ink)] px-2 text-[12px] font-semibold text-white">الخطوة {AR[current - 1]} من ٤</span>
          <span className="truncate font-medium">{STEPS[current - 1]}</span>
        </div>
        <p className="m-0 mt-1 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{HINTS[current - 1]}</p>
      </div>
    )
  }
  return (
    <div data-testid="map-steps" aria-label="خطوات الخريطة" className="flex flex-col gap-1.5">
      <ol className="flex flex-wrap items-center gap-1.5 text-[13px] leading-[20px]">
        {STEPS.map((s, i) => {
        const k = i + 1, done = k < current, now = k === current
        return (
          <li key={s} aria-current={now ? 'step' : undefined} className="flex items-center gap-1.5">
            {i ? <span aria-hidden className="text-[var(--color-text-tertiary)]">←</span> : null}
            <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${now ? 'border-[var(--map-ink)] bg-[var(--map-ink)] text-white' : done ? 'border-[color-mix(in_srgb,var(--map-green)_40%,white)] bg-[color-mix(in_srgb,var(--map-green)_8%,white)] text-[var(--color-text-success)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]'}`}>
              {done ? <Icon name="check" size={13} /> : <span className="tabular-nums">{AR[i]}</span>}{s}
            </span>
          </li>
        )
        })}
      </ol>
      <p className="m-0 px-1 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{HINTS[current - 1]}</p>
    </div>
  )
}
