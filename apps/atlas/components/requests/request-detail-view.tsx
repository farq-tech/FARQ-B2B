'use client'

import { AlertCircle, ArrowRight, Check, Copy, FileText, Hand, Megaphone, MessageSquareText } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/shared/modal'
import { Button } from '@/components/ui/button'
import { TEMPLATES, businessById, cityById } from '@/lib/mock-data'
import { formatDate, formatDateTime } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { RequestItem } from '@/lib/types'
import { BusinessListEditor } from './business-list-editor'
import { CampaignEditor, campaignIssues, eligibility, renderTemplate } from './campaign-editor'
import { QuoteComparison } from './quote-comparison'
import { StatusBadge, TypeLabel } from './request-badges'
import { RfqEditor, rfqIssues } from './rfq-editor'

export function RequestDetailView({ id }: { id: string }) {
  const router = useRouter()
  const { requests, inbox, updateRequest, createDraft } = useAppStore()
  const [reviewOpen, setReviewOpen] = useState(false)
  const request = requests.find((r) => r.id === id)

  if (!request) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">الطلب غير موجود</h1>
        <p className="text-sm text-muted-foreground">ربما فُتحت هذه الوصلة من جهاز آخر، أو أزيل التخزين المحلي الذي حُفظت فيه المسودة.</p>
        <Button nativeButton={false} render={<Link href="/requests" />}>
          العودة إلى الطلبات
        </Button>
      </main>
    )
  }

  const editable = request.status === 'draft'
  const replies = inbox.filter((m) => m.requestId === request.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  const quotes = replies.filter((m) => m.quote)
  const patch = (p: Partial<RequestItem>) => updateRequest(request.id, p)

  const changeBusinesses = (ids: string[]) => {
    if (request.campaign) {
      const added = ids.filter((x) => !request.businessIds.includes(x))
      const eligibleAdded = added.filter((x) => {
        const b = businessById.get(x)
        return b && eligibility(b).ok
      })
      patch({
        businessIds: ids,
        campaign: { ...request.campaign, included: [...request.campaign.included.filter((x) => ids.includes(x)), ...eligibleAdded] },
      })
    } else patch({ businessIds: ids })
  }

  const convert = (type: 'rfq' | 'campaign') => {
    const newId = createDraft({ type, businessIds: request.businessIds, cityId: request.cityId, goal: request.goal, query: request.query })
    router.push(`/requests/${newId}`)
  }

  const issues = request.rfq
    ? rfqIssues(request.rfq, request.businessIds.length)
    : request.campaign
      ? campaignIssues(request.campaign)
      : request.businessIds.length
        ? []
        : ['القائمة فارغة.']

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 pb-28 lg:py-8">
      <Link href="/requests" className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4" aria-hidden />
        كل الطلبات
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <TypeLabel type={request.type} />
          <StatusBadge status={request.status} />
        </div>
        {editable ? (
          <label>
            <span className="sr-only">عنوان الطلب</span>
            <input
              value={request.title}
              onChange={(e) => patch({ title: e.target.value })}
              className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-2xl font-bold outline-none hover:border-border focus-visible:border-primary"
            />
          </label>
        ) : (
          <h1 className="text-2xl font-bold text-balance">{request.title}</h1>
        )}
        <p className="text-xs text-muted-foreground">
          {cityById.get(request.cityId)?.name} · أنشئ {formatDate(request.createdAt)}
          {request.query ? ` · من البحث: «${request.query}»` : ''}
        </p>
      </header>

      {request.status === 'needs_decision' || (quotes.length > 0 && request.status !== 'draft') ? (
        <QuoteComparison
          quotes={quotes}
          acceptedId={request.acceptedQuoteId}
          canDecide={request.status === 'needs_decision' || request.status === 'awaiting'}
          onAccept={(mid) => patch({ acceptedQuoteId: mid, status: 'completed' })}
        />
      ) : null}

      {request.campaign && request.status === 'ready_manual' ? (
        <ManualSendPanel request={request} onBackToDraft={() => patch({ status: 'draft', reviewedAt: undefined })} />
      ) : null}

      {request.rfq ? <RfqEditor value={request.rfq} editable={editable} onChange={(rfq) => patch({ rfq })} /> : null}
      {request.campaign ? (
        <CampaignEditor value={request.campaign} businessIds={request.businessIds} liveBusinesses={request.liveBusinesses} editable={editable} onChange={(campaign) => patch({ campaign })} />
      ) : null}

      <BusinessListEditor
        title={request.type === 'rfq' ? 'الموردون المدعوون' : request.type === 'campaign' ? 'المنشآت المستهدفة' : 'المنشآت في القائمة'}
        cityId={request.cityId}
        businessIds={request.businessIds}
        liveBusinesses={request.liveBusinesses}
        editable={editable}
        onChange={changeBusinesses}
      />

      {request.type === 'list' ? (
        <label className="flex flex-col gap-1 rounded-2xl border bg-card p-4">
          <span className="font-semibold">ملاحظات</span>
          <textarea
            disabled={!editable}
            rows={3}
            value={request.notes ?? ''}
            onChange={(e) => patch({ notes: e.target.value })}
            className="rounded-lg border bg-background p-2.5 text-sm outline-none focus-visible:border-primary disabled:bg-muted/40"
          />
        </label>
      ) : null}

      {replies.length ? (
        <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4" aria-labelledby="replies-title">
          <h2 id="replies-title" className="font-semibold">
            الردود ({replies.length})
          </h2>
          <ul className="flex flex-col divide-y">
            {replies.map((m) => (
              <li key={m.id}>
                <Link href={`/inbox?m=${m.id}`} className="flex items-start gap-3 py-2.5 hover:bg-muted/40">
                  <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {businessById.get(m.businessId)?.name}
                      {m.unread ? <span className="size-2 rounded-full bg-primary" aria-label="غير مقروء" /> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.body}</p>
                  </div>
                  <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={m.receivedAt}>
                    {formatDateTime(m.receivedAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editable ? (
        <div className="fixed inset-x-3 bottom-[4.5rem] z-30 lg:right-[calc(15rem+1rem)] lg:bottom-4 lg:left-4">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-lg">
            {issues.length ? (
              <p className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
                {issues[0]}
              </p>
            ) : (
              <p className="flex-1 text-xs text-muted-foreground">جاهز للمراجعة. لن يُرسل شيء قبل تأكيدك.</p>
            )}
            {request.type === 'list' ? (
              <>
                <Button variant="outline" onClick={() => convert('rfq')} disabled={!request.businessIds.length}>
                  <FileText data-icon="inline-start" />
                  تحويل لطلب تسعير
                </Button>
                <Button variant="outline" onClick={() => convert('campaign')} disabled={!request.businessIds.length}>
                  <Megaphone data-icon="inline-start" />
                  تجهيز حملة
                </Button>
                <Button onClick={() => patch({ status: 'completed', reviewedAt: new Date().toISOString() })} disabled={issues.length > 0}>
                  اعتماد القائمة
                </Button>
              </>
            ) : (
              <Button onClick={() => setReviewOpen(true)} disabled={issues.length > 0}>
                {request.type === 'rfq' ? 'مراجعة وإرسال' : 'مراجعة الحملة'}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={request.type === 'rfq' ? 'مراجعة طلب التسعير' : 'مراجعة الحملة'}
        description={
          request.type === 'rfq'
            ? 'تأكد من التفاصيل قبل الاعتماد. لن ينفذ هذا الإجراء إرسالاً تلقائياً.'
            : 'لن تُرسل أي رسالة تلقائياً. بعد الاعتماد تصبح الحملة «جاهزة للإرسال اليدوي» وتبقى في يدك.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              رجوع للتعديل
            </Button>
            <Button
              onClick={() => {
                patch({
                  status: request.type === 'rfq' ? 'awaiting' : 'ready_manual',
                  reviewedAt: new Date().toISOString(),
                })
                setReviewOpen(false)
                if (request.type === 'rfq') {
                  toast.success('تم اعتماد طلب التسعير للمراجعة', { description: 'لم يُرسل أي شيء تلقائياً.' })
                } else {
                  toast.success('الحملة جاهزة للإرسال اليدوي', { description: 'لم يُرسل شيء. الإرسال يتم يدوياً من جهتك.' })
                }
              }}
            >
              {request.type === 'rfq' ? 'تأكيد الإرسال' : 'اعتماد كجاهزة للإرسال اليدوي'}
            </Button>
          </>
        }
      >
        <ReviewSummary request={request} />
      </Modal>
    </main>
  )
}

function ManualSendPanel({ request, onBackToDraft }: { request: RequestItem; onBackToDraft: () => void }) {
  const [copied, setCopied] = useState(false)
  if (!request.campaign) return null
  const t = TEMPLATES.find((x) => x.id === request.campaign?.templateId)
  const text = t ? renderTemplate(t.body, request.campaign.variables) : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-accent/30 p-4" aria-labelledby="manual-title">
      <div className="flex items-start gap-3">
        <Hand className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 id="manual-title" className="font-semibold">
            جاهزة للإرسال اليدوي
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            راجعتَ الحملة واعتمدتها{request.reviewedAt ? ` في ${formatDateTime(request.reviewedAt)}` : ''}. لم يُرسل أي شيء ولن يُرسل تلقائياً.
            أرسلها بنفسك من حساب واتساب للأعمال إلى {request.campaign.included.length} مستلم مؤهل، ثم سجّل المتابعة في الوارد.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={copy} disabled={!text}>
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? 'تم النسخ' : 'نسخ نص الرسالة'}
        </Button>
        <Button variant="ghost" onClick={onBackToDraft}>
          إعادة إلى مسودة للتعديل
        </Button>
      </div>
      <p className="sr-only" aria-live="polite">
        {copied ? 'تم نسخ نص الرسالة' : ''}
      </p>
    </section>
  )
}

function ReviewSummary({ request }: { request: RequestItem }) {
  if (request.rfq) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">الموردون</dt>
        <dd>{request.businessIds.length} مورد</dd>
        <dt className="text-muted-foreground">البنود</dt>
        <dd>
          <ul className="flex flex-col gap-0.5">
            {request.rfq.lineItems.map((l) => (
              <li key={l.id}>
                {l.name} — {l.qty} {l.unit}
              </li>
            ))}
          </ul>
        </dd>
        <dt className="text-muted-foreground">آخر موعد</dt>
        <dd>{request.rfq.deadline ? formatDate(request.rfq.deadline) : '—'}</dd>
        <dt className="text-muted-foreground">التسليم</dt>
        <dd>{request.rfq.deliveryCity}</dd>
      </dl>
    )
  }
  if (request.campaign) {
    const t = TEMPLATES.find((x) => x.id === request.campaign?.templateId)
    const skipped = request.businessIds.length - request.campaign.included.length
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>
          <span className="font-semibold">{request.campaign.included.length}</span> مستلم عبر واتساب بقالب «{t?.name}».
          {skipped > 0 ? ` سيتم استبعاد ${skipped} منشأة غير مؤهلة.` : ''}
        </p>
        {t ? (
          <div className="rounded-2xl rounded-tr-sm bg-accent px-3.5 py-2.5 leading-relaxed text-accent-foreground">
            {renderTemplate(t.body, request.campaign.variables, businessById.get(request.campaign.included[0]))}
          </div>
        ) : null}
      </div>
    )
  }
  return null
}
