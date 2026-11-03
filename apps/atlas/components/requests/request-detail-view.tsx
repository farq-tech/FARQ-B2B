'use client'

import { AlertCircle, ArrowRight, Check, Copy, FileText, Hand, LoaderCircle, MapPinned, Megaphone, MessageSquareText, Pencil, Send } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/shared/modal'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { TEMPLATES, businessById } from '@/lib/mock-data'
import { formatDate, formatDateTime, requestCity, nextStep, statusLabel } from '@/lib/format'
import { counted, numberFormat, useCities } from '@/lib/insights-api'
import { trackDraftReviewed, trackManualHandoffCopied, trackQuoteAccepted } from '@/lib/commercial-metrics'
import { useAppStore } from '@/lib/store'
import { useBackClose } from '@/lib/use-back-close'
import { businessName } from '@/lib/business-name'
import { addToRequestHref, cityKey, mapHref, safeMapOrigin } from '@/lib/handoff'
import { trackedFor } from '@/lib/inbox-feed'
import type { RequestItem } from '@/lib/types'
import { BusinessListEditor } from './business-list-editor'
import { CampaignEditor, campaignIssues, eligibility, renderTemplate } from './campaign-editor'
import { QuoteComparison } from './quote-comparison'
import { StatusBadge, TypeLabel } from './request-badges'
import { RfqEditor, rfqIssues } from './rfq-editor'

/** One click sends one batch of at most this many, after its own confirmation (§11.3). */
const SEND_BATCH_SIZE = 100

