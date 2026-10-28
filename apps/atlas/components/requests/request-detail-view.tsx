'use client'

import { AlertCircle, ArrowRight, Check, Copy, FileText, Hand, LoaderCircle, Megaphone, MessageSquareText, Send } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/shared/modal'
import { Button } from '@/components/ui/button'
import { TEMPLATES, businessById, cityById } from '@/lib/mock-data'
import { formatDate, formatDateTime } from '@/lib/format'
import { trackDraftReviewed, trackManualHandoffCopied, trackQuoteAccepted } from '@/lib/commercial-metrics'
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
      const liveById = new Map(request.liveBusinesses?.map((business) => [business.id, business]))
      const eligibleAdded = added.filter((x) => {
        const b = businessById.get(x)
        return b ? eligibility(b).ok : Boolean(liveById.get(x)?.whatsapp)
      })
      patch({
        businessIds: ids,
        campaign: {
          ...request.campaign,
          included: [...request.campaign.included.filter((x) => ids.includes(x)), ...eligibleAdded],
        },
      })
    } else patch({ businessIds: ids })
  }

  const convert = (type: 'rfq' | 'campaign') => {
    const firstLiveBusiness = request.liveBusinesses?.find((business) => request.businessIds.includes(business.id))
    const newId = createDraft({
      type,
      businessIds: request.businessIds,
      cityId: request.cityId,
      goal: request.goal,
      query: request.query,
      liveBusinesses: request.liveBusinesses,
      categoryHint: firstLiveBusiness?.category,
      districtHint: firstLiveBusiness?.district,
    })
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
          <StatusBadge status={request.status} label={request.status === 'ready_manual' && request.type === 'campaign' ? 'جاهزة للإرسال السحابي' : undefined} />
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
          onAccept={(mid) => {
            patch({ acceptedQuoteId: mid, status: 'completed' })
            trackQuoteAccepted({ city: request.cityId, quoteCount: quotes.length })
          }}
        />
      ) : null}

      {request.rfq && request.status === 'ready_manual' ? (
        <ManualRfqPanel request={request} onBackToDraft={() => patch({ status: 'draft', reviewedAt: undefined })} />
      ) : null}

      {request.campaign && (request.status === 'ready_manual' || request.status === 'awaiting') ? (
        <CloudSendPanel
          request={request}
          onDeliveryUpdate={(campaign, complete) => patch({ campaign, status: complete ? 'awaiting' : 'ready_manual' })}
          onBackToDraft={() => patch({ status: 'draft', reviewedAt: undefined })}
        />
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
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={m.receivedAt}>
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
                {request.type === 'rfq' ? 'مراجعة واعتماد' : 'مراجعة الحملة'}
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
            ? 'تأكد من التفاصيل قبل الاعتماد. بعدها يصبح الطلب جاهزاً للمشاركة اليدوية؛ لن يرسل أطلس طلباً تلقائياً.'
            : 'لن تُرسل أي رسالة تلقائياً. بعد الاعتماد تصبح الحملة جاهزة، ثم يبدأ الإرسال السحابي بتأكيدك.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              رجوع للتعديل
            </Button>
            <Button
              onClick={() => {
                patch({
                  status: 'ready_manual',
                  reviewedAt: new Date().toISOString(),
                })
                trackDraftReviewed({ city: request.cityId, type: request.type, count: request.businessIds.length })
                setReviewOpen(false)
                if (request.type === 'rfq') {
                  toast.success('طلب التسعير جاهز للمشاركة اليدوية', { description: 'لم يُرسل أي شيء. شاركه بالطريقة التي تختارها ثم تابع الردود في الوارد.' })
                } else {
                  toast.success('الحملة جاهزة للإرسال السحابي', { description: 'لن يبدأ الإرسال إلا بعد ضغط زر الإرسال وتأكيده.' })
                }
              }}
            >
              {request.type === 'rfq' ? 'اعتماد كجاهز للمشاركة اليدوية' : 'اعتماد كجاهزة للإرسال السحابي'}
            </Button>
          </>
        }
      >
        <ReviewSummary request={request} />
      </Modal>
    </main>
  )
}

