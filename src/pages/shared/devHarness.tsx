/*
 * DEV-ONLY harness for track D (screens 03–06), served by Vite from
 * docs/qa/screens-b/harness.html — never part of `vite build` (index.html is the
 * only build entry) and never imported by production code.
 *
 *   ?screen=tracking|comparison|comparison-award   fixtures answered in the page
 *   ?screen=tracking&state=loading|error|empty      states
 *   ?screen=award-legacy|award-sheet                 AwardDialog (before) / Confirm Sheet (after)
 *   ?screen=inbox[&state=empty|error|loading]        inbox fixtures
 *   &routed=1                                        no in-page answers: every /_api call goes to
 *                                                    the browser network, where Playwright page.route
 *                                                    answers it (award-call proof).
 *
 * Safety: outside Playwright (window.__PW_ROUTED__ unset) every non-GET request is
 * refused in the page, so nothing here can write an award or send a message.
 */
import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import '../../index.css'
import { ProcurementProvider, useProcurement } from '../../procurementContext'
import { RequestTrackingV2 } from '../../views/RequestTrackingV2'
import { ComparisonV2 } from '../../views/ComparisonV2'
import AwardDialog from '../../components/procurement/AwardDialog'
import AwardConfirmSheet from './../award/AwardConfirmSheet'
import InboxPage from '../inbox'
import { RFQ_ID, rfq, rfqClosed, comparison, comparisonAward, outcomes, FIXED_NOW } from '../../dev/fixtures'
import { quoteCoverage, matrixTotals } from '../../lib/requestFile'
import type { ConstructionComparison, ConstructionRfq } from '../../api/constructionClient'

const params = new URLSearchParams(window.location.search)
const screen = params.get('screen') || 'tracking'
const state = params.get('state') || ''
const routed = params.get('routed') === '1'
const w = window as unknown as { __PW_ROUTED__?: boolean; __CALLS__?: unknown[] }

Date.now = () => FIXED_NOW + 60_000
const iso = (minAgo: number) => new Date(FIXED_NOW - minAgo * 60_000).toISOString()

