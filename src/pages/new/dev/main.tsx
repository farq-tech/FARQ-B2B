/*
 * DEV-ONLY preview of the request flow: http://localhost:5192/src/pages/new/dev/index.html?flow=new|legacy
 *   flow=new    → src/pages/new (this track)
 *   flow=legacy → src/views/NewRequestV2.tsx (M4), kept as the payload reference
 * Not imported by the app and not a `vite build` input.
 *
 * Network: matching, the catalogue and the scan are answered locally from src/dev/fixtures (same answers
 * as ?harness=new; window.__FARQ_DELAY__ slows them to show loading states). Every other call is REFUSED here unless a Playwright test has set
 * window.__FARQ_ROUTE_ONLY__ — and then it goes to page.route(), which fulfils it without any network.
 * Nothing in this preview can reach the real API.
 */
import { createRoot } from 'react-dom/client'
import '../../../index.css'
import { ProcurementProvider, useProcurement } from '../../../procurementContext'
import { flowCatalog, flowMatch, flowScan } from '../../../dev/fixtures'
import { NewRequestV2 } from '../../../views/NewRequestV2'
import NewRequestPage from '../index'

declare global {
  interface Window { __FARQ_ROUTE_ONLY__?: boolean; __FARQ_DELAY__?: number }
}

const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (window.__FARQ_DELAY__) await new Promise((r) => window.setTimeout(r, window.__FARQ_DELAY__))
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  if (method === 'POST' && url.includes('/boq/match')) return json({ ok: true, data: flowMatch(JSON.parse(String(init?.body || '{}'))) })
  if (method === 'GET' && url.includes('/api/construction/catalog')) return json({ ok: true, data: flowCatalog })
  if (method === 'POST' && url.includes('/purchase-requests/scan')) return json({ ok: true, data: flowScan })
  if (window.__FARQ_ROUTE_ONLY__) return realFetch(input, init)
  console.warn('[dev] refused', method, url)
  return new Response(JSON.stringify({ ok: false, error: { message: 'dev preview: network disabled' } }), { status: 503, headers: { 'content-type': 'application/json' } })
}

function Screen() {
  const { navigate, view } = useProcurement()
  const legacy = new URLSearchParams(window.location.search).get('flow') === 'legacy'
  return (
    <>
      <p hidden data-testid="view">{view}</p>
      {legacy ? <NewRequestV2 navigate={navigate} /> : <NewRequestPage navigate={navigate} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<ProcurementProvider><Screen /></ProcurementProvider>)
