import { Button } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'

type Props = {
  count: number
  objective: 'purchase' | 'marketing'
  saving: boolean
  onSave: () => void
  onClear: () => void
  onCreateRfq?: () => void
  mobile: boolean
}

/** A saved review list is deliberately separate from outreach. It is the shared
 * decision point for purchase and marketing work before an RFQ or campaign draft. */
export default function ReviewSelectionTray({ count, objective, saving, onSave, onClear, onCreateRfq, mobile }: Props) {
  const purchase = objective === 'purchase'
  return (
    <section aria-label="قائمة المراجعة المختارة" className={`border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] shadow-[var(--farq-soft-shadow)] ${mobile ? 'rounded-[18px]' : 'rounded-[14px]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[16px] leading-[24px] font-semibold">قائمة المراجعة <span className="font-medium text-[var(--color-text-secondary)]">· اخترت {count.toLocaleString('en-US')} جهة</span></h2>
          <p className="mt-0.5 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
            {purchase ? 'احفظ الجهات للرجوع إليها أو حوّلها إلى طلب تسعير. الحفظ لا يرسل شيئاً.' : 'احفظ الجهات للرجوع إليها، ثم أنشئ مسودة واتساب مستقلة للجهات القابلة للتواصل. الحفظ لا يرسل شيئاً.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="Ghost" size="S" onClick={onClear}>إلغاء التحديد</Button>
          <Button variant="Secondary" size="S" loading={saving} loadingLabel="نحفظ…" onClick={onSave}>حفظ القائمة</Button>
          {purchase && onCreateRfq ? <button type="button" onClick={onCreateRfq} className={`rounded-full bg-[var(--map-ink)] px-3 py-2 text-[13px] font-semibold text-white ${FOCUS_RING}`}>إنشاء طلب تسعير</button> : null}
        </div>
      </div>
    </section>
  )
}
