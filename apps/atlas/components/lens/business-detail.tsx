'use client'

import { useState } from 'react'
import { numberFormat } from '@/lib/insights-api'
import type { PublicDirectoryEntity } from '@/lib/live-directory'

const sar = (value: number) => `${numberFormat.format(Math.round(value))} ر.س`

// the directory's free text sometimes carries Arabic-Indic or Persian digits («٩ ص - ١١ م»); Atlas shows 0-9 everywhere
const INDIC = /[٠-٩۰-۹]/g
const latin = (text: string) => text.replace(INDIC, (digit) => String((digit.charCodeAt(0) & 0xf) % 10))
/** A directory text field: a bare count goes through numberFormat, any other text keeps its words with 0-9 digits. */
function fact(text: string): string {
  const plain = latin(text).trim()
  return /^\d[\d,]*$/.test(plain) ? numberFormat.format(Number(plain.replace(/,/g, ''))) : plain
}

// a description longer than this opens folded, so the facts under it are seen without scrolling
const LONG = 220

/**
 * One business's directory details, all from Farq (no source is ever named): its official description, delivery-app
 * signals, and the operational facts the directory carries. Only present fields are shown; a missing one is left out,
 * never «0». Contacts are never shown — the directory withholds them from the browser.
 */
export function BusinessDetail({ row }: { row: PublicDirectoryEntity }) {
  const [open, setOpen] = useState(false)
  const facts: [string, string][] = []
  if (row.operatingHours) facts.push(['ساعات العمل', fact(row.operatingHours)])
  if (row.paymentMethods) facts.push(['طرق الدفع', fact(row.paymentMethods)])
  if (row.serviceLanguages) facts.push(['لغات الخدمة', fact(row.serviceLanguages)])
  if (row.branchCount) facts.push(['الفروع', fact(row.branchCount)])
  if (row.employeeCount) facts.push(['الموظفون', fact(row.employeeCount)])
  if (row.floor) facts.push(['الدور', fact(row.floor)])
  if (row.buildingUse) facts.push(['استخدام المبنى', fact(row.buildingUse)])

  const delivery: [string, string][] = []
  if (row.deliveryRating != null) {
    const count = row.deliveryRateCount != null ? ` (${numberFormat.format(row.deliveryRateCount)})` : ''
    delivery.push(['التقييم', `${numberFormat.format(Math.round(row.deliveryRating * 10) / 10)} / 5${count}`])
  }
  if (row.deliveryFee != null) delivery.push(['رسوم التوصيل', sar(row.deliveryFee)])
  if (row.deliveryMinOrder != null) delivery.push(['أقل طلب', sar(row.deliveryMinOrder)])
  if (row.deliveryEta) delivery.push(['زمن التوصيل', fact(row.deliveryEta)])

  const description = row.description ? latin(row.description) : ''
  const folded = description.length > LONG && !open
  const empty = !description && facts.length === 0 && delivery.length === 0
  return (
    <div className="mb-2 flex flex-col gap-2.5 rounded-lg border bg-muted/30 p-3 text-sm">
      {description && (
        <div>
          <p className={folded ? 'line-clamp-3 whitespace-pre-line leading-relaxed' : 'whitespace-pre-line leading-relaxed'}>{description}</p>
          {description.length > LONG && (
            <button type="button" onClick={() => setOpen((was) => !was)} aria-expanded={open}
              className="mt-1 rounded-md font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
              {open ? 'أقل' : 'اقرأ الوصف كاملاً'}
            </button>
          )}
        </div>
      )}
      {/* label and value in two aligned columns, so a list of facts is scanned, not read line by line */}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {delivery.length > 0 && (
        <section aria-label="التوصيل" className="flex flex-col gap-1.5 rounded-md border bg-background p-2">
          <p className="font-semibold">التوصيل</p>
          <dl className="grid grid-cols-2 gap-1.5">
            {delivery.map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted/40 px-2 py-1">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {empty && <p className="text-muted-foreground">لا تفاصيل إضافية متاحة لهذه المنشأة.</p>}
    </div>
  )
}
