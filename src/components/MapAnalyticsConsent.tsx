import { useEffect, useState } from 'react'
import { mapAnalyticsConsent, recordMapPageView, setMapAnalyticsConsent } from '../lib/mapAnalytics'

const CHANGE_EVENT = 'farq:change-map-analytics-consent'
const CONSENT_CHANGE_EVENT = 'farq:map-analytics-consent-changed'

export function openMapAnalyticsPreferences() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export default function MapAnalyticsConsent({ active }: { active: boolean }) {
  const [choice, setChoice] = useState<'accepted' | 'rejected' | null>(() => mapAnalyticsConsent())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(CHANGE_EVENT, show)
    return () => window.removeEventListener(CHANGE_EVENT, show)
  }, [])
  useEffect(() => {
    if (active && choice === null) setOpen(true)
  }, [active, choice])
  useEffect(() => {
    if (active && choice === 'accepted') recordMapPageView()
  }, [active, choice])

  if (!open) return null
  const choose = (value: 'accepted' | 'rejected') => {
    setMapAnalyticsConsent(value)
    setChoice(value)
    setOpen(false)
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT))
  }

  return (
    <aside role="region" aria-label="تفضيلات قياس استخدام الخريطة" className="fixed inset-x-3 bottom-3 z-[120] mx-auto max-w-[620px] rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-[var(--farq-soft-shadow)] sm:inset-x-auto sm:end-5 sm:bottom-5">
      <h2 className="m-0 text-[16px] leading-6 font-semibold">قياس اختياري لتحسين الخريطة</h2>
      <p className="mt-2 mb-0 text-[13px] leading-5 text-[var(--color-text-secondary)]">
        عند الموافقة، نرسل إلى خوادم فرق مشاهدة عامة لصفحة الخريطة وأسماء تفاعلات عامة وفئة زمنية عامة لجاهزيتها، مع رقم جلسة عشوائياً لهذا التبويب؛ مثل البحث أو استخدام البحث داخل الفلاتر أو اختيار حي وظهور ملخصه أو توسيع أنشطته أو استخدام الدليل أو فتح ملف منشأة أو إضافة مرشحين للحملة أو اختيار تصنيف للشوارع. وقد نسجل فئة عامة لوجود هاتف أو بريد ضمن مجموعة النتائج التي استلمتها الخريطة، دون إرسال القيم أو عدد المنشآت. لا يتضمن القياس مدة دقيقة أو نص البحث أو المدينة أو الحي أو اسم النشاط أو المنشأة أو بيانات التواصل أو الإحداثيات. يمكنك تغيير اختيارك لاحقاً من «حسابي».
      </p>
      {choice === 'accepted' ? <p className="mt-2 mb-0 text-[12px] text-[var(--color-text-secondary)]">اختيارك الحالي: موافق.</p> : null}
      {choice === 'rejected' ? <p className="mt-2 mb-0 text-[12px] text-[var(--color-text-secondary)]">اختيارك الحالي: غير موافق.</p> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => choose('rejected')} className="rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-[13px] font-medium hover:bg-[var(--color-bg-surface-2)]">رفض القياس</button>
        <button type="button" onClick={() => choose('accepted')} className="rounded-lg bg-[var(--map-ink)] px-3 py-2 text-[13px] font-medium text-white hover:opacity-90">موافقة</button>
      </div>
    </aside>
  )
}
