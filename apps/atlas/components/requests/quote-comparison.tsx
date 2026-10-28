'use client'

import { Check, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { businessById } from '@/lib/mock-data'
import { formatSar } from '@/lib/format'
import type { InboxMessage } from '@/lib/types'
import { cn } from '@/lib/utils'

interface QuoteComparisonProps {
  quotes: InboxMessage[]
  acceptedId?: string
  canDecide: boolean
  onAccept: (messageId: string) => void
}

const total = (m: InboxMessage) => m.quote?.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) ?? 0

export function QuoteComparison({ quotes, acceptedId, canDecide, onAccept }: QuoteComparisonProps) {
  if (!quotes.length) return null
  const sorted = [...quotes].sort((a, b) => total(a) - total(b))
  const best = sorted[0].id

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="quotes-title">
      <div>
        <h2 id="quotes-title" className="font-semibold">
          مقارنة العروض المستلمة
        </h2>
        <p className="text-xs text-muted-foreground">مرتبة من الأقل سعراً. الأسعار بالريال السعودي.</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {sorted.map((m) => {
          const b = businessById.get(m.businessId)
          const accepted = acceptedId === m.id
          return (
            <li key={m.id} className={cn('flex flex-col gap-3 rounded-xl border p-3.5', accepted ? 'border-primary bg-accent/40' : 'bg-background/50')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{b?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    التوريد خلال {m.quote?.deliveryDays} أيام · صلاحية {m.quote?.validity}
                  </p>
                </div>
                {m.id === best ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    <Trophy className="size-3" aria-hidden />
                    الأقل سعراً
                  </span>
                ) : null}
              </div>
              <table className="w-full text-sm">
                <caption className="sr-only">بنود عرض {b?.name}</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="pb-1 text-right font-normal">البند</th>
                    <th scope="col" className="pb-1 text-left font-normal">سعر الوحدة</th>
                  </tr>
                </thead>
                <tbody>
                  {m.quote?.lines.map((l) => (
                    <tr key={l.name} className="border-t">
                      <td className="py-1.5">
                        {l.name} <span className="text-xs text-muted-foreground">× {l.qty}</span>
                      </td>
                      <td className="py-1.5 text-left tabular-nums">{formatSar(l.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="pt-2">الإجمالي</td>
                    <td className="pt-2 text-left tabular-nums">{formatSar(total(m))}</td>
                  </tr>
                </tfoot>
              </table>
              {accepted ? (
                <p className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  <Check className="size-4" aria-hidden />
                  تم اعتماد هذا العرض
                </p>
              ) : canDecide ? (
                <Button variant={m.id === best ? 'default' : 'outline'} onClick={() => onAccept(m.id)}>
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
