import { useEffect, useState } from 'react'
import type { NavProps } from '../types'
import { useProcurement } from '../procurementContext'
import { listBuyerRfqs, formatRfqTitle, type ConstructionRfqSummary } from '../api/constructionClient'
import { rfqProjectName } from '../lib/rfqIdentity'

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  SENT: { label: 'يستقبل العروض', bg: '#e4f5ea', fg: '#17703c' },
  PARTIALLY_SENT: { label: 'أُرسل جزئيًا', bg: '#ffe8df', fg: '#c2410c' },
  DRAFT_NOT_SENT: { label: 'مسودة', bg: '#efefec', fg: '#5e5e5b' },
  CLOSED: { label: 'أُغلق الاستلام', bg: '#efefec', fg: '#5e5e5b' },
  AWARDED: { label: 'تمت الترسية', bg: '#e3f8ee', fg: '#0f8a5f' },
  CANCELLED: { label: 'ملغي', bg: '#f8e4e8', fg: '#a3364b' },
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
        <p className="text-[14px] leading-[22px]" style={{ color: '#5e5e5b' }}>{rows ? `${rows.length} طلب` : ''}</p>
      </div>
      {error ? <p className="rounded-[12px] px-4 py-3 text-right" style={{ background: '#f8e4e8', color: '#a3364b' }}>{error}</p> : null}
      {!rows && !error ? <p className="text-right" style={{ color: '#5e5e5b' }}>جارٍ التحميل…</p> : null}
      <div className="flex flex-col overflow-hidden rounded-[24px] border bg-white" style={{ borderColor: '#e6e6e2' }}>
        {(rows || []).map((r) => {
          const st = STATUS[String(r.award_status === 'APPROVED' ? 'AWARDED' : r.status)] || { label: r.status, bg: '#efefec', fg: '#5e5e5b' }
          const title = rfqProjectName({ delivery: r.delivery }) || formatRfqTitle(r)
          return (
            <button key={r.id} type="button" onClick={() => open(r.id)} className="flex w-full items-center justify-end gap-4 border-b px-5 py-4 text-right hover:bg-[#f7f7f5]" style={{ borderColor: '#e6e6e2' }}>
              <span className="rounded-full px-2.5 py-1 text-[14px] font-medium" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              <span className="text-[14px] tabular-nums" style={{ color: '#5e5e5b' }}>{r.response_count} عرض · {r.supplier_count} مورد · {r.line_count} بند</span>
              <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{title}</span>
              <span className="text-[12px] tabular-nums" style={{ color: '#8f8f8b' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh' })}</span>
            </button>
          )
        })}
        {rows && rows.length === 0 ? <p className="p-6 text-right" style={{ color: '#5e5e5b' }}>لا توجد طلبات بعد.</p> : null}
      </div>
    </div>
  )
}