function ManualRfqPanel({ request, onBackToDraft }: { request: RequestItem; onBackToDraft: () => void }) {
  const [copied, setCopied] = useState(false)
  if (!request.rfq) return null

  const copy = async () => {
    const lines = [
      `طلب تسعير: ${request.title}`,
      `المدينة: ${request.rfq?.deliveryCity ?? ''}`,
      request.rfq?.deadline ? `آخر موعد للرد: ${formatDate(request.rfq.deadline)}` : '',
      '',
      'البنود المطلوبة:',
      ...(request.rfq?.lineItems.map((item) => `- ${item.name}: ${item.qty} ${item.unit}`) ?? []),
      request.rfq?.notes ? `\nملاحظات: ${request.rfq.notes}` : '',
    ].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(lines)
      setCopied(true)
      trackManualHandoffCopied({ city: request.cityId, type: 'rfq', count: request.businessIds.length })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      toast.error('تعذر النسخ', { description: 'المتصفح منع النسخ. حدّد النص وانسخه يدوياً.' })
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-accent/30 p-4" aria-labelledby="manual-rfq-title">
      <div className="flex items-start gap-3">
        <Hand className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 id="manual-rfq-title" className="font-semibold">جاهز للمشاركة اليدوية</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            راجعتَ طلب التسعير{request.reviewedAt ? ` في ${formatDateTime(request.reviewedAt)}` : ''}. لم يرسل أطلس طلباً لأي مورد.
            انسخ نص الطلب وشاركه بالقناة التي تختارها، ثم سجّل الردود في الوارد.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={copy}>
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? 'تم النسخ' : 'نسخ نص طلب التسعير'}
        </Button>
        <Button variant="ghost" onClick={onBackToDraft}>إعادة إلى مسودة للتعديل</Button>
      </div>
      <p className="sr-only" aria-live="polite">{copied ? 'تم نسخ نص طلب التسعير' : ''}</p>
    </section>
  )
}

