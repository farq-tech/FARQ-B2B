'use client'

import { Check, ExternalLink, MailOpen, Mail, Scale } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { businessById, districtById } from '@/lib/mock-data'
import { formatDateTime, formatPhone, formatSar } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { InboxMessage } from '@/lib/types'
import { SourceLabel } from './source-label'

export function MessageDetail({ message }: { message: InboxMessage }) {
  const { requests, markRead, updateMessage } = useAppStore()
  const [draft, setDraft] = useState(message.replyDraft ?? '')
  const [saved, setSaved] = useState(false)
  const b = businessById.get(message.businessId)
  const request = requests.find((r) => r.id === message.requestId)
  const total = message.quote?.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) ?? 0

  return (
    <article className="flex flex-col gap-4 rounded-2xl border bg-card p-4 lg:p-5">
      <header className="flex flex-col gap-2">
        <SourceLabel message={message} />
        <h2 className="text-xl font-bold text-balance">{b?.name}</h2>
        <p className="text-xs text-muted-foreground">
          {b ? `${b.category} · ${districtById.get(b.districtId)?.name ?? ''} · ` : ''}
          <span dir="ltr">{formatPhone(b?.whatsapp ?? null)}</span> · {formatDateTime(message.receivedAt)}
        </p>
      </header>

      <div className="max-w-lg self-start rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed">{message.body}</div>

      {message.quote ? (
        <section aria-labelledby="quote-title" className="flex flex-col gap-2 rounded-xl border p-3">
          <h3 id="quote-title" className="text-sm font-semibold">
            عرض السعر
          </h3>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-right font-medium">البند</th>
                <th className="py-1 text-right font-medium">الكمية</th>
                <th className="py-1 text-left font-medium">سعر الوحدة</th>
              </tr>
            </thead>
            <tbody>
              {message.quote.lines.map((l) => (
                <tr key={l.name} className="border-t">
                  <td className="py-1.5">{l.name}</td>
                  <td className="py-1.5 tabular-nums">{l.qty}</td>
                  <td className="py-1.5 text-left tabular-nums">{formatSar(l.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="flex flex-wrap justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
            <span>
              الإجمالي: <span className="font-semibold text-foreground tabular-nums">{formatSar(total)}</span>
            </span>
            <span>
              التسليم خلال {message.quote.deliveryDays} أيام · صلاحية {message.quote.validity}
            </span>
          </p>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {request ? (
          <Button variant="outline" nativeButton={false} render={<Link href={`/requests/${request.id}`} />}>
            {message.quote ? <Scale data-icon="inline-start" /> : <ExternalLink data-icon="inline-start" />}
            {message.quote ? 'مقارنة العروض في الطلب' : 'فتح الطلب المرتبط'}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => markRead(message.id, !message.unread)}>
          {message.unread ? <MailOpen data-icon="inline-start" /> : <Mail data-icon="inline-start" />}
          {message.unread ? 'تحديد كمقروء' : 'تحديد كغير مقروء'}
        </Button>
      </div>

      <form
        className="flex flex-col gap-2 border-t pt-4"
        onSubmit={(e) => {
          e.preventDefault()
          updateMessage(message.id, { replyDraft: draft })
          setSaved(true)
          toast.success('تم حفظ مسودة الرد', { description: 'لم يُرسل أي رد.' })
        }}
      >
        <label htmlFor="reply-draft" className="text-sm font-semibold">
          مسودة رد
        </label>
        <Textarea
          id="reply-draft"
          rows={3}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setSaved(false)
          }}
          placeholder="اكتب ردك هنا لتحفظه كمسودة"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">لا يُرسل أي رد من هنا. المسودة محفوظة على هذا الجهاز للمراجعة.</p>
          <Button type="submit" size="sm" disabled={!draft.trim() || saved}>
            {saved ? <Check data-icon="inline-start" /> : null}
            {saved ? 'تم حفظ المسودة' : 'حفظ مسودة الرد'}
          </Button>
        </div>
      </form>
    </article>
  )
}
