import '../b2b/b2b.css'
/*
 * DEV-ONLY visual harness: http://localhost:5180/?harness=tracking|comparison
 * Serves fixture JSON to the real screens (no login, no network) so before/after
 * screenshots are reproducible. Loaded only under `import.meta.env.DEV`.
 */
import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import { ProcurementProvider, useProcurement } from '../procurementContext'
import { RequestTrackingV2 } from '../views/RequestTrackingV2'
import { ComparisonV2 } from '../views/ComparisonV2'
import { RFQ_ID, rfq, rfqClosed, comparison, comparisonAward, outcomes, FIXED_NOW, flowMatch, flowCatalog, flowScan } from './fixtures'
import { NewRequestV2 } from '../views/NewRequestV2'
import LiveBackground from '../live-bg'
import TargetingPage from '../pages/targeting'
import TemplatesPage from '../pages/targeting/Templates'
import TemplateEditor from '../pages/targeting/TemplateEditor'

Date.now = () => FIXED_NOW + 60_000
const awardVariant = new URLSearchParams(window.location.search).get('harness') === 'comparison-award'
// Fixtures only: every other request is refused, so nothing in the harness can reach the real API
// (e.g. pressing «ترسية» in a test never writes an award).
const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
  // A local, read-only design fixture for the street-activity picker; no account or targeting API needed.
  if (new URLSearchParams(window.location.search).get('harness') === 'activity-filter') {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('/cities')) return json([{ en: 'Riyadh', ar: 'الرياض', n: 8400 }])
    if (url.includes('/districts?')) return json({ type: 'FeatureCollection', features: [] })
    if (url.includes('/street-density/catalog')) return json({ mains: [
      { main_id: 'build', main_ar: 'التشييد والبناء', streets: 42, shops: 1360, subs: [
        { sub_id: 'build.painting', sub_ar: 'الدهانات', streets: 18, shops: 420 },
        { sub_id: 'build.plumbing_supply', sub_ar: 'الأدوات الصحية والسباكة', streets: 15, shops: 510 },
        { sub_id: 'build.tiles', sub_ar: 'البلاط والسيراميك', streets: 9, shops: 430 },
      ] },
      { main_id: 'food', main_ar: 'الأغذية والمطاعم', streets: 28, shops: 920, subs: [
        { sub_id: 'food.restaurant', sub_ar: 'المطاعم', streets: 21, shops: 730 },
        { sub_id: 'food.bakery', sub_ar: 'المخابز', streets: 7, shops: 190 },
      ] },
      { main_id: 'beauty', main_ar: 'العناية الشخصية', streets: 16, shops: 640, subs: [
        { sub_id: 'beauty.barber', sub_ar: 'الحلاقة الرجالية', streets: 16, shops: 640 },
      ] },
    ] })
    if (url.includes('/suggest-specialties')) return json({ suggestions: [
      { specialty_id: 'interior-paint', specialty_ar: 'دهانات داخلية', sub_id: 'build.painting', sub_ar: 'الدهانات', main_ar: 'التشييد والبناء' },
      { specialty_id: 'industrial-paint', specialty_ar: 'دهانات صناعية', sub_id: 'build.painting', sub_ar: 'الدهانات', main_ar: 'التشييد والبناء' },
    ] })
    if (url.includes('/street-density')) return json({ type: 'FeatureCollection', features: [], basis: 'بيانات توضيحية للمعاينة المحلية فقط.' })
    if (url.includes('/market-summary')) return json({ ok: true, summary: { total: 8400, districts_count: 8, top_districts: [], densest_street: null, n_wholesale: 1270, n_whatsapp: 5100, n_specialties: 320, n_approx: 160, basis: 'بيانات توضيحية للمعاينة المحلية فقط.' } })
    if (url.includes('/district-counts')) return json({ ok: true, city: 'Riyadh', districts: [], total: 8400, basis: 'بيانات توضيحية للمعاينة المحلية فقط.' })
    if (url.includes('/template-status')) return json({ name: 'farq_outreach_ar', status: 'APPROVED' })
    if (url.includes('/send-status')) return json({ send: false })
    if (url.endsWith('/status')) return json({ pois: 8400, whatsapp: 5100, email: 900, ai: true })
    if (url.includes('/templates')) return json({ ok: true, data: [] })
    return json({ ok: true, data: [] })
  }
  // targeting (harness=targeting|templates|template-new): the local service's real search data; never the send endpoint
  if (url.includes('/_targeting/') && !url.includes('/_targeting/send')) return realFetch(input, init)
  // the targeting map's tiles and style (read-only)
  if (method === 'GET' && /^https:\/\/[a-z]+\.mapbox\.com\//.test(url)) return realFetch(input, init)
  // new-request flow (harness=new): matching, catalogue check and scan answered locally.
  if (method === 'POST' && url.includes('/boq/match')) return ok(flowMatch(JSON.parse(String(init?.body || '{}'))))
  if (method === 'GET' && url.includes('/api/construction/catalog')) return new Response(JSON.stringify({ ok: true, data: flowCatalog }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (method === 'POST' && url.includes('/purchase-requests/scan')) return ok(flowScan)
  if (method === 'GET' && url.includes(`/rfqs/${RFQ_ID}/comparison`)) return ok(awardVariant ? comparisonAward : comparison)
  if (method === 'GET' && url.includes(`/rfqs/${RFQ_ID}/supplier-outcomes`)) return ok(outcomes)
  if (method === 'GET' && url.includes(`/rfqs/${RFQ_ID}`)) return ok(awardVariant ? rfqClosed : rfq)
  // company data lives on the server (GET /api/business/company-profile, being built): the harness account has none yet
  if (method === 'GET' && (url.includes('/api/business/context') || url.includes('/api/business/company-profile'))) return new Response(JSON.stringify({ ok: false, errors: [{ code: 'NOT_FOUND' }] }), { status: 404, headers: { 'content-type': 'application/json' } })
  console.warn('[harness] refused', method, url)
  return new Response(JSON.stringify({ ok: false, error: { message: 'harness: network disabled' } }), { status: 503, headers: { 'content-type': 'application/json' } })
}

function Screen({ which }: { which: string }) {
  const { setSelectedRfqId, navigate } = useProcurement()
  useEffect(() => { setSelectedRfqId(RFQ_ID) }, [setSelectedRfqId])
  if (which === 'new') return <NewRequestV2 navigate={navigate} />
  if (which === 'targeting' || which === 'activity-filter') return <TargetingPage onTemplates={() => {}} />
  if (which === 'templates') return <TemplatesPage onBack={() => {}} onNew={() => {}} />
  if (which === 'template-new') return <TemplateEditor onBack={() => {}} />
  return which.startsWith('comparison') ? <ComparisonV2 navigate={navigate} /> : <RequestTrackingV2 navigate={navigate} />
}

// ?bg=1 mounts the living background behind the screen (QA: Ahmad sit-outs, frame times)
const withBg = new URLSearchParams(window.location.search).has('bg')

export function mountHarness(which: string) {
  // Same app scope as App.tsx, so fixtures render in the B2B tokens.
  document.documentElement.dataset.farqApp = 'b2b'
  createRoot(document.getElementById('root')!).render(
    <ProcurementProvider>{withBg ? <LiveBackground /> : null}<div className="farq-b2b farq-dots" data-farq-b2b style={{ width: withBg || window.innerWidth < 768 ? '100%' : which === 'new' ? 1440 : 1176 }}><Screen which={which} /></div></ProcurementProvider>,
  )
}
