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
  if (which === 'targeting') return <TargetingPage onTemplates={() => {}} />
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
