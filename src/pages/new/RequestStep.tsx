import { Button, Dropzone, Icon, Input, OptionCard, type SpotName } from '../../ui'
import { cx, FOCUS_RING } from '../../ui/cx'
import { readQty } from '../../lib/sendGuards'
import booklet from '../../assets/spot/booklet.svg'
import list from '../../assets/spot/list.svg'
import photo from '../../assets/spot/photo.svg'
import { XLSX, type Method, type RequestFlow } from './useRequestFlow'

/*
 * 01 · طلب جديد — اختيار الطريقة. Desktop Figma 38:2, mobile M01 56:2.
 * Three ways in (booklet / typed / photo) that can be combined in one request.
 */

const UNITS = ['حبة', 'م²', 'م³', 'م.ط', 'طن', 'كجم', 'كيس', 'لتر', 'لفة', 'مقطوعية']
const METHODS: Array<{ key: Method; spot: SpotName; title: string; hint: string; mobileHint: string }> = [
  { key: 'booklet', spot: 'كراسة', title: 'ارفع الكراسة', hint: 'Excel أو PDF', mobileHint: 'ملف Excel أو PDF' },
  { key: 'typed', spot: 'قائمة', title: 'اكتب الطلبات', hint: 'سطر لكل بند', mobileHint: 'سطر لكل بند' },
  { key: 'photo', spot: 'صورة', title: 'صوّرها', hint: 'كراسة ورقية أو قطعة', mobileHint: 'كراسة ورقية أو قطعة' },
]
const SPOT: Record<SpotName, string> = { 'كراسة': booklet, 'قائمة': list, 'صورة': photo }

/** M01 option row (56:2): spot at the start, title + hint, 2px primary border when chosen. */
function OptionRow({ spot, title, hint, selected, onSelect }: { spot: SpotName; title: string; hint: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={`${title} — ${hint}`} onClick={onSelect}
      className={cx('flex h-[84px] w-full items-center gap-4 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] px-4 text-start',
        selected ? 'border-2 border-[var(--color-border-primary)]' : 'border border-[var(--color-border-default)]', FOCUS_RING)}>
      <img src={SPOT[spot]} alt="" width={48} height={48} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium text-[var(--color-text-primary)]">{title}</span>
        <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{hint}</span>
      </span>
    </button>
  )
}

export function RequestStep({ flow, mobile }: { flow: RequestFlow; mobile: boolean }) {
  const { method, setMethod, reading, readError, source, lines, unusable } = flow
  return (
    <section aria-labelledby="q-h" className={cx('relative z-10 mx-auto flex w-full flex-col', mobile ? 'gap-6 px-4 pt-4' : 'max-w-[760px] items-center gap-8 pt-12')}>
      <div className={cx('flex flex-col gap-2', mobile ? 'items-start text-start' : 'items-center text-center')}>
        {flow.greeting ? <p className="text-[18px] leading-[30px] text-[var(--color-text-secondary)]">هلا {flow.greeting}</p> : null}
        <h1 id="q-h" className={cx('font-[family-name:var(--font-display)] font-bold tracking-[-0.5px]', mobile ? 'text-[32px] leading-[48px]' : 'text-[40px] leading-[60px]')}>وش تبي نسعّر لك اليوم؟</h1>
        {mobile ? null : <p className="text-[16px] leading-[26px] text-[var(--color-text-secondary)]">اختر الطريقة الأسهل — تقدر تجمع بينها في نفس الطلب.</p>}
      </div>

      <div role="radiogroup" aria-label="طريقة إدخال الطلب" className={cx('flex', mobile ? 'flex-col gap-3' : 'gap-4')}>
        {METHODS.map((m) => mobile
          ? <OptionRow key={m.key} spot={m.spot} title={m.title} hint={m.mobileHint} selected={method === m.key} onSelect={() => setMethod(m.key)} />
          : <OptionCard key={m.key} spot={m.spot} title={m.title} hint={m.hint} selected={method === m.key} onSelect={() => setMethod(m.key)} />)}
      </div>

      {method === 'typed' ? (
        <form aria-label="أضف بند مكتوب" className={cx('flex w-full flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]', mobile ? 'p-4' : 'p-6')} onSubmit={(e) => { e.preventDefault(); flow.addTyped() }}>
          <div className={cx('grid items-end gap-3', mobile ? 'grid-cols-2' : 'grid-cols-[1fr_140px_140px]')}>
            <Input className={mobile ? 'col-span-2' : undefined} label="البند" placeholder="مثال: كيبل نحاس 4×16 مم²" value={flow.name} onChange={(e) => flow.setName(e.target.value)} />
            <Input label="الكمية" inputMode="decimal" placeholder="0" value={flow.qty} onChange={(e) => flow.setQty(e.target.value)} />
            <div className="flex flex-col gap-2">
              <label htmlFor="typed-unit" className="text-[14px] leading-[22px] font-medium">الوحدة</label>
              <select id="typed-unit" value={flow.unit} onChange={(e) => flow.setUnit(e.target.value)} className={cx('h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 text-[16px]', FOCUS_RING)}>
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <Button type="submit" variant="Secondary" icon="plus" className="self-start">أضف البند</Button>
        </form>
      ) : (
        <Dropzone
          className="w-full"
          accept={method === 'photo' ? 'image/*,application/pdf,.pdf' : '.pdf,application/pdf,.xlsx,' + XLSX}
          state={reading ? 'Uploading' : readError ? 'Error' : source && lines.length ? 'Success' : 'Idle'}
          fileName={reading?.name || source || undefined}
          progress={reading?.progress}
          successNote={`قرأنا ${lines.length} بند — راجعها في الخطوة التالية`}
          errorNote={readError || undefined}
          onFiles={(f) => void flow.onFiles(f)}
        />
      )}
      {reading ? <p className="sr-only" aria-live="polite">{reading.note}</p> : null}

      {lines.length ? (
        <div className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <p className="text-[14px] font-medium" aria-live="polite">{lines.length} بند في الطلب{unusable ? ` · ${unusable} بلا كمية صحيحة (ما تنرسل)` : ''}</p>
            <Button variant="Ghost" size="S" onClick={flow.clearLines}>مسح الكل</Button>
          </div>
          <ul aria-label="البنود المضافة" className="max-h-60 overflow-auto border-t border-[var(--color-border-default)]">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-5 py-2 text-[14px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="font-[family-name:var(--font-display)] tabular-nums" style={{ color: readQty(l.qty) ? undefined : 'var(--color-text-danger)' }}>{l.qty || '—'}</span>
                <span className="w-14 text-[var(--color-text-secondary)]">{l.unit}</span>
                <button type="button" aria-label={`حذف ${l.name}`} onClick={() => flow.removeLine(l.id)} className={cx('rounded-[var(--radius-sm)] text-[var(--color-icon-secondary)] hover:text-[var(--color-text-danger)]', FOCUS_RING)}><Icon name="x" size={16} /></button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="flex items-center gap-2 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
        <Icon name="shield" size={18} className="shrink-0 text-[var(--color-icon-success)]" />
        ما نرسل شي لأي مورد قبل ما تراجع البنود وتوافق.
      </p>
    </section>
  )
}

export default RequestStep