// Illustrative inbox rows for screenshots and keyboard tests (dev only).
const THREADS = [
  { invite_id: 'i1', supplier_id: 's1', supplier_name_ar: 'مستودع الرياض للكهرباء', unread_count: 1, preview: 'للحبة. والتوصيل علينا للرياض', last_received_at: iso(1), response_status: 'QUOTED', needs_reply: true, request_context: { rfq_id: RFQ_ID, reference: 'RFQ-1042' }, kind_hint: 'INBOUND' },
  { invite_id: 'i2', supplier_id: 's2', supplier_name_ar: 'مؤسسة النور للكهرباء', unread_count: 0, preview: 'مرفق عرض السعر PDF', last_received_at: iso(9), response_status: 'QUOTED', needs_reply: false, request_context: { rfq_id: RFQ_ID, reference: 'RFQ-1042' }, kind_hint: 'INBOUND' },
  { invite_id: 'i3', supplier_id: 's3', supplier_name_ar: 'شركة الخليج للكابلات', unread_count: 2, preview: 'كم الكمية بالضبط؟', last_received_at: iso(24), response_status: 'AWAITING_QUOTE', needs_reply: true, request_context: { rfq_id: RFQ_ID, reference: 'RFQ-1042' }, kind_hint: 'INBOUND' },
  { invite_id: 'i4', supplier_id: 's4', supplier_name_ar: 'مؤسسة البناء الحديث', unread_count: 0, preview: 'دعوة طلب عرض مرسلة', last_received_at: iso(117), response_status: 'AWAITING_QUOTE', needs_reply: false, request_context: { rfq_id: RFQ_ID, reference: 'RFQ-1042' }, kind_hint: 'DISPATCH' },
]
const DETAIL = {
  ...THREADS[0], rfq_id: RFQ_ID, owner_name: 'أحمد', can_reply: false,
  messages: [
    { id: 'm1', direction: 'OUTBOUND', employee_name: 'أحمد', channel: 'WHATSAPP', state: 'SENT', created_at: iso(48), body_text: 'السلام عليكم، معك أحمد من فرق. عندنا طلب كيبل نحاس 4×16 مسلّح 500 متر، وقواطع 32 أمبير 40 حبة. كم تحسبها لنا؟' },
    { id: 'm2', direction: 'INBOUND', channel: 'WHATSAPP', state: 'RECEIVED', created_at: iso(29), body_text: 'وعليكم السلام، الكيبل متوفر المتر بـ 82.40 والقواطع 71', reply_kind: 'PRICE_IN_TEXT', reply_summary_ar: 'ذكر سعر الكيبل والقواطع' },
    { id: 'm3', direction: 'OUTBOUND', employee_name: 'أحمد', channel: 'WHATSAPP', state: 'SENT', created_at: iso(20), body_text: 'تمام، يعطيك العافية. 71 للحبة؟' },
    { id: 'm4', direction: 'INBOUND', channel: 'WHATSAPP', state: 'RECEIVED', created_at: iso(1), body_text: 'للحبة. والتوصيل علينا للرياض', reply_kind: 'PRICE_IN_TEXT', reply_summary_ar: 'أكد السعر للحبة والتوصيل مجاني للرياض', files: [{ id: 'f1', filename: 'عرض-سعر.pdf', state: 'STORED' }] },
  ],
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: { message: 'تعذر الاتصال بالخادم (اختبار)' } }), { status, headers: { 'content-type': 'application/json' } })
const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET' && !w.__PW_ROUTED__) {
    console.warn('[harness] refused write', method, url)
    return json(null, 503)
  }
  if (routed) return realFetch(input, init)
  if (state === 'loading') return new Promise<Response>(() => {})
  if (state === 'error') return json(null, 503)
  const award = screen === 'comparison-award'
  if (url.endsWith('/api/construction/projects')) return json({ projects: [{ id: 'p1', name: 'فيلا النرجس', site_address: 'الرياض' }] })
  if (url.includes('/inbox/status')) return json({ enabled: true, allowed: true })
  if (url.includes('/inbox/threads/')) return json(DETAIL)
  if (url.includes('/inbox/threads')) return json({ threads: state === 'empty' ? [] : THREADS })
  if (url.includes(`/rfqs/${RFQ_ID}/comparison`)) return state === 'empty' ? json(null, 404) : json(award ? comparisonAward : comparison)
  if (url.includes(`/rfqs/${RFQ_ID}/supplier-outcomes`)) return json(state === 'empty' ? { events: [] } : outcomes)
  if (url.includes(`/rfqs/${RFQ_ID}`)) return json(award ? rfqClosed : state === 'empty' ? { ...rfq, response_count: 0, invitations: rfq.invitations.map((i) => ({ ...i, response_status: 'AWAITING_QUOTE', opened_at: null })) } : rfq)
  console.warn('[harness] refused', method, url)
  return json(null, 503)
}

function Screen() {
  const { setSelectedRfqId, navigate } = useProcurement()
  useEffect(() => { setSelectedRfqId(RFQ_ID) }, [setSelectedRfqId])
  if (screen === 'inbox') return <InboxPage onOpenRequest={() => navigate('rfq-detail')} initialInviteId={params.get('thread')} />
  if (screen === 'award-legacy' || screen === 'award-sheet') {
    const c = comparisonAward as unknown as ConstructionComparison
    const r = rfqClosed as unknown as ConstructionRfq
    const lowest = matrixTotals(c.quote_matrix).lowest
    const offer = c.supplier_responses.find((x) => String(x.supplier.id) === lowest)!
    const coverage = quoteCoverage(c.quote_matrix?.supplier_summaries?.find((s) => s.supplier_id === lowest), c.quote_matrix?.lines.length)
    const done = (award: Record<string, unknown>) => { (w.__CALLS__ ||= []).push({ done: award }) }
    const close = () => { (w.__CALLS__ ||= []).push({ closed: true }) }
    return screen === 'award-legacy'
      ? <AwardDialog rfq={r} comparison={c} offer={offer} coverage={coverage} onClose={close} onDone={done} />
      : <AwardConfirmSheet rfq={r} comparison={c} offer={offer} coverage={coverage} onClose={close} onDone={done} />
  }
  return screen.startsWith('comparison') ? <ComparisonV2 navigate={navigate} /> : <RequestTrackingV2 navigate={navigate} />
}

createRoot(document.getElementById('root')!).render(<ProcurementProvider><Screen /></ProcurementProvider>)
