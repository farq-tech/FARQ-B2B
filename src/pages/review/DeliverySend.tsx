import { Button, Chip, Input } from '../../ui'
import { cx } from '../../ui/cx'
import { DEPARTMENTS, type RequestFlow } from '../new/useRequestFlow'

/*
 * «التوصيل» and «الإرسال» — no Figma frame (desktop or mobile); composed from src/ui like M4.
 * Fields, blockers and the paid-WhatsApp question are the source flow's (NewRequestScreen.tsx@5147808).
 */

export function DeliveryStep({ flow, mobile }: { flow: RequestFlow; mobile: boolean }) {
  const { quoteDeadline, requiredDate } = flow
  return (
    <section aria-labelledby="dl-h" className={cx('relative z-10 mx-auto flex w-full max-w-[752px] flex-col gap-6', mobile ? 'px-4 pt-6 pb-6' : 'pt-12')}>
      <h1 id="dl-h" className={cx('font-[family-name:var(--font-display)] font-bold', mobile ? 'text-[28px] leading-[40px]' : 'text-[32px] leading-[48px]')}>وين ومتى التوريد؟</h1>
      <div className={cx('grid gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]', mobile ? 'grid-cols-1 p-4' : 'grid-cols-2 p-6')}>
        <Input label="اسم المشروع" placeholder="مثال: فيلا النرجس" value={flow.project} onChange={(e) => flow.setProject(e.target.value)} helper="يظهر للموردين مع المدينة" />
        <Input label="مدينة التسليم" value={flow.city} onChange={(e) => flow.setCity(e.target.value)} error={!flow.city.trim() ? 'اكتب مدينة التسليم.' : undefined} />
        <Input label="موعد التوريد" type="date" value={requiredDate} onChange={(e) => flow.setRequiredDate(e.target.value)} />
        <Input label="آخر موعد للعروض" type="date" value={quoteDeadline} onChange={(e) => flow.setQuoteDeadline(e.target.value)} helper="الساعة 5:00 م" error={quoteDeadline && requiredDate && quoteDeadline >= requiredDate ? 'آخر موعد للعروض يجب أن يسبق موعد التوريد.' : undefined} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[14px] leading-[22px] font-medium">نوع الطلب</legend>
          <div className="flex flex-wrap gap-2">
            <Chip label="توريد فقط" selected={flow.requestType === 'SUPPLY_ONLY'} onClick={() => flow.setRequestType('SUPPLY_ONLY')} />
            <Chip label="توريد وتركيب" selected={flow.requestType === 'SUPPLY_AND_INSTALL'} onClick={() => flow.setRequestType('SUPPLY_AND_INSTALL')} />
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[14px] leading-[22px] font-medium">القسم</legend>
          <div className="flex flex-wrap gap-2">
            {DEPARTMENTS.map(([k, l]) => <Chip key={k} label={l} selected={flow.department === k} onClick={() => flow.setDepartment(k)} />)}
          </div>
        </fieldset>
      </div>
    </section>
  )
}

export function SendStep({ flow, mobile }: { flow: RequestFlow; mobile: boolean }) {
  const { summary, createdId, readyItems, allPicked, city, requiredDate, needsCheck, blockers, sending, waAsk, progress } = flow
  return (
    <section aria-labelledby="sd-h" className={cx('relative z-10 mx-auto flex w-full max-w-[752px] flex-col gap-6', mobile ? 'px-4 pt-6 pb-6' : 'pt-12')}>
      <h1 id="sd-h" className={cx('font-[family-name:var(--font-display)] font-bold', mobile ? 'text-[28px] leading-[40px]' : 'text-[32px] leading-[48px]')}>{summary ? 'وصل طلبك للموردين' : createdId ? 'نرسل الطلب…' : 'جاهز للإرسال'}</h1>
      <dl className={cx('grid gap-4', mobile ? 'grid-cols-1' : 'grid-cols-3')}>
        {[['البنود', `${readyItems.length} بند`], ['الموردين', `${allPicked.length} مورد`], ['التسليم', `${city} · ${requiredDate}`]].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-5 py-4">
            <dt className="text-[14px] font-medium text-[var(--color-text-secondary)]">{k}</dt>
            <dd className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {needsCheck.length ? <p className="text-[14px] text-[var(--color-text-warning)]">{needsCheck.length} بند بلا مورد مختار — ما ينرسل.</p> : null}
      {blockers.length && !sending ? <ul role="alert" className="flex flex-col gap-1 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] p-4 text-[14px] text-[var(--color-text-danger)]">{blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}

      {waAsk ? (
        <div role="alertdialog" aria-labelledby="wa-h" className="flex flex-col gap-3 rounded-[var(--radius-lg)] border-[1.5px] border-[var(--color-border-warning)] bg-[var(--color-bg-surface)] p-5">
          <p id="wa-h" className="text-[16px] font-medium">{waAsk.count} مورد يوصلهم الطلب عبر واتساب برسوم {waAsk.price} ر.س للرسالة. نرسل لهم؟</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="Primary" onClick={() => waAsk.resolve(true)}>نعم، أرسل عبر واتساب</Button>
            <Button variant="Secondary" onClick={() => waAsk.resolve(false)}>لا، بدون واتساب</Button>
          </div>
        </div>
      ) : null}

      {sending ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5" aria-live="polite">
          <p className="text-[16px] font-medium">{summary ? `تم الإرسال لـ ${summary.sent} من ${summary.total}${summary.failed ? ` · تعذّر ${summary.failed}` : ''}` : progress.text}</p>
          {progress.total && !summary ? (
            <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-[3px] bg-[var(--color-bg-surface-2)]"><span className="block h-full rounded-[3px] bg-[var(--color-bg-brand)] transition-[width]" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
