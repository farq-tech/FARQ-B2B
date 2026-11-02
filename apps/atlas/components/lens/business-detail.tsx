import { numberFormat } from '@/lib/insights-api'
import type { PublicDirectoryEntity } from '@/lib/live-directory'

const sar = (value: number) => `${numberFormat.format(Math.round(value))} ر.س`

/**
 * One business's directory details, all from Farq (no source is ever named): its official description, delivery-app
 * signals, and the operational facts the directory carries. Only present fields are shown; a missing one is left out,
 * never «0». Contacts are never shown — the directory withholds them from the browser.
 */
export function BusinessDetail({ row }: { row: PublicDirectoryEntity }) {
  const facts: [string, string][] = []
  if (row.operatingHours) facts.push(['ساعات العمل', row.operatingHours])
  if (row.paymentMethods) facts.push(['طرق الدفع', row.paymentMethods])
  if (row.serviceLanguages) facts.push(['لغات الخدمة', row.serviceLanguages])
  if (row.branchCount) facts.push(['الفروع', row.branchCount])
  if (row.employeeCount) facts.push(['الموظفون', row.employeeCount])
  if (row.floor) facts.push(['الدور', row.floor])
  if (row.buildingUse) facts.push(['استخدام المبنى', row.buildingUse])

  const delivery: [string, string][] = []
  if (row.deliveryRating != null) {
    const count = row.deliveryRateCount != null ? ` (${numberFormat.format(row.deliveryRateCount)})` : ''
    delivery.push(['التقييم', `${numberFormat.format(Math.round(row.deliveryRating * 10) / 10)} / 5${count}`])
  }
  if (row.deliveryFee != null) delivery.push(['رسوم التوصيل', sar(row.deliveryFee)])
  if (row.deliveryMinOrder != null) delivery.push(['أقل طلب', sar(row.deliveryMinOrder)])
  if (row.deliveryEta) delivery.push(['زمن التوصيل', row.deliveryEta])

  const empty = !row.description && facts.length === 0 && delivery.length === 0
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
      {row.description && <p className="whitespace-pre-line leading-relaxed">{row.description}</p>}
      {facts.map(([label, value]) => (
        <p key={label}><span className="text-muted-foreground">{label}:</span> <span className="font-medium">{value}</span></p>
      ))}
      {delivery.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border bg-background p-2">
          <p className="font-semibold">التوصيل</p>
          {delivery.map(([label, value]) => (
            <p key={label}><span className="text-muted-foreground">{label}:</span> <span className="font-medium">{value}</span></p>
          ))}
        </div>
      )}
      {empty && <p className="text-muted-foreground">لا تفاصيل إضافية متاحة لهذه المنشأة.</p>}
    </div>
  )
}
