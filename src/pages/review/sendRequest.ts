// Copied from فرق بناء (read-only source): farqconstraction/src/mobile/screens/NewRequestScreen.tsx — send() at ios-app@5147808 (committed).
// The statements that build and send the request are the source's, line for line; only the React state
// plumbing around them is passed in (setProgress / setCreatedId / askWhatsApp). Do not edit business logic here.
// Proof: docs/qa/request-flow/send-source.diff (text, against docs/qa/m4/send-source-5147808.txt)
//        and docs/qa/request-flow/payload.diff (runtime payload, intercepted in Playwright — empty).
import {
  countHarajSupplierIds,
  createConstructionRfq,
  fetchConstructionWhatsAppPricing,
  getConstructionDispatch,
  getConstructionRfq,
  invitePreferredChannel,
  matchConstructionBoqCatalog,
  startConstructionDispatch,
} from '../../api/constructionClient'
import { resolveRfqSupplierIds } from '../../api/constructionSuppliers'
import { farqSession } from '../../api/farqSession'
import type { CompanyProfile } from '../../lib/companyProfile'
import { buildRfqLinesFromItems, buildRfqPackagesFromSelection } from '../../lib/rfqPackages'
import { cleanLineName, parseQty } from '../../lib/sendGuards'
import type { BOQItem } from '../../types'

export type SendProgress = { text: string; done: number; total: number }
export type SendSummary = { sent: number; failed: number; total: number }

export type SendInput = {
  readyItems: BOQItem[]
  allPicked: string[]
  selected: Record<number, string[]>
  department: string
  city: string
  project: string
  requiredDate: string
  quoteDeadline: string
  requestType: 'SUPPLY_ONLY' | 'SUPPLY_AND_INSTALL'
  profile: CompanyProfile
}

export type SendHooks = {
  setProgress: (p: SendProgress) => void
  /** Called as soon as the request exists on the server (before dispatch). */
  setCreatedId: (id: string) => void
  /** The paid-WhatsApp question; resolves with the account holder's answer. */
  askWhatsApp: (count: number, price: number) => Promise<boolean>
  setSummary: (s: SendSummary) => void
}

/**
 * Creates the request and starts the server-side dispatch, exactly as the source flow.
 * Throws with the source's Arabic messages; `createdId` (via setCreatedId) tells the caller
 * whether the request already exists when an error is thrown.
 */
export async function sendRequest(input: SendInput, hooks: SendHooks): Promise<void> {
  const { readyItems, allPicked, selected, department, city, project, requiredDate, quoteDeadline, requestType, profile } = input
  const { setProgress, setCreatedId, askWhatsApp, setSummary } = hooks

  setProgress({ text: 'نجهّز البنود…', done: 0, total: 0 })
  const needSpec = readyItems.filter((i) => !i.farqSpecId)
  const matched = needSpec.length
    ? await matchConstructionBoqCatalog({
        lines: needSpec.map((i) => ({ line_key: i.lineKey || `line-${i.id}`, name_ar: i.name, quantity: parseQty(i.qty), uom: i.unit || undefined, spec: i.spec })),
      }).catch(() => null)
    : null
  const byKey = new Map((matched?.rows || []).map((r) => [r.line_key, r]))
  const rfqLines = buildRfqLinesFromItems(
    readyItems.map((i) => ({ ...i, name: cleanLineName(i.name) })),
    { specIdForLine: (k) => byKey.get(k)?.farq_spec_id, uomForLine: (k) => (byKey.get(k) as { uom?: string } | undefined)?.uom, parseQty },
  )
  if (!rfqLines.length) throw new Error('لا توجد بنود جاهزة للإرسال.')

  setProgress({ text: 'نتحقق من الموردين…', done: 0, total: 0 })
  const contactable = new Set(await resolveRfqSupplierIds(allPicked))
  if (contactable.size < 2) throw new Error('يلزم موردان على الأقل يمكن التواصل معهم.')
  const scoped: Record<number, string[]> = {}
  for (const i of readyItems) scoped[i.id] = (selected[i.id] || []).filter((id) => contactable.has(String(id)))
  const { packages: draft } = buildRfqPackagesFromSelection({ items: readyItems, selectedByItem: scoped, fallbackDepartment: department })
  const packages = draft.filter((p) => p.selected_supplier_ids.length > 0)
  const keys = new Set(packages.flatMap((p) => p.line_keys))
  const scopedLines = rfqLines.filter((l) => keys.has(String(l.line_key)))
  const supplierIds = [...new Set(packages.flatMap((p) => p.selected_supplier_ids))]
  if (supplierIds.length < 2 || !scopedLines.length) throw new Error('يلزم موردان على الأقل مربوطان ببنود الطلب.')

  setProgress({ text: `ننشئ الطلب لـ ${supplierIds.length} موردين…`, done: 0, total: supplierIds.length })
  const user = farqSession.getUser()
  const body: Record<string, unknown> = {
    manual_send: true,
    send_consent: false,
    engineering_department: department || 'CIVIL',
    selected_supplier_ids: supplierIds,
    delivery: {
      city: city.trim(),
      site_address: project.trim() ? `${project.trim()} — ${city.trim()}` : city.trim(),
      required_date: requiredDate,
      unloading_requirement: 'SUPPLIER_UNLOAD',
      delivery_required: true,
    },
    commercial_terms: { currency: 'SAR', payment_terms: 'BANK_TRANSFER' },
    quote_deadline: quoteDeadline,
    quote_deadline_time: '17:00',
    request_type: requestType,
    buyer: {
      company_name: profile.name,
      contact_name: user?.displayName?.trim() || user?.email?.trim() || profile.name,
      email: user?.email?.trim() || profile.email,
      phone: profile.phone,
      city: profile.city,
      ...(profile.legalName ? { legal_name: profile.legalName } : {}),
      ...(profile.crNumber ? { cr_number: profile.crNumber } : {}),
      ...(profile.vatNumber ? { vat_number: profile.vatNumber } : {}),
      ...(profile.nationalAddress ? { national_address: profile.nationalAddress } : {}),
    },
    lines: scopedLines,
    packages,
  }
  const haraj = countHarajSupplierIds(supplierIds)
  if (haraj > 0) body.haraj_limit = haraj
  const created = await createConstructionRfq(body, { timeoutMs: 90_000 })
  setCreatedId(created.id)

  const detail = await getConstructionRfq(created.id)
  const invites = detail.invitations || []
  const waCount = invites.filter((i) => invitePreferredChannel(i) === 'WHATSAPP').length
  let waPaid = false
  if (waCount) {
    const pricing = await fetchConstructionWhatsAppPricing().catch(() => null)
    if (pricing?.enabled && pricing.price_sar) {
      waPaid = await askWhatsApp(waCount, pricing.price_sar)
    }
  }

  await startConstructionDispatch(created.id, { whatsappPaid: waPaid, includeHaraj: true })
  let total = invites.length
  for (let guard = 0; guard < 240; guard += 1) {
    await new Promise((r) => window.setTimeout(r, 2500))
    const job = await getConstructionDispatch(created.id).catch(() => null)
    if (!job) continue
    total = job.total || total
    setProgress({ text: `نرسل للموردين: ${job.processed || 0} من ${total}`, done: job.processed || 0, total })
    if (['DONE', 'FAILED', 'CANCELLED'].includes(String(job.state))) {
      setSummary({ sent: job.sent || 0, failed: job.failed || 0, total })
      break
    }
  }
}
