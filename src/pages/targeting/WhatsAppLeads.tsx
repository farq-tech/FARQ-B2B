import { useEffect, useMemo, useState } from 'react'
import { listMarketingInteractions, type MarketingInteraction } from '../../api/marketingClient'
import { Badge, Button, Chip, Icon, TopBar, useIsMobile, type BadgeTone } from '../../ui'

type Filter = 'ALL' | 'INTERESTED' | 'NOT_INTERESTED'

const formatDate = (value: string) => new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export default function WhatsAppLeads({ onBack }: { onBack: () => void }) {
  const mobile = useIsMobile()
  const [rows, setRows] = useState<MarketingInteraction[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<Filter>('ALL')
  const refresh = () => {
    setFailed(false)
    listMarketingInteractions().then(setRows).catch(() => { setRows([]); setFailed(true) })
  }
  useEffect(refresh, [])
  const count = (outcome: Filter) => outcome === 'ALL' ? (rows?.length || 0) : (rows || []).filter((row) => row.outcome === outcome).length
  const shown = useMemo(() => (rows || []).filter((row) => filter === 'ALL' || row.outcome === filter), [rows, filter])

  return (
    <div className="flex min-w-0 flex-col">
      <TopBar parent="خريطة الفرص" onParent={onBack} title="فرص واتساب" />
      <div className={mobile ? 'flex min-w-0 flex-col gap-3 px-3 py-3' : 'flex flex-col gap-6 px-8 py-8'}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className={`font-[family-name:var(--font-display)] font-semibold ${mobile ? 'text-[24px] leading-[32px]' : 'text-[32px] leading-[44px]'}`}>فرص واتساب</h1>
            <p className="mt-1 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">التفاعلات الموثقة من قوالب الحملة. لا تظهر أرقام المستلمين هنا.</p>
          </div>
          <Button variant="Secondary" size={mobile ? 'S' : 'M'} icon="refresh" onClick={refresh}>تحديث</Button>
        </div>

        <div className="grid grid-cols-3 gap-2" aria-label="ملخص تفاعلات واتساب">
          <Summary label="كل التفاعلات" value={count('ALL')} tone="Neutral" />
          <Summary label="مهتم" value={count('INTERESTED')} tone="Success" />
          <Summary label="موقوف" value={count('NOT_INTERESTED')} tone="Danger" />
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية فرص واتساب">
          {([{ key: 'ALL', label: 'الكل' }, { key: 'INTERESTED', label: 'مهتم' }, { key: 'NOT_INTERESTED', label: 'غير مهتم' }] as { key: Filter; label: string }[]).map((item) => (
            <Chip key={item.key} label={`${item.label} ${count(item.key)}`} selected={filter === item.key} onClick={() => setFilter(item.key)} />
          ))}
        </div>

        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
          {rows === null ? <p role="status" className="px-5 py-4 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">جارٍ تحميل التفاعلات…</p> : null}
          {failed ? <p role="alert" className="flex items-center gap-2 px-5 py-4 text-[14px] leading-[22px] text-[var(--color-text-danger)]"><Icon name="alert" size={18} />تعذّر جلب فرص واتساب. تأكد من صلاحية حسابك ثم حاول مجددًا.</p> : null}
          {shown.map((row) => <InteractionRow key={row.id} row={row} mobile={mobile} />)}
          {rows && !failed && !shown.length ? <p className="px-5 py-5 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">ما وصل أي تفاعل يطابق هذه الحالة بعد.</p> : null}
        </div>
        <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">«مهتم» يفتح فرصة للمتابعة اليدوية فقط. «غير مهتم» يوقف الرسائل التسويقية اللاحقة لهذا المستلم.</p>
      </div>
    </div>
  )
}

function Summary({ label, value, tone }: { label: string; value: number; tone: BadgeTone }) {
  return <div className="rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] px-3 py-3"><Badge tone={tone} label={label} className="mb-2 text-[12px]" /><strong className="block text-[22px] leading-[28px]">{new Intl.NumberFormat('ar-SA').format(value)}</strong></div>
}

function InteractionRow({ row, mobile }: { row: MarketingInteraction; mobile: boolean }) {
  const interested = row.outcome === 'INTERESTED'
  return <div className={mobile ? 'flex items-start justify-between gap-3 border-t border-[var(--color-border-default)] px-3 py-3' : 'grid grid-cols-[minmax(0,1.5fr)_180px_180px] items-center gap-4 border-t border-[var(--color-border-default)] px-5 py-4'}>
    <div className="min-w-0"><p className="truncate text-[16px] leading-[26px] font-medium">{row.campaign_name}</p><p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{formatDate(row.occurred_at)}</p></div>
    {!mobile ? <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{interested ? 'فرصة متابعة يدوية' : 'أوقفت التسويق'}</p> : null}
    <span className="shrink-0"><Badge tone={interested ? 'Success' : 'Danger'} label={interested ? 'مهتم' : 'غير مهتم'} /></span>
  </div>
}
