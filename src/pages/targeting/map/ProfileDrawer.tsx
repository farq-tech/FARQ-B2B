import { useEffect, useId, useRef } from 'react'
import { hasUnconfirmedStatus, statusLabel, waNumber, type TargetRow } from '../../../api/targetingClient'
import { recordMapInteraction } from '../../../lib/mapAnalytics'
import { Button, Icon } from '../../../ui'
import { FOCUS_RING } from '../../../ui/cx'
import { RoleChip, SpecChip } from './Badges'
import { MapIcon } from './glyphs'
import { completenessOf, hasPoint, mainAr, mainIcon, mainIdOf, rolesOf, safeLocationName, safeName, specsOf, subAr, subIdOf } from './model'

/*
 * «ملف المنشأة» — opens from a result row or a map pin (owner 2026-10-16). What the business is (main ▸ sub, roles,
 * specialties), where (district, street), how complete and how many sources, and whether Farq can message it.
 * NEVER a phone, an email or any other contact field: the campaign goes through Farq with an approved template.
 */
export default function ProfileDrawer({ row, onClose, chosen, onChoose, mobile, onRequestQuote }: {
  row: TargetRow
  onClose: () => void
  /** in the campaign list */
  chosen: boolean
  /** add / remove from the campaign (only with a WhatsApp channel) */
  onChoose: () => void
  mobile: boolean
  /** Continue from a matched supplier to the RFQ wizard with this supplier preselected. */
  onRequestQuote?: () => void
}) {
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const closeRef = useRef(onClose)
  const dragStart = useRef<number | null>(null)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    heading.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [row.poi_key])
  const m = mainIdOf(row), s = subIdOf(row)
  const sourceActivity = m === 'unc' ? row.category_ar?.trim() : null
  const roles = rolesOf(row), specs = specsOf(row)
  const done = completenessOf(row)
  const sources = row.source_count ?? row.sources?.length ?? null
  const wa = Boolean(waNumber(row))
  const status = statusLabel(row)
  const statusUnconfirmed = hasUnconfirmedStatus(row)
  useEffect(() => {
    if (statusUnconfirmed) recordMapInteraction('map_profile_status_unconfirmed')
  }, [row.poi_key, statusUnconfirmed])
  const saudi = Boolean(row.saudi_registered)
  const rating = typeof row.rating === 'number' && Number.isFinite(row.rating) && row.rating >= 1 && row.rating <= 5 ? row.rating : null
  const matchReason = row.match === 'product' ? 'اسم المنشأة يذكر المنتج'
    : row.match === 'seller' ? 'نشاط المنشأة يبيع هذا المنتج غالباً'
    : 'ظهرت ضمن نتائج النشاط المختار'
  const fitLabel = row.ai === 'L' ? 'ملاءمة مرجّحة'
    : row.ai === 'M' ? 'ملاءمة محتملة'
    : row.ai === 'N' ? 'ملاءمة منخفضة'
    : 'لا يوجد تقدير نموذجي'
  const fitBasis = row.match_confidence?.basis?.trim()
  const district = safeLocationName(row.district_ar)
  const dd = (k: string, v: string | null | undefined) => (v ? <><dt className="text-[var(--color-text-secondary)]">{k}</dt><dd className="m-0 font-medium">{v}</dd></> : null)

  return (
    <aside role="dialog" aria-modal="false" aria-labelledby={titleId} data-testid="profile-drawer"
      className={`z-30 flex flex-col overflow-y-auto bg-[var(--color-bg-surface)]/95 shadow-[var(--farq-soft-shadow)] backdrop-blur-xl ${mobile ? 'fixed inset-x-0 bottom-0 h-[95dvh] max-h-[calc(100dvh-env(safe-area-inset-top))] rounded-t-[20px] pb-[env(safe-area-inset-bottom)]' : 'absolute inset-y-0 end-0 w-[min(380px,92%)] border-s border-[var(--color-border-default)]'}`}>
      {mobile ? <div aria-hidden onPointerDown={(event) => { dragStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerUp={(event) => { const start = dragStart.current; dragStart.current = null; if (start != null && event.clientY - start > 48) onClose() }} onPointerCancel={() => { dragStart.current = null }} className="flex h-11 shrink-0 touch-none items-center justify-center"><span className="h-1.5 w-10 rounded-full bg-[var(--color-border-strong)]" /></div> : null}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 px-5 pt-5 pb-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--map-ink)] text-white"><MapIcon name={mainIcon(m)} size={20} /></span>
          <div className="flex min-w-0 flex-col">
            <h3 id={titleId} ref={heading} tabIndex={-1} className="text-[18px] leading-[28px] font-semibold text-balance outline-none">{safeName(row)}</h3>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]"><span className="font-medium text-[var(--color-text-primary)]">{m === 'unc' ? `تصنيف فرق: ${mainAr(m)}` : mainAr(m)}</span>{subAr(s) ? <> ▸ {subAr(s)}</> : null}</p>
          </div>
        </div>
        <button type="button" aria-label="إغلاق ملف المنشأة" onClick={onClose} className={`flex ${mobile ? 'size-11' : 'size-9'} shrink-0 items-center justify-center rounded-full border border-[var(--color-border-default)] hover:bg-[var(--color-bg-surface-2)] ${FOCUS_RING}`}><Icon name="x" size={16} /></button>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4 text-[14px] leading-[22px]">
        <section aria-label="سبب ظهور المنشأة" className="flex flex-col gap-1 rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-2.5">
          <h4 className="m-0 text-[12px] leading-[18px] font-semibold">سبب ظهورها</h4>
          <p className="m-0 font-medium">{matchReason}</p>
          <p className="m-0 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">تقدير الملاءمة: {fitLabel}. {fitBasis || 'المطابقة إشارة من النشاط والبيانات، وليست تأكيداً لتوفر المنتج أو قبول المورد للطلب.'}</p>
        </section>
        {sourceActivity ? <p className="rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[12px] leading-[20px] text-[var(--color-text-secondary)]">النشاط الوارد في الدليل: <span className="font-medium text-[var(--color-text-primary)]">{sourceActivity}</span>. لم يُربط هذا الوصف بتصنيف فرق بعد، ولا يؤكد صحته.</p> : null}
        {roles.length ? (
          <div className="flex flex-col gap-1.5"><p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">الدور</p><div className="flex flex-wrap gap-1.5">{roles.map((x) => <RoleChip key={x} role={x} />)}</div></div>
        ) : null}
        {specs.length ? (
          <div className="flex flex-col gap-1.5"><p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">التخصصات</p><div className="flex flex-wrap gap-1.5">{specs.map((x) => <SpecChip key={x} name={x} />)}</div></div>
        ) : <p className="rounded-[10px] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[12px] leading-[20px] text-[var(--color-text-secondary)]">لم يُحدَّد تخصص لهذه المنشأة بعد؛ تظهر ضمن نشاطها الفرعي{subAr(s) ? ` «${subAr(s)}»` : ''}.</p>}
        <div className="flex flex-wrap gap-1.5">
          {status ? <span className="inline-flex items-center rounded-full border border-[var(--map-sand)] bg-[color-mix(in_srgb,var(--map-sand)_25%,white)] px-2.5 py-1 text-[12px] leading-[18px] font-medium">حالة السجل: {status}</span> : null}
          {statusUnconfirmed ? <span className="inline-flex items-center rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-2.5 py-1 text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">حالة التشغيل غير مؤكدة</span> : null}
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] leading-[18px] font-medium ${wa ? 'border-[color-mix(in_srgb,var(--map-green)_40%,white)] bg-[color-mix(in_srgb,var(--map-green)_8%,white)] text-[var(--color-text-success)]' : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]'}`}>
            {wa ? 'واتساب متاح عبر فرق' : 'لا توجد قناة واتساب بعد'}
          </span>
          {saudi ? <span className="inline-flex items-center rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-2.5 py-1 text-[12px] leading-[18px] font-medium">منشأة سعودية</span> : null}
        </div>
        {statusUnconfirmed ? <p className="-mt-2 text-[12px] leading-[19px] text-[var(--color-text-secondary)]">لا تتوفر حالة تشغيل موثقة لهذه المنشأة في البيانات الحالية؛ تواصل معها للتأكد من استمرار نشاطها.</p> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {dd('الحي', district ? `${district}${row.district_reliable === false ? ' · غير مؤكد' : ''}` : null)}
          {dd('الشارع', row.street_ar || null)}
          {dd('الموقع', hasPoint(row) ? null : 'موقع تقريبي — لا يظهر على الخريطة')}
          {dd('التقييم', rating != null ? `${rating.toLocaleString('en-US', { maximumFractionDigits: 1 })} من 5` : null)}
          {dd('المصادر المسجلة', sources != null ? `${sources.toLocaleString('en-US')} ${sources === 1 ? 'مصدر' : 'مصادر'}` : null)}
        </dl>
        {sources === 1 ? <p className="-mt-2 rounded-[10px] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[12px] leading-[20px] text-[var(--color-text-secondary)]">هذا السجل مرتبط بمصدر واحد فقط؛ عدد المصادر لا يؤكد صحة النشاط أو التصنيف.</p> : null}
        {done != null ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">اكتمال بيانات المنشأة: <span className="font-medium text-[var(--color-text-primary)]">{done}٪</span></p>
            <div role="meter" aria-label="اكتمال بيانات المنشأة" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done} className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-surface-2)]">
              <i className="block h-full rounded-full bg-[var(--map-green)]" style={{ width: `${done}%` }} />
            </div>
          </div>
        ) : null}
        <p className="rounded-[10px] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[12px] leading-[20px] text-[var(--color-text-secondary)]">بيانات التواصل لا تظهر. التواصل يتم عبر فرق بالقوالب المعتمدة من ميتا.</p>
        {wa ? <Button variant={chosen ? 'Secondary' : 'Primary'} size="M" fullWidth onClick={onChoose}>{chosen ? 'إزالة من الحملة' : 'أضف للحملة'}</Button> : null}
        {onRequestQuote && (wa || row.email) ? <Button variant="Secondary" size="M" fullWidth onClick={onRequestQuote}>جهّز طلب تسعير لهذا المورد</Button> : null}
      </div>
    </aside>
  )
}