function CloudSendPanel({ request, onDeliveryUpdate, onBackToDraft }: {
  request: RequestItem
  onDeliveryUpdate: (campaign: NonNullable<RequestItem['campaign']>, complete: boolean) => void
  onBackToDraft: () => void
}) {
  const sendBatchSize = 100
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [cloudReady, setCloudReady] = useState<boolean | null>(null)
  const [cloudStatus, setCloudStatus] = useState('جارٍ التحقق من القالب...')
  const campaign = request.campaign
  if (!campaign) return null
  const t = TEMPLATES.find((x) => x.id === campaign.templateId)
  const text = t ? renderTemplate(t.body, campaign.variables) : ''
  const liveById = new Map(request.liveBusinesses?.map((business) => [business.id, business]))
  const eligibleIds = campaign.included.filter((id) => {
    if (businessById.has(id)) return false
    const liveBusiness = liveById.get(id)
    return liveBusiness ? liveBusiness.whatsapp : /^[A-Za-z0-9:_\-.]{1,200}$/.test(id)
  })
  const delivery = campaign.delivery ?? {}
  const unsentIds = eligibleIds.filter((id) => delivery[id] !== 'sent' && delivery[id] !== 'unknown')
  const sentCount = eligibleIds.filter((id) => delivery[id] === 'sent').length
  const unknownCount = eligibleIds.filter((id) => delivery[id] === 'unknown').length
  const failedCount = eligibleIds.filter((id) => delivery[id] === 'failed').length
  const unlinkedCount = campaign.included.length - eligibleIds.length
  const hasDeliveryHistory = Object.keys(delivery).length > 0
  const currentBatch = unsentIds.slice(0, sendBatchSize)
  const refreshCloudStatus = useCallback(async () => {
    setCloudReady(null)
    setCloudStatus('جارٍ التحقق من القالب...')
    try {
      const response = await fetch('/api/campaign/send', { cache: 'no-store' })
      const result = await response.json().catch(() => null) as { ready?: boolean; status?: string; error?: string } | null
      setCloudReady(response.ok && result?.ready === true)
      setCloudStatus(response.ok ? `قالب WhatsApp Cloud: ${result?.status ?? 'غير متاح'}` : result?.error ?? 'تعذر التحقق من الإعداد')
    } catch {
      setCloudReady(false)
      setCloudStatus('تعذر الاتصال بخدمة الإرسال السحابي')
    }
  }, [])
  useEffect(() => { void refreshCloudStatus() }, [refreshCloudStatus])
  const send = async () => {
    if (!currentBatch.length || !text || sendingId || cloudReady !== true) return
    if (!window.confirm(`سيُرسل أطلس رسالة واتساب سحابية إلى ${currentBatch.length} جهة الآن باستخدام القالب المعتمد farq_outreach_ar. هل تريد المتابعة؟`)) return
    setError('')
    const nextDelivery = { ...delivery }
    for (const id of currentBatch) {
      setSendingId(id)
      try {
        const response = await fetch('/api/campaign/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ poiKey: id, message: text }),
        })
        const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
        if (response.ok && result?.ok) nextDelivery[id] = 'sent'
        else if (response.status >= 500) nextDelivery[id] = 'unknown'
        else {
          nextDelivery[id] = 'failed'
          setError(result?.error || 'تعذر إرسال بعض الرسائل؛ راجع النتائج قبل إعادة المحاولة.')
        }
      } catch {
        // A lost response does not prove that Meta rejected the message; do not offer an automatic retry.
        nextDelivery[id] = 'unknown'
        setError('انقطع الاتصال قبل تأكيد النتيجة. تحقّق من حالة الرسالة قبل أي إعادة إرسال.')
      }
      const campaignUpdate = { ...campaign, delivery: { ...nextDelivery } }
      onDeliveryUpdate(campaignUpdate, eligibleIds.length > 0 && eligibleIds.every((target) => nextDelivery[target] === 'sent'))
    }
    setSendingId(null)
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-accent/30 p-4" aria-labelledby="cloud-send-title">
      <div className="flex items-start gap-3">
        <Send className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 id="cloud-send-title" className="font-semibold">
            إرسال واتساب سحابي
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {request.reviewedAt ? `اعتمدت الحملة في ${formatDateTime(request.reviewedAt)}. ` : ''}الإرسال يتم عبر WhatsApp Cloud API بعد تأكيدك أدناه. كل دفعة ترسل حتى 100 جهة، ولا يبدأ إرسال الدفعة التالية تلقائياً.
          </p>
        </div>
      </div>
      <p className="text-sm">
        {sentCount} قبلها واتساب للإرسال · {unsentIds.length} بانتظار الإرسال{failedCount ? ` · ${failedCount} فشل` : ''}{unknownCount ? ` · ${unknownCount} نتيجتها غير مؤكدة` : ''}
        {unlinkedCount ? ` · ${unlinkedCount} لا يمكن إرسالها لأنها ليست من نتائج الدليل الحية` : ''}
      </p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{cloudStatus}</span>
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => void refreshCloudStatus()} disabled={cloudReady === null}>إعادة التحقق</button>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={send} disabled={Boolean(sendingId) || cloudReady !== true || !unsentIds.length || !text}>
          {sendingId ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}
          {sendingId ? `جارٍ الإرسال (${liveById.get(sendingId)?.name ?? 'جهة'})` : sentCount === eligibleIds.length && eligibleIds.length ? 'اكتمل الإرسال' : cloudReady === null ? 'التحقق من القالب...' : cloudReady ? `إرسال ${currentBatch.length} سحابيًا${failedCount ? ' (مع إعادة الفاشل)' : ''}` : 'الإرسال السحابي غير جاهز'}
        </Button>
        <Button variant="ghost" onClick={onBackToDraft} disabled={Boolean(sendingId) || hasDeliveryHistory}>
          إعادة إلى مسودة للتعديل
        </Button>
      </div>
      {unknownCount ? <p className="text-xs text-muted-foreground">لا تعِد إرسال الجهات ذات النتيجة غير المؤكدة قبل مراجعة سجل واتساب؛ قد تكون الرسالة وصلت بالفعل.</p> : null}
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
          <span className="font-semibold">{request.campaign.included.length}</span> مستلم مؤهل عبر واتساب بقالب «{t?.name}».
          {skipped > 0 ? ` سيتم استبعاد ${skipped} منشأة لا تستوفي الأهلية.` : ''}
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
