'use client'

import { Check, Timer, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { businessName } from '@/lib/business-name'
import { formatSar } from '@/lib/format'
import { counted, numberFormat } from '@/lib/insights-api'
import { quoteHighlights, quoteTotal as total } from '@/lib/quote-highlights'
import type { InboxMessage, RequestItem } from '@/lib/types'
import { cn } from '@/lib/utils'

interface QuoteComparisonProps {
  quotes: InboxMessage[]
  acceptedId?: string
  canDecide: boolean
  onAccept: (messageId: string) => void
  /** The request the quotes answer: its saved businesses name each supplier as the map did. */
  request?: Pick<RequestItem, 'liveBusinesses'>
}

export function QuoteComparison({ quotes, acceptedId, canDecide, onAccept, request }: QuoteComparisonProps) {
  if (!quotes.length) return null
  const sorted = [...quotes].sort((a, b) => total(a) - total(b))
  // highlights from the suppliers' own figures only (lib/quote-highlights.ts): none with a single quote, ties shared
  const { lowest, fastest, overLowest } = quoteHighlights(quotes)

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="quotes-title">
      <div>
        <h2 id="quotes-title" className="font-semibold">
          مقارنة العروض المستلمة
        </h2>
        <p className="text-xs text-muted-foreground">مرتبة من الأقل سعراً. الإجمالي لبنود كل عرض كما أرسلها المورد، بالريال السعودي.</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {sorted.map((m) => {
          const name = businessName(m.businessId, request)
          const accepted = acceptedId === m.id
          return (
            <li key={m.id} className={cn('flex flex-col gap-3 rounded-xl border p-3.5', accepted ? 'border-primary bg-accent/40' : 'bg-background/50')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    التوريد {m.quote?.deliveryDays != null ? `خلال ${counted(m.quote.deliveryDays, 'day')}` : 'غير متاح'} · صلاحية {m.quote?.validity}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {lowest.has(m.id) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                      <Trophy className="size-3" aria-hidden />
                      الأقل سعراً
                    </span>
                  )}
                  {fastest.has(m.id) && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-card px-2 py-0.5 text-xs font-semibold text-primary">
                      <Timer className="size-3" aria-hidden />
                      الأسرع توريداً
                    </span>
                  )}
                </div>
              </div>
              <table className="w-full text-sm">
                <caption className="sr-only">بنود عرض {name}</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="pb-1 text-start font-normal">البند</th>
                    <th scope="col" className="pb-1 text-end font-normal">سعر الوحدة</th>
                  </tr>
                </thead>
                <tbody>
                  {m.quote?.lines.map((l) => (
                    <tr key={l.name} className="border-t">
                      <td className="py-1.5">
                        {l.name} <span className="text-xs text-muted-foreground">× {numberFormat.format(l.qty)}</span>
                      </td>
                      <td className="py-1.5 text-end tabular-nums">{formatSar(l.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="pt-2">الإجمالي</td>
                    <td className="pt-2 text-end tabular-nums">{formatSar(total(m))}</td>
                  </tr>
                  {(overLowest.get(m.id) ?? 0) > 0 && (
                    <tr>
                      <td colSpan={2} className="pt-0.5 text-end text-xs font-normal text-muted-foreground tabular-nums">أعلى من الأقل بـ {formatSar(overLowest.get(m.id)!)}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
              {accepted ? (
                <p className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  <Check className="size-4" aria-hidden />
                  تم اعتماد هذا العرض
                </p>
              ) : canDecide ? (
                <Button variant={lowest.has(m.id) ? 'default' : 'outline'} onClick={() => onAccept(m.id)}>
                  اعتماد هذا العرض
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
