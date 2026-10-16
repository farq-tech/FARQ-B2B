import { useState } from 'react'
import { useProcurement } from '../../procurementContext'
import { handoff, HANDOFF } from '../../lib/handoff'

export default function NewGoal() {
  const { navigate } = useProcurement()
  const [direction, setDirection] = useState<'purchase' | 'marketing'>('purchase')
  return <section dir="rtl" className="mx-auto flex w-full max-w-[760px] flex-col gap-6 p-5 sm:p-10">
    <h1 className="text-[28px] font-bold">وش تبي تحقق لمنشأتك؟</h1>
    <p className="text-[16px] leading-7 text-[var(--color-text-secondary)]">ابدأ بهدفك، ثم اكتشف الجهات المناسبة وأسباب ترشيحها.</p>
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 font-medium">من تبحث عنه؟</legend>
      {([{ value: 'purchase', title: 'بائعون — أبي أشتري', description: 'منتجات أو خدمات تحتاجها منشأتك.' }, { value: 'marketing', title: 'مشترون — أبي أبيع', description: 'جهات قد تستفيد مما تقدمه من منتجات أو خدمات.' }] as const).map(option => <label aria-label={option.title} key={option.value} className="flex cursor-pointer items-start gap-3 rounded-[16px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5">
        <input type="radio" name="goal-direction" value={option.value} checked={direction === option.value} onChange={() => setDirection(option.value)} className="mt-1" />
        <span><span className="block font-semibold">{option.title}</span><span className="mt-1 block text-sm text-[var(--color-text-secondary)]">{option.description}</span></span>
      </label>)}
    </fieldset>
    <button type="button" onClick={() => { handoff.set(HANDOFF.targetDirection, direction); navigate('create-upload') }} className="rounded-[12px] bg-[var(--color-bg-cta)] px-5 py-3 font-medium text-[var(--color-text-on-inverse)]">{direction === 'marketing' ? 'أضف ما تبي تسوّقه' : 'أضف ما تبي تسعّره'}</button>
    {direction === 'purchase' ? <button type="button" onClick={() => { handoff.set(HANDOFF.targetDirection, 'purchase'); navigate('create-upload') }} className="rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-5 py-3">عندي بنود جاهزة — أنشئ طلب عرض سعر</button> : null}
    <button type="button" onClick={() => navigate('rfq-list')} className="self-start underline">رجوع للأهداف والطلبات</button>
  </section>
}
