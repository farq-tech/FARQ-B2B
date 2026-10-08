/*
 * DEV-ONLY fixtures for the visual harness (src/dev/harness.tsx). Illustrative
 * numbers that exist only to render screens 03/04 reproducibly for screenshot
 * comparison. Never imported by production code: main.tsx loads the harness
 * behind `import.meta.env.DEV`, so Vite drops this file from `vite build`.
 */
const NOW = Date.parse('2026-10-08T09:00:00Z')
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString()

export const RFQ_ID = '00000000-0000-4000-8000-000000000001'
const sup = (n: number, name: string, city: string) => ({ id: `s${n}`, name_ar: name, city })
const SUPPLIERS = [
  sup(1, 'مستودع الرياض للكهرباء', 'الرياض · السلي'),
  sup(2, 'مؤسسة النور للكهرباء', 'الرياض · العزيزية'),
  sup(3, 'شركة الخليج للكابلات', 'الدمام · الصناعية الثانية'),
  sup(4, 'مؤسسة البناء الحديث', 'الرياض · الملز'),
  sup(5, 'مؤسسة الأفق للإنارة', 'الخرج'),
]
const sent = (channel: 'WHATSAPP' | 'EMAIL', min: number) => [{ channel, message_type: 'RFQ' as const, status: 'SENT', sent_at: iso(min), failure_code: null }]

export const rfq = {
  id: RFQ_ID,
  status: 'SENT',
  created_at: iso(120),
  engineering_department: { key: 'ELECTRICAL', label_ar: 'القسم الكهربائي' },
  current_version: {
    id: 'v1', version_number: 1,
    payload: {
      delivery: { city: 'الرياض', site_address: 'توريد كهرباء — فيلا النرجس — الرياض', required_date: '2026-10-20' },
      lines: Array.from({ length: 5 }, (_, i) => ({ line_key: `l${i + 1}` })),
    },
  },
  award: null,
  supplier_count: 5,
  response_count: 3,
  invitations: [
    { id: 'i1', supplier_id: 's1', delivery_status: 'SENT', response_status: 'QUOTED', opened_at: iso(90), preferred_channel: 'WHATSAPP', supplier: SUPPLIERS[0], dispatch_attempts: sent('WHATSAPP', 118) },
    { id: 'i2', supplier_id: 's2', delivery_status: 'SENT', response_status: 'QUOTED', opened_at: iso(60), preferred_channel: 'EMAIL', supplier: SUPPLIERS[1], dispatch_attempts: sent('EMAIL', 118) },
    { id: 'i3', supplier_id: 's3', delivery_status: 'SENT', response_status: 'QUOTED', opened_at: iso(80), preferred_channel: 'WHATSAPP', supplier: SUPPLIERS[2], dispatch_attempts: sent('WHATSAPP', 118) },
    { id: 'i4', supplier_id: 's4', delivery_status: 'SENT', response_status: 'AWAITING_QUOTE', opened_at: null, preferred_channel: 'WHATSAPP', supplier: SUPPLIERS[3], dispatch_attempts: sent('WHATSAPP', 117) },
    { id: 'i5', supplier_id: 's5', delivery_status: 'SENT', response_status: 'AWAITING_QUOTE', opened_at: iso(70), preferred_channel: 'EMAIL', supplier: SUPPLIERS[4], dispatch_attempts: sent('EMAIL', 117) },
  ],
}

const LINES = [
  ['l1', 'كيبل نحاس 4×16 مم²', 500, 'متر', [47380, 49277.5, 51520]],
  ['l2', 'قاطع كهربائي 32 أمبير', 40, 'حبة', [3266, 3588, null]],
  ['l3', 'ماسورة PPR قطر 25 مم', 200, 'حبة', [3588, null, 3335]],
  ['l4', 'كشاف LED سقفي 50 واط', 60, 'حبة', [7038, 6555, 'UNAVAILABLE']],
  ['l5', 'خزان مياه علوي 2,000 لتر', 4, 'حبة', [6670, null, 6992]],
] as const

