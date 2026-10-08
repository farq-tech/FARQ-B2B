import { useMemo, useState } from 'react'
import { Badge, Button, Chip, EvidenceBadge, Icon, Tabs, type EvidenceLevel } from '../../ui'
import { cx, FOCUS_RING } from '../../ui/cx'
import type { BOQItem, Supplier } from '../../types'
import { DEPT_LABEL, type RequestFlow } from '../new/useRequestFlow'

/*
 * 02 · مراجعة البنود. Desktop Figma 42:44, mobile M02 56:60.
 * The step lives inside the /new flow (the draft is not on the server until it is sent),
 * so this page takes the flow state as a prop; src/pages/new/index.tsx renders it.
 *
 * Figma's «ثقة القراءة» column has no API field behind it (docs/qa/open-issues.md §5): the column is
 * kept and says so instead of inventing a level. The edit pencil of 42:44 opens the line's suppliers.
 */

/** Every supplier the item knows about, de-duplicated (same order as the source flow). */
export function candidatesFor(item: BOQItem): Supplier[] {
  const all = [...(item.learnedSuggestion?.suppliers || []), ...(item.mapSuggestion?.suppliers || []), ...item.suppliers, ...(item.aiSuggestion?.suppliers || []), ...(item.familySuggestion?.suppliers || [])]
  const seen = new Set<string>()
  return all.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}

/** The API's own evidence label, coloured by strength. Never re-worded. */
function evidenceLevel(e: Supplier['evidence']): EvidenceLevel | null {
  if (e === 'دليل مباشر' || e === 'دليل منتج') return 'Strong'
  if (e === 'نشاط متطابق' || e === 'على مستوى النشاط' || e === 'خريطة فرق') return 'Medium'
  if (e === 'من الكتالوج' || e === 'تسمية آلية') return 'Weak'
  return null
}

const PAGE = 12

function SupplierPicker({ flow, item, id }: { flow: RequestFlow; item: BOQItem; id: string }) {
  const picked = flow.selected[item.id] || []
  const cands = candidatesFor(item)
  return (
    <fieldset id={id} className="flex flex-col gap-2">
      <legend className="mb-1 text-[14px] font-medium">موردين «{item.name}»</legend>
      {cands.length === 0 ? <p className="text-[14px] text-[var(--color-text-secondary)]">ما لقينا مورد لهذا البند في السجل.</p> : null}
      {cands.map((s) => {
        const lvl = evidenceLevel(s.evidence)
        return (
          <label key={s.id} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
            <input type="checkbox" checked={picked.includes(s.id)} onChange={() => flow.toggle(item.id, s.id)} className="size-4 accent-[var(--color-bg-primary)]" />
            <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
            <span className="text-[12px] text-[var(--color-text-secondary)]">{s.city}</span>
            {lvl ? <EvidenceBadge level={lvl} label={s.evidence} /> : <Badge tone="Neutral" label={s.evidence} showDot={false} />}
          </label>
        )
      })}
    </fieldset>
  )
}

/** The note under a line: why it needs a look, else its spec. */
function lineNote(item: BOQItem, picked: number) {
  if (item.workOnly) return { text: 'عمل فقط — ما فيه مواد تُشترى', warn: true }
  if (!picked) return { text: 'ما فيه مورد مختار — ما ينرسل', warn: true }
  return item.spec ? { text: item.spec, warn: false } : null
}

/** Static category pill — Figma «Chip» look (21:75), not a control here. */
function CategoryPill({ dept }: { dept: string | null }) {
  if (!dept || !DEPT_LABEL[dept]) return <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">غير مصنّف</span>
  return <span className="inline-flex rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-2 text-[14px] leading-[22px] font-medium whitespace-nowrap text-[var(--color-text-secondary)]">{DEPT_LABEL[dept]}</span>
}

