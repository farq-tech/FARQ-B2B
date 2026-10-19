import { useMemo, useState } from 'react'
import { waNumber, type TargetRow } from '../../api/targetingClient'
import { Badge, Button } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'
import { completenessOf, hasPoint, safeName } from './map/model'

type Sort = 'relevance' | 'data' | 'location'

type Props = {
  rows: TargetRow[]
  shown: number
  total: number
  query: string
  district?: string
  street?: string
  selected: ReadonlySet<string>
  disabled?: boolean
  onOpen: (row: TargetRow) => void
  onToggle: (row: TargetRow) => void
  onShowMore: () => void
  onLoadMore?: () => void
  hasMore?: boolean
}

const statusRank = (row: TargetRow) => row.status_class === 'open' ? 0 : row.status_class?.startsWith('closed') || row.hudhud_deleted ? 2 : 1
const fitRank = (row: TargetRow) => row.ai === 'L' ? 0 : row.ai === 'M' ? 1 : row.ai === 'N' ? 3 : 2
const sourceRank = (row: TargetRow) => row.source_count || 0

function reasonFor(row: TargetRow, query: string, district?: string, street?: string) {
  if (row.reason?.trim()) return row.reason.trim()
  const scope = street || district
  if (row.match === 'product') return scope ? `يسمي النشاط المطلوب ضمن نطاق ${scope}` : 'يسمي المنتج أو النشاط المطلوب'
  if (row.match === 'seller') return scope ? `يندرج ضمن نشاط مناسب في ${scope}` : 'يندرج ضمن نشاط يبيع عادةً هذا الطلب'
  return scope ? `ضمن نطاق ${scope} المختار` : query ? 'ضمن نتائج الطلب الحالية' : 'ضمن دليل السوق الحالي'
}

function dataState(row: TargetRow) {
  if (row.status_class?.startsWith('closed') || row.hudhud_deleted) return { label: 'الحالة تحتاج تحقق', tone: 'Warning' as const }
  if (!hasPoint(row) || row.district_reliable === false) return { label: 'الموقع يحتاج تحقق', tone: 'Warning' as const }
  if ((row.source_count || 0) === 1) return { label: 'مصدر واحد', tone: 'Neutral' as const }
  if ((completenessOf(row) || 0) < 50) return { label: 'بيانات ناقصة', tone: 'Neutral' as const }
  return { label: 'بيانات كافية للمراجعة', tone: 'Success' as const }
}

export default function ReviewList({ rows, shown, total, query, district, street, selected, disabled, onOpen, onToggle, onShowMore, onLoadMore, hasMore }: Props) {
  const [sort, setSort] = useState<Sort>('relevance')
  const ordered = useMemo(() => rows.map((row, index) => ({ row, index })).sort((a, b) => {
    if (sort === 'data') return (completenessOf(b.row) || 0) - (completenessOf(a.row) || 0) || sourceRank(b.row) - sourceRank(a.row) || a.index - b.index
    if (sort === 'location') return Number(hasPoint(b.row)) - Number(hasPoint(a.row)) || Number(b.row.district_reliable !== false) - Number(a.row.district_reliable !== false) || a.index - b.index
    return statusRank(a.row) - statusRank(b.row) || fitRank(a.row) - fitRank(b.row) || (completenessOf(b.row) || 0) - (completenessOf(a.row) || 0) || a.index - b.index
  }), [rows, sort])
  const visible = ordered.slice(0, shown)
  const scope = street || district

  return (
    <section aria-label="قائمة مراجعة الجهات" className="flex flex-col">
      <header className="m-3 rounded-[14px] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="m-0 text-[15px] leading-[24px] font-semibold">قائمة مراجعة الجهات</h2>
            <p className="m-0 mt-1 text-[12px] leading-[19px] text-[var(--color-text-secondary)]">{scope ? `النطاق: ${scope}. ` : ''}رتّب الجهات للمراجعة قبل إنشاء طلب أو قائمة حملة.</p>
          </div>
          <span className="rounded-full bg-[var(--color-bg-surface)] px-2.5 py-1 text-[12px] font-medium tabular-nums">{visible.length.toLocaleString('en-US')} من {total.toLocaleString('en-US')}</span>
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-1.5 border-0 p-0" aria-label="ترتيب قائمة المراجعة">
          <legend className="sr-only">رتّب القائمة</legend>
          {([
            ['relevance', 'الأقرب للطلب'],
            ['data', 'الأكمل بيانات'],
            ['location', 'موقع أوضح'],
          ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)} className={`min-h-9 rounded-full border px-3 text-[12px] font-medium ${sort === value ? 'border-[var(--map-ink)] bg-[var(--map-ink)] text-white' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)]'} ${FOCUS_RING}`}>{label}</button>)}
        </fieldset>
      </header>
      <ul className="m-0 list-none border-t border-[var(--color-border-default)] p-0">
        {visible.map(({ row }) => {
          const state = dataState(row)
          const selectedNow = selected.has(row.poi_key)
          const canChoose = Boolean(waNumber(row))
          const completion = completenessOf(row)
          return <li key={row.poi_key} className="border-b border-[var(--color-border-default)] px-4 py-3">
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={selectedNow} disabled={disabled || !canChoose} onChange={() => onToggle(row)} aria-label={`أضف ${safeName(row)} إلى قائمة المراجعة`} title={canChoose ? undefined : 'لا توجد إشارة واتساب برقم صالح'} className={`mt-1 size-5 shrink-0 accent-[var(--map-ink)] disabled:opacity-50 ${FOCUS_RING}`} />
              <button type="button" disabled={disabled} onClick={() => onOpen(row)} className={`min-w-0 flex-1 text-start disabled:opacity-60 ${FOCUS_RING}`}>
                <span className="block truncate text-[15px] leading-[24px] font-semibold">{safeName(row)}</span>
                <span className="mt-0.5 block text-[12px] leading-[19px] text-[var(--color-text-secondary)]">لماذا ظهرت: {reasonFor(row, query, district, street)}</span>
                <span className="mt-1 block truncate text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{[row.district_ar, row.street_ar].filter(Boolean).join(' · ') || 'الموقع غير مفصل'}</span>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={state.tone} showDot={false} label={state.label} className="text-[11px] leading-[16px]" />
                {completion != null ? <span className="text-[11px] text-[var(--color-text-tertiary)]">اكتمال {completion}٪</span> : null}
              </div>
            </div>
          </li>
        })}
      </ul>
      {shown < ordered.length ? <div className="px-4 py-3"><Button variant="Ghost" size="S" onClick={onShowMore}>اعرض {(Math.min(25, ordered.length - shown)).toLocaleString('en-US')} أكثر</Button></div> : null}
      {hasMore && shown >= ordered.length && onLoadMore ? <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12px] text-[var(--color-text-secondary)]"><span>هذه الدفعة المحمّلة فقط.</span><Button variant="Ghost" size="S" disabled={disabled} onClick={onLoadMore}>حمّل المزيد</Button></div> : null}
    </section>
  )
}
