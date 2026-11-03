'use client'

import { Check, ExternalLink, MailOpen, Mail, MapPinned, Scale } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, formatSar } from '@/lib/format'
import { inboxMapHref, kindNote, requestFor } from '@/lib/inbox-feed'
import { counted, numberFormat, useCities } from '@/lib/insights-api'
import { useAppStore } from '@/lib/store'
import type { InboxMessage } from '@/lib/types'
import { messageBusiness } from './message-business'
import { SourceLabel } from './source-label'

export function MessageDetail({ message }: { message: InboxMessage }) {
  const { requests, markRead, updateMessage } = useAppStore()
  const [draft, setDraft] = useState(message.replyDraft ?? '')
  const [saved, setSaved] = useState(false)
  const cities = useCities()
  const request = requestFor(requests, message.requestId)
  // the business as the request saved it from the map; no number is shown here, for a sample or a real reply
  const b = messageBusiness(message, request)
  const note = kindNote(message.kind)
  const total = message.quote?.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) ?? 0

  return (
    <article className="flex flex-col gap-4 rounded-2xl border bg-card p-4 lg:p-5">
      <header className="flex flex-col gap-2">
        <SourceLabel message={message} />
        <h2 className="text-xl font-bold text-balance">{b.name ?? 'غير متاح'}</h2>
        {/* only the parts the request knows, so a missing district never leaves «·  ·» */}
        {b.category || b.district ? <p className="text-xs text-muted-foreground">{[b.category, b.district].filter(Boolean).join(' · ')}</p> : null}
      </header>

      {/* the thread reads like a chat: who wrote and when above the bubble, the message at reading size with its own
          line breaks, so a long supplier reply is not a grey block of small text */}
      <figure className="flex max-w-xl flex-col gap-1 self-start">
        <figcaption className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{b.name ?? 'غير متاح'}</span> · <time dateTime={message.receivedAt}>{formatDateTime(message.receivedAt)}</time>
          {message.origin === 'whatsapp' ? ' · واتساب' : null}
        </figcaption>
        {/* a photo, a voice note or a file is named, not shown: Atlas keeps only the words of a reply */}
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
        {message.body.trim() ? <blockquote className="whitespace-pre-line rounded-2xl rounded-ss-sm bg-muted px-4 py-3 text-base leading-7">{message.body}</blockquote> : null}
      </figure>

      {message.quote ? (
        <section aria-labelledby="quote-title" className="flex flex-col gap-2 rounded-xl border p-3">
          <h3 id="quote-title" className="text-sm font-semibold">
            عرض السعر
          </h3>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-start font-medium">البند</th>
                <th className="py-1 text-start font-medium">الكمية</th>
                <th className="py-1 text-end font-medium">سعر الوحدة</th>
              </tr>
            </thead>
            <tbody>
              {message.quote.lines.map((l) => (
                <tr key={l.name} className="border-t">
                  <td className="py-1.5">{l.name}</td>
                  <td className="py-1.5 tabular-nums">{numberFormat.format(l.qty)}</td>
                  <td className="py-1.5 text-end tabular-nums">{formatSar(l.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* the figure a buyer looks for first, at a size it can be found: the total on its own row, then the terms */}
          <p className="flex items-baseline justify-between gap-2 border-t pt-2">
            <span className="text-sm font-semibold">الإجمالي</span>
            <span className="text-lg font-bold tabular-nums">{formatSar(total)}</span>
          </p>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div className="flex gap-1"><dt>التسليم</dt><dd className="font-semibold text-foreground">{message.quote.deliveryDays != null ? `خلال ${counted(message.quote.deliveryDays, 'day')}` : 'غير متاح'}</dd></div>
            <div className="flex gap-1"><dt>صلاحية العرض</dt><dd className="font-semibold text-foreground">{message.quote.validity || 'غير متاح'}</dd></div>
          </dl>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {request ? (
          <Button variant="outline" nativeButton={false} render={<Link href={`/requests/${request.id}`} />}>
            {message.quote ? <Scale data-icon="inline-start" /> : <ExternalLink data-icon="inline-start" />}
            {message.quote ? 'مقارنة العروض في الطلب' : 'فتح الطلب المرتبط'}
          </Button>
        ) : null}
        {/* the business on the map, in the request's city: from the reply to the place it came from */}
        {request && b.name ? (
          <Button variant="outline" nativeButton={false} render={<Link href={inboxMapHref(request, b.name, cities)} />}>
            <MapPinned data-icon="inline-start" />اعرضها على الخريطة
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
