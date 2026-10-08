import { useEffect, useState } from 'react'
import type { NavProps } from '../types'
import { useProcurement } from '../procurementContext'
import { listBuyerRfqs, formatRfqTitle, type ConstructionRfqSummary } from '../api/constructionClient'
import { rfqProjectName } from '../lib/rfqIdentity'

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  SENT: { label: 'يستقبل العروض', bg: 'var(--color-bg-success)', fg: 'var(--color-text-success)' },
  PARTIALLY_SENT: { label: 'أُرسل جزئيًا', bg: 'var(--color-bg-warning)', fg: 'var(--color-text-warning)' },
  DRAFT_NOT_SENT: { label: 'مسودة', bg: 'var(--color-bg-surface-2)', fg: 'var(--color-text-secondary)' },
  CLOSED: { label: 'أُغلق الاستلام', bg: 'var(--color-bg-surface-2)', fg: 'var(--color-text-secondary)' },
  AWARDED: { label: 'تمت الترسية', bg: 'var(--color-bg-info)', fg: 'var(--color-text-link)' },
  CANCELLED: { label: 'ملغي', bg: 'var(--color-bg-danger)', fg: 'var(--color-text-danger)' },
}

export function RfqListV2({ navigate }: NavProps) {
  const { setSelectedRfqId } = useProcurement()
  const [rows, setRows] = useState<ConstructionRfqSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    listBuyerRfqs().then((o) => setRows(o.rfqs || [])).catch((e) => setError(e instanceof Error ? e.message : 'تعذر تحميل الطلبات'))
  }, [])
  const open = (id: string) => { setSelectedRfqId(id); navigate('rfq-detail') }
  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col items-end gap-1 text-right">
        <h1 className="font-[Readex_Pro] text-[32px] leading-[48px] font-bold">طلبات التسعير</h1>
        <p className="text-[14px] leading-[22px]" style={{ color: 'var(--color-text-secondary)' }}>{rows ? `${rows.length} طلب` : ''}</p>
      </div>
      {error ? <p className="rounded-[12px] px-4 py-3 text-right" style={{ background: 'var(--color-bg-danger)', color: 'var(--color-text-danger)' }}>{error}</p> : null}
      {!rows && !error ? <p className="text-right" style={{ color: 'var(--color-text-secondary)' }}>جارٍ التحميل…</p> : null}
      <div className="flex flex-col overflow-hidden rounded-[24px] border bg-white" style={{ borderColor: 'var(--color-border-default)' }}>
        {(rows || []).map((r) => {
          const st = STATUS[String(r.award_status === 'APPROVED' ? 'AWARDED' : r.status)] || { label: r.status, bg: 'var(--color-bg-surface-2)', fg: 'var(--color-text-secondary)' }
          const title = rfqProjectName({ delivery: r.delivery }) || formatRfqTitle(r)
          return (
            <button key={r.id} type="button" onClick={() => open(r.id)} className="flex w-full items-center justify-end gap-4 border-b px-5 py-4 text-right hover:bg-[var(--color-bg-canvas)]" style={{ borderColor: 'var(--color-border-default)' }}>
              <span className="rounded-full px-2.5 py-1 text-[14px] font-medium" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              <span className="text-[14px] tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{r.response_count} عرض · {r.supplier_count} مورد · {r.line_count} بند</span>
              <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{title}</span>
              <span className="text-[12px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh' })}</span>
            </button>
          )
        })}
        {rows && rows.length === 0 ? <p className="p-6 text-right" style={{ color: 'var(--color-text-secondary)' }}>لا توجد طلبات بعد.</p> : null}
      </div>
    </div>
  )
}
