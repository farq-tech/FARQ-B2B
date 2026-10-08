import { useEffect } from 'react'
import type { NavProps } from '../../types'
import { useProcurement } from '../../procurementContext'
import { Button, FlowFooter, FlowHeader } from '../../ui'
import { ReviewPage } from '../review'
import { DeliveryStep, SendStep } from '../review/DeliverySend'
import { RequestStep } from './RequestStep'
import { LiveBg, MobileFooter, MobileStepsHeader, MobileTitleHeader, useIsMobile } from './shell'
import { useRequestFlow, type Step } from './useRequestFlow'

/*
 * /new — «01 طلب جديد ← 02 مراجعة البنود ← التوصيل ← الإرسال».
 * Desktop: Figma 38:2 (01) and 42:44 (02). Mobile (<768px): M01 56:2 and M02 56:60.
 * Replaces src/views/NewRequestV2.tsx (M4) once routed (docs/qa/requests.md).
 * Same API calls and payload as فرق بناء's NewRequestScreen.tsx@5147808 — see ../review/sendRequest.ts.
 */

const STEPS = ['الطلب', 'البنود', 'التوصيل', 'الإرسال']
const MOBILE_TITLES = ['طلب جديد', 'مراجعة البنود', 'التوصيل', 'الإرسال']

export function NewRequestPage({ navigate }: NavProps) {
  const { setSelectedRfqId } = useProcurement()
  const mobile = useIsMobile()
  const flow = useRequestFlow()
  const { step, setStep, sending, busy, error, readyItems, needsCheck, createdId, blockers } = flow

  // Each step starts at its heading for keyboard and screen-reader users.
  useEffect(() => {
    window.scrollTo({ top: 0 })
    const h = document.querySelector<HTMLElement>('main h1')
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
  }, [step])

  const close = () => navigate('rfq-list')
  const back = () => setStep((s) => (s - 1) as Step)
  function openRequest() {
    if (!createdId) return
    setSelectedRfqId(createdId)
    navigate('rfq-detail')
  }

  const status = busy || `الخطوة ${step + 1} من 4${step === 1 ? ` · ${readyItems.length} بند جاهز${needsCheck.length ? `، و${needsCheck.length} تحتاج تأكيدك` : ''}` : ' · تقدر ترجع وتعدّل قبل الإرسال'}`
  const wide = mobile
  const next =
    step === 0 ? <Button size="L" fullWidth={wide} icon="arrow-forward" loading={Boolean(busy)} loadingLabel="نبحث عن موردين…" disabled={!flow.usable.length || Boolean(flow.reading)} onClick={() => void flow.toReview()}>التالي</Button>
      : step === 1 ? <Button size="L" fullWidth={wide} icon="arrow-forward" disabled={!readyItems.length} onClick={() => setStep(2)}>التالي: التوصيل</Button>
        : step === 2 ? <Button size="L" fullWidth={wide} icon="arrow-forward" disabled={!flow.city.trim() || !flow.requiredDate || !flow.quoteDeadline} onClick={() => setStep(3)}>التالي: الإرسال</Button>
          : createdId ? <Button size="L" fullWidth={wide} icon="arrow-forward" onClick={openRequest}>افتح الطلب</Button>
            : <Button size="L" fullWidth={wide} icon="send" loading={sending} loadingLabel="جارٍ الإرسال…" disabled={blockers.length > 0} onClick={() => void flow.send()}>أرسل الطلب</Button>

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
      {step <= 1 ? <LiveBg /> : null}
      {mobile
        ? step === 0 ? <MobileStepsHeader steps={STEPS} current={step} onClose={close} />
          : <MobileTitleHeader title={MOBILE_TITLES[step]} step={step + 1} total={4} onBack={sending ? undefined : back} />
        : <div className="relative z-10"><FlowHeader steps={STEPS} current={step} onClose={close} /></div>}

      <main className="relative flex-1 pb-10 [&_h1]:outline-none">
        {error ? <p role="alert" className={`relative z-10 mx-auto mb-4 max-w-[752px] rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-4 py-3 text-[14px] text-[var(--color-text-danger)] ${mobile ? 'mx-4 mt-4' : 'mt-2'}`}>{error}</p> : null}
        {step === 0 ? <RequestStep flow={flow} mobile={mobile} /> : null}
        {step === 1 ? <ReviewPage flow={flow} mobile={mobile} /> : null}
        {step === 2 ? <DeliveryStep flow={flow} mobile={mobile} /> : null}
        {step === 3 ? <SendStep flow={flow} mobile={mobile} /> : null}
      </main>

      {mobile
        ? <MobileFooter status={busy || undefined}>{next}</MobileFooter>
        : <FlowFooter
            back={step === 0 ? <Button variant="Ghost" size="L" onClick={close}>رجوع</Button> : sending ? null : <Button variant="Ghost" size="L" onClick={back}>رجوع</Button>}
            status={status}
            next={next}
          />}
    </div>
  )
}

export default NewRequestPage