export const comparison = {
  rfq,
  supplier_responses: [
    { supplier: { id: 's1', name_ar: SUPPLIERS[0].name_ar }, offer: { quoteVersionId: 'q1', inviteId: 'i1', submittedAt: iso(25), totals: { total: 41200 }, prices_include_tax: true, lead_time_days: 3 } },
    { supplier: { id: 's2', name_ar: SUPPLIERS[1].name_ar }, offer: { quoteVersionId: 'q2', inviteId: 'i2', submittedAt: iso(2), totals: { total: 42500 }, prices_include_tax: true, lead_time_days: 5 } },
    { supplier: { id: 's3', name_ar: SUPPLIERS[2].name_ar }, offer: { quoteVersionId: 'q3', inviteId: 'i3', submittedAt: iso(50), totals: { total: 61847 }, prices_include_tax: true, lead_time_days: 7 } },
  ],
  quote_matrix: {
    basis: 'INCLUSIVE', requested_line_count: 5, supplier_count: 3, complete_quote_count: 1,
    lines: LINES.map(([id, name, qty, uom, prices]) => ({
      id, name_ar: name, quantity: qty, uom,
      offers: (prices as readonly (number | null | string)[]).map((p, k) => ({
        supplier_id: `s${k + 1}`,
        status: p === null ? 'NOT_QUOTED' : typeof p === 'string' ? p : 'PRICED',
        unit_price: typeof p === 'number' ? p / qty : null,
        line_total: typeof p === 'number' ? p : null,
        quantity: qty, currency: 'SAR', prices_include_tax: true,
      })),
    })),
    supplier_summaries: [
      { supplier_id: 's1', coverage: { requested: 5, priced: 5, complete: true } },
      { supplier_id: 's2', coverage: { requested: 5, priced: 3, complete: false } },
      { supplier_id: 's3', coverage: { requested: 5, priced: 3, complete: false } },
    ],
  },
}

export const outcomes = { events: [{ id: 'e1', event_type: 'LINE_DECLINED', supplier_id: 's5', created_at: iso(40), details: { line_id: 'l4' } }] }
export const FIXED_NOW = NOW

/*
 * Variant for the keyboard test (`?harness=comparison-award`): receipt closed and
 * two complete offers, so «ترسية» is enabled. Same suppliers; s3 also prices l2 and l4.
 */
const closedRfq = { ...rfq, status: 'CLOSED', submission_closed_at: iso(10) }
const awardLines = comparison.quote_matrix.lines.map((line) => ({
  ...line,
  offers: line.offers.map((c) => (c.supplier_id === 's3' && c.status !== 'PRICED'
    ? { ...c, status: 'PRICED', line_total: line.id === 'l2' ? 3410 : 6890, unit_price: (line.id === 'l2' ? 3410 : 6890) / line.quantity }
    : c)),
}))
export const comparisonAward = {
  ...comparison,
  rfq: closedRfq,
  quote_matrix: {
    ...comparison.quote_matrix,
    complete_quote_count: 2,
    lines: awardLines,
    supplier_summaries: comparison.quote_matrix.supplier_summaries.map((s) => (s.supplier_id === 's3' ? { ...s, coverage: { requested: 5, priced: 5, complete: true } } : s)),
  },
}
export const rfqClosed = closedRfq

/*
 * New-request flow (`?harness=new`): local answers for the calls that flow makes.
 * Built from the request body so every typed line gets suppliers. Nothing is sent.
 */
const FLOW_SUPPLIERS = [
  { id: 'fx-s1', name_ar: 'مستودع الرياض للكهرباء', city: 'الرياض', evidence: 'دليل مباشر', channel: 'واتساب', contact_channels: { whatsapp: true } },
  { id: 'fx-s2', name_ar: 'مؤسسة النور للكهرباء', city: 'الرياض', evidence: 'نشاط متطابق', channel: 'بريد', contact_channels: { email: true } },
  { id: 'fx-s3', name_ar: 'شركة الخليج للكابلات', city: 'الدمام', evidence: 'دليل مباشر', channel: 'واتساب', contact_channels: { whatsapp: true } },
  { id: 'fx-s4', name_ar: 'مؤسسة البناء الحديث', city: 'الرياض', evidence: 'من الكتالوج', channel: 'واتساب', contact_channels: { whatsapp: true } },
]
export function flowMatch(body: { rows?: Array<{ key?: string; name?: string }> }) {
  return {
    rows: (body.rows || []).map((r, i) => ({
      key: r.key,
      kind: 'MATCH',
      match: /خرسانة|مزدوج/.test(String(r.name || '')) ? null : {
        farq_spec_id: `fx-spec-${i}`,
        name_ar: r.name,
        rfq_eligible_supplier_ids: FLOW_SUPPLIERS.slice(0, 3 + (i % 2)).map((s) => s.id),
        suppliers: FLOW_SUPPLIERS.slice(0, 3 + (i % 2)),
      },
    })),
  }
}
export const flowCatalog = { suppliers: FLOW_SUPPLIERS.map((s) => ({ ...s, has_whatsapp: Boolean(s.contact_channels.whatsapp), has_email: Boolean(s.contact_channels.email) })), supplier_total: FLOW_SUPPLIERS.length }
export const flowScan = {
  request: {
    is_purchase_request: true, project: 'فيلا النرجس', request_number: null, request_date: null, requester: null, pages_read: 1, pages_failed: 0,
    items: [
      { description: 'كيبل نحاس 4×16 مم² مسلّح', quantity: 500, unit: 'متر', specification: 'XLPE/SWA · 0.6/1kV' },
      { description: 'قاطع كهربائي 32 أمبير', quantity: 40, unit: 'حبة', specification: '3 أقطاب · 10kA' },
      { description: 'مفتاح إنارة مزدوج', quantity: 120, unit: 'حبة', specification: null },
    ],
  },
}
