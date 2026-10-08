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
import { RFQ_ID, rfq, comparison, outcomes, FIXED_NOW } from './fixtures'

Date.now = () => FIXED_NOW + 60_000
const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.includes(`/rfqs/${RFQ_ID}/comparison`)) return ok(comparison)
  if (url.includes(`/rfqs/${RFQ_ID}/supplier-outcomes`)) return ok(outcomes)
  if (url.includes(`/rfqs/${RFQ_ID}`)) return ok(rfq)
  return realFetch(input, init)
}

function Screen({ which }: { which: string }) {
  const { setSelectedRfqId, navigate } = useProcurement()
  useEffect(() => { setSelectedRfqId(RFQ_ID) }, [setSelectedRfqId])
  return which === 'comparison' ? <ComparisonV2 navigate={navigate} /> : <RequestTrackingV2 navigate={navigate} />
}

export function mountHarness(which: string) {
  createRoot(document.getElementById('root')!).render(
    <ProcurementProvider><div style={{ width: 1176 }}><Screen which={which} /></div></ProcurementProvider>,
  )
}