export function RequestDetailView({ id }: { id: string }) {
  const router = useRouter()
  const { requests, inbox, deliveries, updateRequest, createDraft } = useAppStore()
  const cities = useCities()
  // the phone's Back closes the review instead of leaving the request (lib/use-back-close.ts)
  const [reviewOpen, setReviewOpen] = useBackClose('review')
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
  const city = requestCity(request, cities)
  const replies = inbox.filter((m) => m.requestId === request.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  const quotes = replies.filter((m) => m.quote)
  // the map view the request was made from; an older request without one opens its city and its search
  const mapView = safeMapOrigin(request.origin) ?? mapHref({ city: cityKey(request.cityId, cities), q: request.query })
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
      cityName: request.cityName,
      goal: request.goal,
      query: request.query,
      liveBusinesses: request.liveBusinesses,
      categoryHint: firstLiveBusiness?.category,
      districtHint: firstLiveBusiness?.district,
      origin: request.origin,
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/requests" className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowRight className="size-4" aria-hidden />
          كل الطلبات
        </Link>
        {/* back to the map as it was when the businesses were picked: the same city, group, step, districts and search */}
        <Link href={mapView} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          <MapPinned className="size-4" aria-hidden />
          {request.origin ? 'افتح الخريطة كما كانت' : 'افتح على الخريطة'}
        </Link>
      </div>

      <header className="flex flex-col gap-2">
        {/* read in the order a person asks: what it is, to whom, where it stands, what to do next */}
        <TypeLabel type={request.type} />
        {editable ? (
          // the page's one h1 even while the title is editable, with a pencil so it reads as something to change
          <h1 className="text-2xl font-bold">
            {/* the field is as wide as its title, so the pencil sits right after the words instead of across the page */}
            <label className="flex max-w-full items-center gap-2">
              <span className="sr-only">عنوان الطلب</span>
              <input
                value={request.title}
                size={Math.max(8, request.title.length + 1)}
                onChange={(e) => patch({ title: e.target.value })}
                className="min-w-0 max-w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 outline-none [field-sizing:content] hover:border-input focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Pencil className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </label>
          </h1>
        ) : (
          <h1 className="text-2xl font-bold text-balance">{request.title}</h1>
        )}
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">في القائمة: {counted(request.businessIds.length, 'business')}</span>
          {city ? ` في ${city}` : ''} · أنشئ {formatDate(request.createdAt)}
          {request.query ? ` · من البحث: «${request.query}»` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusBadge status={request.status} label={statusLabel(request.status, request.type)} />
          {nextStep(request.status, request.type) && <p className="text-sm font-medium text-primary">الخطوة التالية: {nextStep(request.status, request.type)}</p>}
        </div>
      </header>

      {request.status === 'needs_decision' || (quotes.length > 0 && request.status !== 'draft') ? (
        <QuoteComparison
          quotes={quotes}
          request={request}
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
        <WhatsAppSendPanel
          request={request}
          tracked={trackedFor(deliveries, request)}
          onDeliveryUpdate={(campaign, complete) => patch({ campaign, status: complete ? 'awaiting' : 'ready_manual' })}
          onBackToDraft={() => patch({ status: 'draft', reviewedAt: undefined })}
        />
      ) : null}

      {request.rfq ? <RfqEditor value={request.rfq} editable={editable} onChange={(rfq) => patch({ rfq })} /> : null}
      {request.campaign ? (
        <CampaignEditor value={request.campaign} businessIds={request.businessIds} liveBusinesses={request.liveBusinesses} editable={editable} onChange={(campaign) => patch({ campaign })} tracked={trackedFor(deliveries, request)} />
      ) : null}

      {/* once a campaign is reviewed its recipients list (with each one's send state) already names every business:
          the same names a second time only push the replies down */}
      {request.campaign && !editable ? null : (
        <BusinessListEditor
          title={request.type === 'rfq' ? 'الموردون المدعوون' : request.type === 'campaign' ? 'المنشآت المستهدفة' : 'المنشآت في القائمة'}
          cityId={request.cityId}
          businessIds={request.businessIds}
          liveBusinesses={request.liveBusinesses}
          editable={editable}
          onChange={changeBusinesses}
          mapView={editable ? addToRequestHref(mapView, request.id) : mapView}
          addMore={editable}
        />
      )}

      {request.type === 'list' ? (
        <label className="flex flex-col gap-1 rounded-2xl border bg-card p-4">
          <span className="font-semibold">ملاحظات</span>
          <Textarea disabled={!editable} rows={3} value={request.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} className="bg-background font-normal" />
        </label>
      ) : null}

      {replies.length ? (
        <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4" aria-labelledby="replies-title">
          <h2 id="replies-title" className="font-semibold">
            الردود ({numberFormat.format(replies.length)})
          </h2>
          <ul className="flex flex-col divide-y">
            {replies.map((m) => (
              <li key={m.id}>
                <Link href={`/inbox?m=${m.id}`} className="flex items-start gap-3 rounded-lg py-2.5 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                  <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {businessName(m.businessId, request)}
                      {/* a span's aria-label is not read: the word goes in as hidden text */}
                      {m.unread ? <span className="size-2 rounded-full bg-primary"><span className="sr-only">غير مقروء</span></span> : null}
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
        // centred under the page: Atlas has a top bar, not a side bar, so there is no 15rem rail to leave room for
        <div className="fixed inset-x-3 bottom-[4.5rem] z-30 lg:inset-x-4 lg:bottom-4">
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
            : 'لن تُرسل أي رسالة تلقائياً. بعد الاعتماد تصبح الحملة جاهزة، ثم يبدأ الإرسال عبر واتساب بتأكيدك.'
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
                  toast.success('الحملة جاهزة للإرسال عبر واتساب', { description: 'لن يبدأ الإرسال إلا بعد ضغط زر الإرسال وتأكيده.' })
                }
              }}
            >
              {request.type === 'rfq' ? 'اعتماد كجاهز للمشاركة اليدوية' : 'اعتماد كجاهزة للإرسال عبر واتساب'}
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

function WhatsAppSendPanel({ request, tracked, onDeliveryUpdate, onBackToDraft }: {
  request: RequestItem
  /** What WhatsApp reported on each recipient's message, from the account's feed. */
  tracked: Record<string, 'sent' | 'delivered' | 'read' | 'failed'>
  onDeliveryUpdate: (campaign: NonNullable<RequestItem['campaign']>, complete: boolean) => void
  onBackToDraft: () => void
}) {
  // every hook before the first early return, so the order never changes between renders
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useBackClose('send-confirm')
  const [error, setError] = useState('')
  const [ready, setReady] = useState<boolean | null>(null)
  const [readyStatus, setReadyStatus] = useState('جارٍ التحقق من جاهزية الإرسال...')
  // a second click before React re-renders must not start a second batch
  const sending = useRef(false)
  // «إعادة التحقق» can be pressed again before the first check answers: only the latest check may set the status
  const statusCheck = useRef(0)
  const refreshStatus = useCallback(async () => {
    const check = ++statusCheck.current
    setReady(null)
    setReadyStatus('جارٍ التحقق من جاهزية الإرسال...')
    try {
      const response = await fetch('/api/campaign/send', { cache: 'no-store' })
      const result = await response.json().catch(() => null) as { ready?: boolean } | null
      if (check !== statusCheck.current) return
      setReady(response.ok && result?.ready === true)
      setReadyStatus(response.ok ? (result?.ready === true ? 'رسالة واتساب معتمدة وجاهزة للإرسال' : 'رسالة واتساب غير معتمدة بعد، فالإرسال متوقف') : 'تعذر التحقق من جاهزية الإرسال عبر واتساب')
    } catch {
      if (check !== statusCheck.current) return
      setReady(false)
      setReadyStatus('تعذر الاتصال بخدمة الإرسال عبر واتساب')
    }
  }, [])
  useEffect(() => { void refreshStatus() }, [refreshStatus])

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
  // a result this device could not confirm is settled once WhatsApp reports on that message: it was sent
  const sentCount = eligibleIds.filter((id) => delivery[id] === 'sent' || (delivery[id] === 'unknown' && tracked[id])).length
  const unknownCount = eligibleIds.filter((id) => delivery[id] === 'unknown' && !tracked[id]).length
  const failedCount = eligibleIds.filter((id) => delivery[id] === 'failed').length
  const unlinkedCount = campaign.included.length - eligibleIds.length
  // on the list but left out at review: no WhatsApp number, or unticked by the person
  const notIncludedCount = request.businessIds.filter((id) => !campaign.included.includes(id)).length
  const hasDeliveryHistory = Object.keys(delivery).length > 0
  const currentBatch = unsentIds.slice(0, SEND_BATCH_SIZE)
  const laterCount = unsentIds.length - currentBatch.length
  const canSend = !sendingId && ready === true && currentBatch.length > 0 && Boolean(text)

  const send = async () => {
    setConfirmOpen(false)
    if (!canSend || sending.current) return
    sending.current = true
    setError('')
    // exactly the batch the person confirmed; the next one waits for another click and another confirmation
    const batch = [...currentBatch]
    const nextDelivery = { ...delivery }
    for (const id of batch) {
      setSendingId(id)
      try {
        const response = await fetch('/api/campaign/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // the request id lets a reply to this message reach the inbox under this request (lib/inbox-feed.ts)
          body: JSON.stringify({ poiKey: id, message: text, requestId: request.id }),
        })
        const result = await response.json().catch(() => null) as { ok?: boolean } | null
        if (response.ok && result?.ok) nextDelivery[id] = 'sent'
        else if (response.status >= 500) nextDelivery[id] = 'unknown'
        else {
          nextDelivery[id] = 'failed'
          setError('تعذر إرسال بعض الرسائل؛ راجع النتائج قبل إعادة المحاولة.')
        }
      } catch {
        // A lost response does not prove the message was rejected; do not offer an automatic retry.
        nextDelivery[id] = 'unknown'
        setError('انقطع الاتصال قبل تأكيد النتيجة. تحقّق من حالة الرسالة قبل أي إعادة إرسال.')
      }
      const campaignUpdate = { ...campaign, delivery: { ...nextDelivery } }
      onDeliveryUpdate(campaignUpdate, eligibleIds.length > 0 && eligibleIds.every((target) => nextDelivery[target] === 'sent'))
    }
    setSendingId(null)
    sending.current = false
  }

  const firstRecipient = currentBatch[0] ? liveById.get(currentBatch[0]) : undefined
  // who this batch does not reach, and why, so the count in the button is never the whole story
  const excluded = [
    { count: sentCount, label: 'أُرسل لها من قبل' },
    { count: unknownCount, label: 'نتيجتها السابقة غير مؤكدة (لا تُعاد تلقائياً)' },
    { count: notIncludedCount, label: 'استُبعدت عند المراجعة (بلا رقم واتساب أو أزلتها)' },
    { count: unlinkedCount, label: 'ليست من نتائج الدليل الحية' },
  ].filter((row) => row.count > 0)

  const deliveredCount = eligibleIds.filter((id) => tracked[id] === 'delivered').length
  const readCount = eligibleIds.filter((id) => tracked[id] === 'read').length
  const undeliveredCount = eligibleIds.filter((id) => tracked[id] === 'failed').length
  const tally = [
    sentCount ? `${numberFormat.format(sentCount)} أُرسلت` : null,
    unsentIds.length ? `${numberFormat.format(unsentIds.length)} بانتظار الإرسال` : null,
    failedCount ? `${numberFormat.format(failedCount)} فشل` : null,
    unknownCount ? `${numberFormat.format(unknownCount)} نتيجتها غير مؤكدة` : null,
    // what WhatsApp reported after sending: arrived, read, or did not arrive
    deliveredCount ? `${numberFormat.format(deliveredCount)} وصلت` : null,
    readCount ? `${numberFormat.format(readCount)} قُرئت` : null,
    undeliveredCount ? `${numberFormat.format(undeliveredCount)} لم تصل` : null,
    unlinkedCount ? `${numberFormat.format(unlinkedCount)} لا يمكن إرسالها لأنها ليست من نتائج الدليل الحية` : null,
  ].filter(Boolean)
  // nobody left to send to, and not because the campaign finished: say so instead of a disabled «إرسال 0»
  const nothingToSend = currentBatch.length === 0 && !(sentCount === eligibleIds.length && eligibleIds.length)

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-accent/30 p-4" aria-labelledby="whatsapp-send-title">
      <div className="flex items-start gap-3">
        <Send className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 id="whatsapp-send-title" className="font-semibold">
            إرسال عبر واتساب
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {request.reviewedAt ? `اعتمدت الحملة في ${formatDateTime(request.reviewedAt)}. ` : ''}الإرسال يتم عبر واتساب بعد تأكيدك أدناه. كل دفعة ترسل حتى {numberFormat.format(SEND_BATCH_SIZE)} جهة، ولا يبدأ إرسال الدفعة التالية تلقائياً.
          </p>
        </div>
      </div>
      {/* only the counts that hold something: «0 أُرسلت · 0 بانتظار الإرسال» told the person nothing */}
      {tally.length ? <p className="text-sm">{tally.join(' · ')}</p> : null}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{readyStatus}</span>
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => void refreshStatus()} disabled={ready === null}>إعادة التحقق</button>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setConfirmOpen(true)} disabled={!canSend}>
          {sendingId ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}
          {sendingId ? `جارٍ الإرسال (${liveById.get(sendingId)?.name ?? 'جهة'})` : sentCount === eligibleIds.length && eligibleIds.length ? 'اكتمل الإرسال' : nothingToSend ? 'لا جهات جاهزة للإرسال' : ready === null ? 'جارٍ التحقق...' : ready ? `إرسال ${numberFormat.format(currentBatch.length)} عبر واتساب${failedCount ? ' (مع إعادة الفاشل)' : ''}` : 'الإرسال عبر واتساب غير جاهز'}
        </Button>
        <Button variant="ghost" onClick={onBackToDraft} disabled={Boolean(sendingId) || hasDeliveryHistory}>
          إعادة إلى مسودة للتعديل
        </Button>
      </div>
      {nothingToSend && !sendingId ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {unlinkedCount
            ? 'جهات هذه الحملة ليست من نتائج الدليل الحية، فلا يصلها شيء. أعدها إلى مسودة وأضف الجهات من الخريطة.'
            : unknownCount
              ? 'بقيت جهات نتيجتها غير مؤكدة فقط، ولا تُعاد تلقائياً.'
              : 'لا توجد في القائمة جهة لها رقم واتساب. أعدها إلى مسودة وأضف جهات من الخريطة.'}
        </p>
      ) : null}
      {unknownCount ? <p className="text-xs text-muted-foreground">لا تعِد إرسال الجهات ذات النتيجة غير المؤكدة قبل مراجعة سجل واتساب؛ قد تكون الرسالة وصلت بالفعل.</p> : null}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="تأكيد إرسال الدفعة"
        description="تُرسل هذه الدفعة وحدها الآن. لا يبدأ أي إرسال آخر إلا بضغطة وتأكيد جديدين."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => void send()} disabled={!canSend}>
              <Send data-icon="inline-start" />
              {`إرسال الدفعة الآن (${numberFormat.format(currentBatch.length)})`}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>
            تصلها الرسالة عبر واتساب الآن: <span className="font-semibold">{counted(currentBatch.length, 'business')}</span>.
            {laterCount > 0 ? ` تبقى لدفعة لاحقة بضغطة أخرى: ${counted(laterCount, 'business')}.` : ''}
          </p>
          {excluded.length ? (
            <div className="flex flex-col gap-1">
              <p className="font-medium">لن تصلها هذه الدفعة</p>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {excluded.map((row) => (
                  <li key={row.label}>
                    {row.label}: <span className="font-medium text-foreground">{counted(row.count, 'business')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {t ? (
            <div className="rounded-2xl rounded-tr-sm bg-accent px-3.5 py-2.5 leading-relaxed text-accent-foreground">
              {renderTemplate(t.body, campaign.variables, firstRecipient)}
            </div>
          ) : null}
        </div>
      </Modal>
    </section>
  )
}

function ReviewSummary({ request }: { request: RequestItem }) {
  if (request.rfq) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">الموردون</dt>
        <dd>{numberFormat.format(request.businessIds.length)} مورد</dd>
        <dt className="text-muted-foreground">البنود</dt>
        <dd>
          <ul className="flex flex-col gap-0.5">
            {request.rfq.lineItems.map((l) => (
              <li key={l.id}>
                {l.name} — {numberFormat.format(l.qty)} {l.unit}
              </li>
            ))}
          </ul>
        </dd>
        <dt className="text-muted-foreground">آخر موعد</dt>
        <dd>{request.rfq.deadline ? formatDate(request.rfq.deadline) : <span className="text-muted-foreground">غير متاح</span>}</dd>
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
          <span className="font-semibold">{numberFormat.format(request.campaign.included.length)}</span> مستلم مؤهل عبر واتساب بقالب «{t?.name}».
          {skipped > 0 ? ` سيتم استبعاد ${numberFormat.format(skipped)} منشأة لا تستوفي الأهلية.` : ''}
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