export function ReviewPage({ flow, mobile }: { flow: RequestFlow; mobile: boolean }) {
  const { items, selected, needsCheck, readyItems, sourceKind, source } = flow
  const [tab, setTab] = useState<string>(mobile && needsCheck.length ? 'check' : 'all')
  const [open, setOpen] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  const byDept = useMemo(() => {
    const m = new Map<string, { items: number; suppliers: Set<string>; direct: Set<string> }>()
    for (const i of items) {
      const k = flow.departmentOf(i)
      const e = m.get(k) || { items: 0, suppliers: new Set<string>(), direct: new Set<string>() }
      e.items += 1
      const picked = new Set(selected[i.id] || [])
      for (const s of candidatesFor(i)) if (picked.has(s.id)) { e.suppliers.add(s.id); if (evidenceLevel(s.evidence) === 'Strong') e.direct.add(s.id) }
      m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => b[1].items - a[1].items)
  }, [items, selected, flow])

  const tabs = [{ key: 'all', label: `كل البنود (${items.length})` }, { key: 'check', label: `تحتاج تأكيد (${needsCheck.length})` }, ...byDept.map(([k, v]) => ({ key: k, label: `${DEPT_LABEL[k] || 'غير مصنّف'} (${v.items})` }))]
  const visible = items.filter((i) => tab === 'all' || (tab === 'check' ? needsCheck.includes(i) : flow.departmentOf(i) === tab))
  const shown = showAll ? visible : visible.slice(0, PAGE)
  const heading = sourceKind === 'typed' ? `${items.length} بند في الطلب` : mobile ? `قرأنا ${items.length} بند` : `قرأنا ${items.length} بند ${sourceKind === 'photo' ? 'من الصور' : 'من الكراسة'}`
  const addLine = () => { flow.setMethod('typed'); flow.setStep(0) }
  const more = visible.length > shown.length
    ? <button type="button" onClick={() => setShowAll(true)} className={cx('w-full p-4 text-center text-[14px] font-medium text-[var(--color-text-link)]', FOCUS_RING)}>عرض {visible.length - shown.length} بند إضافي</button>
    : null
  const empty = visible.length === 0
    ? <p className="p-6 text-center text-[14px] text-[var(--color-text-secondary)]">{tab === 'check' ? 'كل البنود جاهزة — ما فيه شي يحتاج تأكيد.' : 'ما فيه بنود في هذا التصنيف.'}</p>
    : null

  /* ---------- mobile: M02 56:60 ---------- */
  if (mobile) {
    return (
      <section aria-labelledby="items-h" className="relative z-10 flex flex-col gap-4 px-4 pt-6 pb-6">
        <div className="flex flex-col gap-1">
          <h1 id="items-h" className="font-[family-name:var(--font-display)] text-[28px] leading-[40px] font-bold">{heading}</h1>
          {needsCheck.length
            ? <p className="text-[14px] leading-[22px] text-[var(--color-text-warning)]">{needsCheck.length} تحتاج تأكيدك قبل الإرسال</p>
            : <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">كل البنود جاهزة للإرسال</p>}
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">تصفية البنود</legend>
          {needsCheck.length ? <Chip label={`تحتاج تأكيد ${needsCheck.length}`} selected={tab === 'check'} onClick={() => { setTab('check'); setShowAll(false) }} /> : null}
          <Chip label={`الكل ${items.length}`} selected={tab === 'all'} onClick={() => { setTab('all'); setShowAll(false) }} />
        </fieldset>
        <ul aria-label="بنود الطلب" className="flex flex-col gap-3">
          {shown.map((i) => {
            const picked = selected[i.id] || []
            const flagged = needsCheck.includes(i)
            const note = lineNote(i, picked.length)
            const panel = `sup-m-${i.id}`
            return (
              <li key={i.id} className={cx('flex flex-col gap-3 rounded-[var(--radius-lg)] p-4', flagged ? 'bg-[var(--color-bg-warning)]' : 'border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]')}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1 text-[16px] leading-[26px] font-medium">{i.name}</span>
                  <span className="shrink-0 font-[family-name:var(--font-display)] text-[16px] leading-[24px] font-semibold tabular-nums">{i.qty} {i.unit}</span>
                </div>
                {note ? <p className={cx('text-[12px] leading-[18px]', note.warn ? 'text-[var(--color-text-warning)]' : 'text-[var(--color-text-secondary)]')}>{note.text}</p> : null}
                {i.workOnly ? null : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{picked.length} من {candidatesFor(i).length} مورد</span>
                    <Button variant="Secondary" size="S" aria-expanded={open === i.id} aria-controls={panel} onClick={() => setOpen(open === i.id ? null : i.id)}>{flagged ? 'تأكد' : 'الموردين'}</Button>
                  </div>
                )}
                {open === i.id ? <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-surface)] p-3"><SupplierPicker flow={flow} item={i} id={panel} /></div> : null}
              </li>
            )
          })}
        </ul>
        {empty}
        {more}
      </section>
    )
  }

  /* ---------- desktop: 42:44 ---------- */
  return (
    <div className="relative z-10 flex items-start gap-6 px-12 py-8">
      <section aria-labelledby="items-h" className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col items-start gap-1">
            <h1 id="items-h" className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold">{heading}</h1>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">راجع البنود اللي عليها علامة قبل ما نكمّل{source ? ` · ${source}` : ''}</p>
          </div>
          <Button variant="Secondary" icon="plus" onClick={addLine}>أضف بند</Button>
        </div>
        <Tabs label="تصفية البنود" value={tab} onChange={(k) => { setTab(k); setShowAll(false) }} items={tabs} />
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
          <table className="w-full table-fixed border-collapse text-start">
            <caption className="sr-only">بنود الطلب</caption>
            <thead className="bg-[var(--color-bg-surface-2)] text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="w-12 px-3 py-3 text-start font-medium">#</th>
                <th scope="col" className="px-3 py-3 text-start font-medium">البند والمواصفات</th>
                <th scope="col" className="w-24 px-3 py-3 text-start font-medium">الكمية</th>
                <th scope="col" className="w-[88px] px-3 py-3 text-start font-medium">الوحدة</th>
                <th scope="col" className="w-32 px-3 py-3 text-start font-medium">الفئة</th>
                <th scope="col" className="w-[120px] px-3 py-3 text-start font-medium">ثقة القراءة</th>
                <th scope="col" className="w-[136px] px-3 py-3 text-start font-medium">الموردين</th>
              </tr>
            </thead>
            {shown.map((i) => {
              const picked = selected[i.id] || []
              const flagged = needsCheck.includes(i)
              const cands = candidatesFor(i)
              const note = lineNote(i, picked.length)
              return (
                <tbody key={i.id} className="border-t border-[var(--color-border-default)]">
                  <tr className={cx('h-[68px]', flagged && 'bg-[var(--color-bg-warning)]')}>
                    <td className="px-3 font-[family-name:var(--font-display)] text-[14px] font-medium text-[var(--color-text-tertiary)]">{items.indexOf(i) + 1}</td>
                    <td className="min-w-0 px-3 py-2">
                      <span className="block truncate text-[16px] leading-[26px] font-medium" title={i.name}>{i.name}</span>
                      {note ? <span className={cx('block truncate text-[12px] leading-[18px]', note.warn ? 'text-[var(--color-text-warning)]' : 'text-[var(--color-text-secondary)]')}>{note.text}</span> : null}
                    </td>
                    <td className="px-3 font-[family-name:var(--font-display)] text-[14px] font-medium tabular-nums">{i.qty}</td>
                    <td className="px-3 text-[14px]">{i.unit}</td>
                    <td className="px-3"><CategoryPill dept={flow.departmentOf(i)} /></td>
                    <td className="px-3 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]"><span aria-label="ثقة القراءة غير متاحة">—</span></td>
                    <td className="px-3">
                      {i.workOnly ? null : flagged ? (
                        <Button variant="Secondary" size="S" aria-expanded={open === i.id} aria-controls={`sup-${i.id}`} onClick={() => setOpen(open === i.id ? null : i.id)}>تأكد</Button>
                      ) : (
                        <button type="button" aria-expanded={open === i.id} aria-controls={`sup-${i.id}`} onClick={() => setOpen(open === i.id ? null : i.id)}
                          className={cx('inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1 text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}>
                          <Icon name="edit" size={18} />
                          <span>{picked.length} من {cands.length} مورد</span>
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === i.id ? (
                    <tr>
                      <td colSpan={7} className="bg-[var(--color-bg-canvas)] px-6 py-4"><SupplierPicker flow={flow} item={i} id={`sup-${i.id}`} /></td>
                    </tr>
                  ) : null}
                </tbody>
              )
            })}
          </table>
          {empty}
          {more ? <div className="border-t border-[var(--color-border-default)]">{more}</div> : null}
        </div>
        <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">«ثقة القراءة» لكل بند ما تصل من الخادم بعد — راجع البنود بنفسك.</p>
      </section>

      <aside aria-labelledby="est-h" className="flex w-[360px] shrink-0 flex-col gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6">
        <h2 id="est-h" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">الموردين المتوقعين</h2>
        <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">نرشّح الموردين لكل بند من سجل فرق. تقدر تغيّر الاختيار من عمود الموردين.</p>
        {byDept.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-canvas)] p-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[16px] leading-[26px] font-medium">{DEPT_LABEL[k] || 'غير مصنّف'}</span>
                <span className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{v.items} بند</span>
              </div>
              <span className="font-[family-name:var(--font-display)] text-[16px] leading-[24px] font-semibold">{v.suppliers.size} مورد</span>
            </div>
            {v.direct.size ? <div className="flex items-center gap-1.5"><EvidenceBadge level="Strong" label="دليل مباشر" /><span className="text-[12px] font-medium text-[var(--color-text-success)]">{v.direct.size} منهم</span></div> : null}
          </div>
        ))}
        {needsCheck.length ? (
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-warning)] p-3 text-[14px] leading-[22px] text-[var(--color-text-warning)]">
            <Icon name="alert" size={18} className="shrink-0" />{needsCheck.length} بند ما نرسلها لأي مورد قبل ما تتأكد منها.
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite">{readyItems.length} بند جاهز</p>
      </aside>
    </div>
  )
}

export default ReviewPage
