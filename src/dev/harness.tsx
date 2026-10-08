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
import { RFQ_ID, rfq, rfqClosed, comparison, comparisonAward, outcomes, FIXED_NOW } from './fixtures'

Date.now = () => FIXED_NOW + 60_000
const awardVariant = new URLSearchParams(window.location.search).get('harness') === 'comparison-award'
// Fixtures only: every other request is refused, so nothing in the harness can reach the real API
// (e.g. pressing «ترسية» in a test never writes an award).
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (method === 'GET' && url.includes(`/rfqs/${RFQ_ID}/comparison`)) return ok(awardVariant ? comparisonAward : comparison)
  if (method === 'GET' && url.includes(`/rfqs/${RFQ_ID}/supplier-outcomes`)) return ok(outcomes)
  if (method === 'GET' && url.includes(`/rfqs/${RFQ_ID}`)) return ok(awardVariant ? rfqClosed : rfq)
  return new Response(JSON.stringify({ ok: false, error: { message: 'harness: network disabled' } }), { status: 503, headers: { 'content-type': 'application/json' } })
}

function Screen({ which }: { which: string }) {
  const { setSelectedRfqId, navigate } = useProcurement()
  useEffect(() => { setSelectedRfqId(RFQ_ID) }, [setSelectedRfqId])
  return which.startsWith('comparison') ? <ComparisonV2 navigate={navigate} /> : <RequestTrackingV2 navigate={navigate} />
}

export function mountHarness(which: string) {
  createRoot(document.getElementById('root')!).render(
    <ProcurementProvider><div style={{ width: 1176 }}><Screen which={which} /></div></ProcurementProvider>,
  )
}
