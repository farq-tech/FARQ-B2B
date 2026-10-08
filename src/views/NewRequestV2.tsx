import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavProps } from '../types'
import { useProcurement } from '../procurementContext'
import {
  countHarajSupplierIds,
  createConstructionRfq,
  fetchConstructionWhatsAppPricing,
  getConstructionDispatch,
  getConstructionRfq,
  invitePreferredChannel,
  matchConstructionBoqCatalog,
  parseConstructionBoqPdf,
  startConstructionDispatch,
  type BoqReadProgress,
} from '../api/constructionClient'
import { resolveRfqSupplierIds } from '../api/constructionSuppliers'
import { farqSession } from '../api/farqSession'
import { autoPickFor, buildPickContext } from '../lib/autoPick'
import { loadCompanyProfile } from '../lib/companyProfile'
import { matchSuppliersForItems, rowsToLines, sanitizeBoqLines, type ParsedLine } from '../lib/parseBoq'
import { buildRfqLinesFromItems, buildRfqPackagesFromSelection, departmentForBoqItem, dominantEngineeringDepartment } from '../lib/rfqPackages'
import { cleanLineName, parseQty, readQty } from '../lib/sendGuards'
import { shrinkImage } from '../lib/imageShrink'
import { scanPurchaseRequest } from '../lib/purchaseRequests'
import type { BOQItem, Supplier } from '../types'
import { Badge, Button, Chip, Dropzone, EvidenceBadge, FlowFooter, FlowHeader, Icon, Input, OptionCard, Tabs, useIsMobile, type EvidenceLevel } from '../ui'

/*
 * «01 طلب جديد ← 02 مراجعة البنود ← التوصيل ← الإرسال» — Figma 38:2 and 42:44.
 * Steps 3–4 have no Figma frame; they are composed from the same src/ui components.
 * The request is built and sent exactly as فرق بناء's committed new-request flow
 * (src/mobile/screens/NewRequestScreen.tsx @5147808): same API calls, same payload.
 */

type Method = 'booklet' | 'typed' | 'photo'
type Step = 0 | 1 | 2 | 3
const STEPS = ['الطلب', 'البنود', 'التوصيل', 'الإرسال']
const UNITS = ['حبة', 'م²', 'م³', 'م.ط', 'طن', 'كجم', 'كيس', 'لتر', 'لفة', 'مقطوعية']
const DEPARTMENTS: Array<[string, string]> = [['CIVIL', 'مدني'], ['ARCHITECTURAL', 'معماري'], ['ELECTRICAL', 'كهرباء'], ['MECHANICAL', 'ميكانيكا']]
const DEPT_LABEL = Object.fromEntries(DEPARTMENTS) as Record<string, string>
const AUTO_PICK = 10
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function isoIn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Every supplier the item knows about, de-duplicated (same order as the source flow). */
function candidatesFor(item: BOQItem): Supplier[] {
  const all = [...(item.learnedSuggestion?.suppliers || []), ...(item.mapSuggestion?.suppliers || []), ...item.suppliers, ...(item.aiSuggestion?.suppliers || []), ...(item.familySuggestion?.suppliers || [])]
  const seen = new Set<string>()
  return all.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}

/** The API's own evidence label, coloured by strength. Never re-worded. */
function evidenceLevel(e: Supplier['evidence']): EvidenceLevel | null {
  if (e === 'دليل مباشر' || e === 'دليل منتج') return 'Strong'
  if (e === 'نشاط متطابق' || e === 'على مستوى النشاط' || e === 'خريطة فرق') return 'Medium'
  if (e === 'من الكتالوج' || e === 'تسمية آلية') return 'Weak'
  return null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || '').split(',')[1] || '')
    r.onerror = () => reject(new Error('تعذّر فتح الملف.'))
    r.readAsDataURL(file)
  })
}

export function NewRequestV2({ navigate }: NavProps) {
  const { setSelectedRfqId } = useProcurement()
  const [step, setStep] = useState<Step>(0)
  const mobile = useIsMobile()
  // Each step starts at the top (the footer button sits at the bottom of a long page).
  useEffect(() => { window.scrollTo({ top: 0 }) }, [step])
  const [method, setMethod] = useState<Method>('booklet')
  const [lines, setLines] = useState<ParsedLine[]>([])
  const nextId = useRef(1)
  const [source, setSource] = useState<string | null>(null)
  const [sourceKind, setSourceKind] = useState<'file' | 'photo' | 'typed' | null>(null)
  const [reading, setReading] = useState<{ name: string; progress: number; note: string } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // typed entry
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('حبة')

  // review
  const [items, setItems] = useState<BOQItem[]>([])
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [tab, setTab] = useState<string>('all')
  const [open, setOpen] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  // delivery
  const profile = loadCompanyProfile()
  // «هلا سارة» in Figma: only a real display name, never the e-mail.
  const greeting = (farqSession.getUser()?.displayName || '').trim().split(/\s+/)[0] || ''
  const [project, setProject] = useState('')
  const [city, setCity] = useState(profile.defaultDeliveryCity || 'الرياض')
  const [requiredDate, setRequiredDate] = useState(isoIn(profile.defaultDeadlineDays || 14))
  const [quoteDeadline, setQuoteDeadline] = useState(isoIn(5))
  const [requestType, setRequestType] = useState<'SUPPLY_ONLY' | 'SUPPLY_AND_INSTALL'>('SUPPLY_ONLY')
  const [department, setDepartment] = useState('')

  // sending
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState<{ text: string; done: number; total: number }>({ text: '', done: 0, total: 0 })
  const [waAsk, setWaAsk] = useState<{ count: number; price: number; resolve: (yes: boolean) => void } | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ sent: number; failed: number; total: number } | null>(null)

  const addLines = (read: ParsedLine[]) => setLines((prev) => [...prev, ...read.map((l) => ({ ...l, id: nextId.current++ }))])

  /* ---------- step 0: read the request ---------- */

  async function onFiles(files: File[]) {
    setReadError(null)
    setError(null)
    try {
      if (method === 'photo') {
        const pages: Array<{ mime: string; base64: string }> = []
        for (const f of files) {
          if (/^image\//.test(f.type)) pages.push(await shrinkImage(f))
          else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) pages.push({ mime: 'application/pdf', base64: await fileToBase64(f) })
        }
        if (!pages.length) throw new Error('اختر صورة أو ملف PDF.')
        setReading({ name: files.length > 1 ? `${files.length} صفحات` : files[0].name, progress: 30, note: 'نقرأ الصفحات…' })
        const { request } = await scanPurchaseRequest(pages)
        const read = request.items
          .filter((i) => String(i.description || '').trim())
          .map((i, k) => ({ id: k, name: i.description.trim(), qty: i.quantity != null ? String(i.quantity) : '', unit: i.unit || 'حبة', spec: i.specification || undefined }))
        if (!read.length) throw new Error('ما لقينا بنود في الصورة. صوّر الصفحة كاملة وبإضاءة جيدة.')
        if (request.project && !project) setProject(request.project)
        addLines(read)
        setSource(files.length > 1 ? `${files.length} صور` : files[0].name)
        setSourceKind((k) => k || 'photo')
        return
      }
      const file = files[0]
      if (!file) return
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      const isXlsx = file.type === XLSX || /\.xlsx$/i.test(file.name)
      if (!isPdf && !isXlsx) throw new Error('ارفع الكراسة بصيغة PDF أو Excel (xlsx).')
      if (file.size > 25 * 1024 * 1024) throw new Error('الملف أكبر من 25 ميجابايت — قسّمه أو صدّره PDF أصغر.')
      setReading({ name: file.name, progress: 5, note: 'بدأنا القراءة…' })
      let read: ParsedLine[]
      if (isPdf) {
        const result = await parseConstructionBoqPdf(file, (p: BoqReadProgress) => setReading({
          name: file.name,
          progress: p.pageCount ? Math.round((p.pagesDone / p.pageCount) * 100) : 20,
          note: p.pageCount ? `صفحة ${p.pagesDone} من ${p.pageCount} · ${p.itemCount} بند` : `${p.itemCount} بند حتى الآن`,
        }))
        read = sanitizeBoqLines(rowsToLines(result.rows || []))
      } else {
        setReading({ name: file.name, progress: 40, note: 'نقرأ الجدول…' })
        const { request } = await scanPurchaseRequest([{ mime: XLSX, base64: await fileToBase64(file) }])
        read = request.items
          .filter((i) => String(i.description || '').trim())
          .map((i, k) => ({ id: k, name: i.description.trim(), qty: i.quantity != null ? String(i.quantity) : '', unit: i.unit || 'حبة', spec: i.specification || undefined }))
      }
      if (!read.length) throw new Error('ما لقينا بنود في هذا الملف. تأكد أنه جدول كميات.')
      addLines(read)
      setSource(file.name)
      setSourceKind((k) => k || 'file')
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'تعذّرت قراءة الملف.')
    } finally {
      setReading(null)
    }
  }

  function addTyped() {
    const n = cleanLineName(name)
    if (!n) return setError('اكتب اسم البند.')
    if (!readQty(qty)) return setError('اكتب كمية صحيحة أكبر من صفر.')
    setError(null)
    addLines([{ id: 0, name: n, qty: qty.trim(), unit }])
    setName('')
    setQty('')
    if (!source) setSource('مكتوبة يدويًا')
    setSourceKind((k) => k || 'typed')
  }

  const usable = useMemo(() => lines.filter((l) => cleanLineName(l.name) && readQty(l.qty)), [lines])
  const unusable = lines.length - usable.length

  async function toReview() {
    if (!usable.length) return setError('أضف بندًا واحدًا على الأقل بكمية صحيحة.')
    setError(null)
    setBusy('نبحث عن موردين لكل بند…')
    try {
      const { items: matched } = await matchSuppliersForItems(usable)
      const ctx = buildPickContext(matched)
      const picks: Record<number, string[]> = {}
      for (const item of matched) if (!item.workOnly) picks[item.id] = autoPickFor(item, AUTO_PICK, ctx).map((s) => s.id)
      setItems(matched)
      setSelected(picks)
      setDepartment((d) => d || dominantEngineeringDepartment(matched) || 'CIVIL')
      setStep(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر البحث عن موردين.')
    } finally {
      setBusy(null)
    }
  }

  /* ---------- step 1: review ---------- */

  const allPicked = useMemo(() => [...new Set(Object.values(selected).flat())], [selected])
  const readyItems = useMemo(() => items.filter((i) => !i.workOnly && (selected[i.id] || []).length > 0), [items, selected])
  const needsCheck = useMemo(() => items.filter((i) => i.workOnly || !(selected[i.id] || []).length), [items, selected])
  const deptOf = (i: BOQItem) => departmentForBoqItem(i) || 'OTHER'
  const byDept = useMemo(() => {
    const m = new Map<string, { items: number; suppliers: Set<string>; direct: Set<string> }>()
    for (const i of items) {
      const k = deptOf(i)
      const e = m.get(k) || { items: 0, suppliers: new Set<string>(), direct: new Set<string>() }
      e.items += 1
      const picked = new Set(selected[i.id] || [])
      for (const s of candidatesFor(i)) if (picked.has(s.id)) { e.suppliers.add(s.id); if (evidenceLevel(s.evidence) === 'Strong') e.direct.add(s.id) }
      m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => b[1].items - a[1].items)
  }, [items, selected])
  const tabs = [{ key: 'all', label: `كل البنود (${items.length})` }, { key: 'check', label: `تحتاج تأكيد (${needsCheck.length})` }, ...byDept.map(([k, v]) => ({ key: k, label: `${DEPT_LABEL[k] || 'غير مصنّف'} (${v.items})` }))]
  const visible = items.filter((i) => tab === 'all' || (tab === 'check' ? needsCheck.includes(i) : deptOf(i) === tab))
  const shown = showAll ? visible : visible.slice(0, 12)

  function toggle(itemId: number, supplierId: string) {
    setSelected((prev) => {
      const cur = prev[itemId] || []
      return { ...prev, [itemId]: cur.includes(supplierId) ? cur.filter((x) => x !== supplierId) : [...cur, supplierId] }
    })
  }

  function supplierPicker(i: BOQItem) {
    const picked = selected[i.id] || []
    const cands = candidatesFor(i)
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-medium">موردين «{i.name}»</legend>
        {cands.length === 0 ? <p className="text-[14px] text-[var(--color-text-secondary)]">ما لقينا مورد لهذا البند في السجل.</p> : null}
        {cands.map((s) => {
          const lvl = evidenceLevel(s.evidence)
          return (
            <label key={s.id} className="flex cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(i.id, s.id)} className="size-4 accent-[var(--color-bg-primary)]" />
              <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
              <span className="text-[12px] text-[var(--color-text-secondary)]">{s.city}</span>
              {lvl ? <EvidenceBadge level={lvl} label={s.evidence} /> : <Badge tone="Neutral" label={s.evidence} showDot={false} />}
            </label>
          )
        })}
      </fieldset>
    )
  }

  /* ---------- step 2/3: delivery and send (same blockers and payload as the source) ---------- */

  const blockers: string[] = []
  if (allPicked.length < 2) blockers.push('اختر موردين اثنين على الأقل.')
  if (!city.trim()) blockers.push('اكتب مدينة التسليم.')
  if (!quoteDeadline || !requiredDate || quoteDeadline >= requiredDate) blockers.push('آخر موعد للعروض يجب أن يسبق موعد التوريد.')

  async function send() {
    if (blockers.length || sending) return
    setSending(true)
    setError(null)
    let created: string | null = null
    try {
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
      const rfq = await createConstructionRfq(body, { timeoutMs: 90_000 })
      created = rfq.id
      setCreatedId(rfq.id)

      const detail = await getConstructionRfq(rfq.id)
      const invites = detail.invitations || []
      const waCount = invites.filter((i) => invitePreferredChannel(i) === 'WHATSAPP').length
      let waPaid = false
      if (waCount) {
        const pricing = await fetchConstructionWhatsAppPricing().catch(() => null)
        if (pricing?.enabled && pricing.price_sar) {
          waPaid = await new Promise<boolean>((resolve) => setWaAsk({ count: waCount, price: pricing.price_sar!, resolve }))
          setWaAsk(null)
        }
      }

      await startConstructionDispatch(rfq.id, { whatsappPaid: waPaid, includeHaraj: true })
      let total = invites.length
      for (let guard = 0; guard < 240; guard += 1) {
        await new Promise((r) => window.setTimeout(r, 2500))
        const job = await getConstructionDispatch(rfq.id).catch(() => null)
        if (!job) continue
        total = job.total || total
        setProgress({ text: `نرسل للموردين: ${job.processed || 0} من ${total}`, done: job.processed || 0, total })
        if (['DONE', 'FAILED', 'CANCELLED'].includes(String(job.state))) {
          setSummary({ sent: job.sent || 0, failed: job.failed || 0, total })
          break
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر إرسال الطلب.')
      if (!created) setSending(false)
    }
  }

  function openRequest() {
    if (!createdId) return
    setSelectedRfqId(createdId)
    navigate('rfq-detail')
  }

  /* ---------- UI ---------- */

  const close = () => navigate('rfq-list')
  const back = step === 0 ? <Button variant="Ghost" size="L" onClick={close}>رجوع</Button>
    : sending ? null
      : <Button variant="Ghost" size="L" onClick={() => setStep((s) => (s - 1) as Step)}>رجوع</Button>

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
      <FlowHeader steps={STEPS} current={step} onClose={close} mobileTitle={step === 0 ? undefined : step === 1 ? 'مراجعة البنود' : STEPS[step]} onBack={sending ? undefined : () => setStep((s) => (s - 1) as Step)} />

      <main className={mobile ? 'flex-1 px-4 pb-6' : 'flex-1 px-12 pb-10'}>
        {error ? <p role="alert" className="mx-auto mb-4 max-w-[752px] rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-4 py-3 text-[14px] text-[var(--color-text-danger)]">{error}</p> : null}

        {step === 0 ? (
          <section aria-labelledby="q-h" className={mobile ? 'flex flex-col items-stretch gap-4 pt-2' : 'mx-auto flex max-w-[760px] flex-col items-center gap-8 pt-12'}>
            <div className={mobile ? 'flex flex-col items-start gap-1' : 'flex flex-col items-center gap-2 text-center'}>
              {greeting ? <p className="text-[18px] leading-[30px] text-[var(--color-text-secondary)]">هلا {greeting}</p> : null}
              <h1 id="q-h" className={`font-[family-name:var(--font-display)] font-bold tracking-[-0.5px] ${mobile ? 'text-[32px] leading-[48px]' : 'text-[40px] leading-[60px]'}`}>وش تبي نسعّر لك اليوم؟</h1>
              {mobile ? null : <p className="text-[16px] leading-[26px] text-[var(--color-text-secondary)]">اختر الطريقة الأسهل — تقدر تجمع بينها في نفس الطلب.</p>}
            </div>
            <div role="radiogroup" aria-label="طريقة إدخال الطلب" className={mobile ? 'flex flex-col gap-3' : 'flex gap-4'}>
              <OptionCard spot="كراسة" title="ارفع الكراسة" layout={mobile ? 'row' : 'tile'} hint="Excel أو PDF" selected={method === 'booklet'} onSelect={() => setMethod('booklet')} />
              <OptionCard spot="قائمة" title="اكتب الطلبات" layout={mobile ? 'row' : 'tile'} hint="سطر لكل بند" selected={method === 'typed'} onSelect={() => setMethod('typed')} />
              <OptionCard spot="صورة" title="صوّرها" layout={mobile ? 'row' : 'tile'} hint="كراسة ورقية أو قطعة" selected={method === 'photo'} onSelect={() => setMethod('photo')} />
            </div>

            {method === 'typed' ? (
              <form className="flex w-full flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6" onSubmit={(e) => { e.preventDefault(); addTyped() }}>
                <div className={mobile ? 'grid grid-cols-2 items-end gap-3 [&>*:first-child]:col-span-2' : 'grid grid-cols-[1fr_140px_140px] items-end gap-3'}>
                  <Input label="البند" placeholder="مثال: كيبل نحاس 4×16 مم²" value={name} onChange={(e) => setName(e.target.value)} />
                  <Input label="الكمية" inputMode="decimal" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} />
                  <div className="flex flex-col gap-2">
                    <label htmlFor="typed-unit" className="text-[14px] leading-[22px] font-medium">الوحدة</label>
                    <select id="typed-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 text-[16px] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-border-primary)]">
                      {UNITS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <Button type="submit" variant="Secondary" icon="plus" className="self-start">أضف البند</Button>
              </form>
            ) : (
              <Dropzone
                className="w-full"
                accept={method === 'photo' ? 'image/*,application/pdf,.pdf' : '.pdf,application/pdf,.xlsx,' + XLSX}
                state={reading ? 'Uploading' : readError ? 'Error' : source && lines.length ? 'Success' : 'Idle'}
                fileName={reading?.name || source || undefined}
                progress={reading?.progress}
                successNote={`قرأنا ${lines.length} بند — راجعها في الخطوة التالية`}
                errorNote={readError || undefined}
                onFiles={(f) => void onFiles(f)}
              />
            )}

            {lines.length ? (
              <div className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
                <div className="flex items-center justify-between px-5 py-3">
                  <p className="text-[14px] font-medium">{lines.length} بند في الطلب{unusable ? ` · ${unusable} بلا كمية صحيحة (ما تنرسل)` : ''}</p>
                  <Button variant="Ghost" size="S" onClick={() => { setLines([]); setSource(null); setSourceKind(null) }}>مسح الكل</Button>
                </div>
                <ul className="max-h-60 overflow-auto border-t border-[var(--color-border-default)]">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-5 py-2 text-[14px] last:border-b-0">
                      <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      <span className="font-[family-name:var(--font-display)] tabular-nums" style={{ color: readQty(l.qty) ? undefined : 'var(--color-text-danger)' }}>{l.qty || '—'}</span>
                      <span className="w-14 text-[var(--color-text-secondary)]">{l.unit}</span>
                      <button type="button" aria-label={`حذف ${l.name}`} onClick={() => setLines((p) => p.filter((x) => x.id !== l.id))} className="rounded-[var(--radius-sm)] text-[var(--color-icon-secondary)] outline-none hover:text-[var(--color-text-danger)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-border-primary)]"><Icon name="x" size={16} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="flex items-center gap-2 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
              <Icon name="shield" size={18} className="text-[var(--color-icon-success)]" />
              ما نرسل شي لأي مورد قبل ما تراجع البنود وتوافق.
            </p>
          </section>
        ) : null}

        {step === 1 ? (
          <div className={mobile ? 'flex flex-col gap-6 pt-4' : 'flex items-start gap-6 pt-8'}>
            <section aria-labelledby="items-h" className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex items-end justify-between gap-4">
                <div className="flex flex-col items-start gap-1">
                  <h1 id="items-h" className="font-[family-name:var(--font-display)] text-[24px] leading-[36px] font-semibold">{sourceKind === 'typed' ? `${items.length} بند في الطلب` : `قرأنا ${items.length} بند ${sourceKind === 'photo' ? 'من الصور' : 'من الكراسة'}`}</h1>
                  {mobile
                    ? (needsCheck.length ? <p className="text-[14px] leading-[22px] text-[var(--color-text-warning)]">{needsCheck.length} تحتاج تأكيدك قبل الإرسال</p> : null)
                    : <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">راجع البنود اللي تحتاج تأكيد قبل ما نكمّل{source ? ` · ${source}` : ''}</p>}
                </div>
                <Button variant="Secondary" size={mobile ? 'S' : 'M'} icon="plus" onClick={() => { setMethod('typed'); setStep(0) }}>أضف بند</Button>
              </div>
              {mobile ? (
                // Figma M02: two filter chips instead of tabs.
                <div role="group" aria-label="تصفية البنود" className="flex gap-2">
                  <Chip label={`تحتاج تأكيد ${needsCheck.length}`} selected={tab === 'check'} onClick={() => { setTab('check'); setShowAll(false) }} />
                  <Chip label={`الكل ${items.length}`} selected={tab !== 'check'} onClick={() => { setTab('all'); setShowAll(false) }} />
                </div>
              ) : <Tabs label="تصفية البنود" value={tab} onChange={(k) => { setTab(k); setShowAll(false) }} items={tabs} />}
              {mobile ? (
                // Figma M02: one card per item; flagged items tinted with a «تأكد» button.
                <ul className="flex flex-col gap-3">
                  {shown.map((i) => {
                    const picked = selected[i.id] || []
                    const flagged = needsCheck.includes(i)
                    return (
                      <li key={i.id} className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] p-4" style={{ background: flagged ? 'var(--color-bg-warning)' : 'var(--color-bg-surface)' }}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 text-[16px] leading-[26px] font-medium">{i.name}</p>
                          <p className="shrink-0 font-[family-name:var(--font-display)] text-[16px] font-semibold tabular-nums">{i.qty} <span className="text-[14px] font-normal">{i.unit}</span></p>
                        </div>
                        {i.workOnly ? <p className="text-[12px] text-[var(--color-text-warning)]">عمل فقط — ما فيه مواد تُشترى</p>
                          : !picked.length ? <p className="text-[12px] text-[var(--color-text-warning)]">ما فيه مورد مختار — ما ينرسل</p>
                            : i.spec ? <p className="text-[12px] text-[var(--color-text-secondary)]">{i.spec}</p> : null}
                        {i.workOnly ? null : (
                          <div className="flex items-center justify-between gap-3">
                            {departmentForBoqItem(i) ? <Badge tone="Neutral" label={DEPT_LABEL[departmentForBoqItem(i)!]} showDot={false} /> : <span />}
                            <Button variant={flagged ? 'Secondary' : 'Ghost'} size="S" aria-expanded={open === i.id} aria-controls={`sup-${i.id}`} onClick={() => setOpen(open === i.id ? null : i.id)}>
                              {flagged ? 'تأكد' : `${picked.length} من ${candidatesFor(i).length} مورد`}
                            </Button>
                          </div>
                        )}
                        {open === i.id ? <div id={`sup-${i.id}`} className="rounded-[var(--radius-md)] bg-[var(--color-bg-canvas)] p-3">{supplierPicker(i)}</div> : null}
                      </li>
                    )
                  })}
                  {visible.length > shown.length ? <li><Button variant="Ghost" fullWidth onClick={() => setShowAll(true)}>عرض {visible.length - shown.length} بند إضافي</Button></li> : null}
                </ul>
              ) : (
              <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
                <table className="w-full table-fixed border-collapse text-start">
                  <caption className="sr-only">بنود الطلب</caption>
                  <thead className="bg-[var(--color-bg-surface-2)] text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">
                    <tr>
                      <th scope="col" className="w-12 px-3 py-3 text-start font-medium">#</th>
                      <th scope="col" className="px-3 py-3 text-start font-medium">البند والمواصفات</th>
                      <th scope="col" className="w-24 px-3 py-3 text-start font-medium">الكمية</th>
                      <th scope="col" className="w-[88px] px-3 py-3 text-start font-medium">الوحدة</th>
                      <th scope="col" className="w-32 px-3 py-3 text-start font-medium">الفئة</th>
                      <th scope="col" className="w-44 px-3 py-3 text-start font-medium">الموردين</th>
                    </tr>
                  </thead>
                  {shown.map((i) => {
                    const picked = selected[i.id] || []
                    const flagged = needsCheck.includes(i)
                    const cands = candidatesFor(i)
                    const dept = departmentForBoqItem(i)
                    return (
                      <tbody key={i.id} className="border-t border-[var(--color-border-default)]">
                        <tr className="h-[68px]" style={flagged ? { background: 'var(--color-bg-warning)' } : undefined}>
                          <td className="px-3 font-[family-name:var(--font-display)] text-[14px] text-[var(--color-text-tertiary)]">{items.indexOf(i) + 1}</td>
                          <td className="min-w-0 px-3 py-2">
                            <span className="block truncate text-[16px] leading-[26px] font-medium" title={i.name}>{i.name}</span>
                            {i.workOnly ? <span className="block text-[12px] leading-[18px] text-[var(--color-text-warning)]">عمل فقط — ما فيه مواد تُشترى</span>
                              : !picked.length ? <span className="block text-[12px] leading-[18px] text-[var(--color-text-warning)]">ما فيه مورد مختار — ما ينرسل</span>
                                : i.spec ? <span className="block truncate text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{i.spec}</span> : null}
                          </td>
                          <td className="px-3 font-[family-name:var(--font-display)] text-[14px] font-medium tabular-nums">{i.qty}</td>
                          <td className="px-3 text-[14px]">{i.unit}</td>
                          <td className="px-3">{dept ? <Badge tone="Neutral" label={DEPT_LABEL[dept]} showDot={false} /> : <span className="text-[12px] text-[var(--color-text-tertiary)]">غير مصنّف</span>}</td>
                          <td className="px-3">
                            {i.workOnly ? null : (
                              <Button variant={flagged ? 'Secondary' : 'Ghost'} size="S" aria-expanded={open === i.id} aria-controls={`sup-${i.id}`} onClick={() => setOpen(open === i.id ? null : i.id)}>
                                {flagged ? 'تأكد' : `${picked.length} من ${cands.length} مورد`}
                              </Button>
                            )}
                          </td>
                        </tr>
                        {open === i.id ? (
                          <tr id={`sup-${i.id}`}>
                            <td colSpan={6} className="bg-[var(--color-bg-canvas)] px-6 py-4">
                              {supplierPicker(i)}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    )
                  })}
                </table>
                {visible.length > shown.length ? <button type="button" onClick={() => setShowAll(true)} className="w-full border-t border-[var(--color-border-default)] p-4 text-center text-[14px] font-medium text-[var(--color-text-link)] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-border-primary)]">عرض {visible.length - shown.length} بند إضافي</button> : null}
              </div>
              )}
            </section>

            <aside aria-labelledby="est-h" className={`flex shrink-0 flex-col gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6 ${mobile ? 'w-full' : 'w-[360px]'}`}>
              <h2 id="est-h" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">الموردين المتوقعين</h2>
              <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">نرشّح الموردين لكل بند من سجل فرق. تقدر تغيّر الاختيار من عمود الموردين.</p>
              {byDept.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-canvas)] p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[16px] leading-[26px] font-medium">{DEPT_LABEL[k] || 'غير مصنّف'}</span>
                      <span className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{v.items} بند</span>
                    </div>
                    <span className="font-[family-name:var(--font-display)] text-[16px] leading-[24px] font-semibold">{v.suppliers.size} مورد</span>
                  </div>
                  {v.direct.size ? <div className="flex items-center gap-1.5"><EvidenceBadge level="Strong" label="دليل مباشر" /><span className="text-[12px] font-medium text-[var(--color-text-success)]">{v.direct.size} منهم</span></div> : null}
                </div>
              ))}
              {needsCheck.length ? (
                <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-warning)] p-3 text-[14px] leading-[22px] text-[var(--color-text-warning)]">
                  <Icon name="alert" size={18} />{needsCheck.length} بند ما نرسلها لأي مورد قبل ما تتأكد منها.
                </p>
              ) : null}
            </aside>
          </div>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby="dl-h" className={mobile ? 'flex flex-col gap-4 pt-4' : 'mx-auto flex max-w-[752px] flex-col gap-6 pt-12'}>
            <h1 id="dl-h" className="font-[family-name:var(--font-display)] text-[32px] leading-[48px] font-bold">وين ومتى التوريد؟</h1>
            <div className={`grid gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] ${mobile ? 'grid-cols-1 p-4' : 'grid-cols-2 p-6'}`}>
              <Input label="اسم المشروع" placeholder="مثال: فيلا النرجس" value={project} onChange={(e) => setProject(e.target.value)} helper="يظهر للموردين مع المدينة" />
              <Input label="مدينة التسليم" value={city} onChange={(e) => setCity(e.target.value)} error={!city.trim() ? 'اكتب مدينة التسليم.' : undefined} />
              <Input label="موعد التوريد" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
              <Input label="آخر موعد للعروض" type="date" value={quoteDeadline} onChange={(e) => setQuoteDeadline(e.target.value)} helper="الساعة 5:00 م" error={quoteDeadline && requiredDate && quoteDeadline >= requiredDate ? 'آخر موعد للعروض يجب أن يسبق موعد التوريد.' : undefined} />
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[14px] leading-[22px] font-medium">نوع الطلب</legend>
                <div className="flex gap-2">
                  <Chip label="توريد فقط" selected={requestType === 'SUPPLY_ONLY'} onClick={() => setRequestType('SUPPLY_ONLY')} />
                  <Chip label="توريد وتركيب" selected={requestType === 'SUPPLY_AND_INSTALL'} onClick={() => setRequestType('SUPPLY_AND_INSTALL')} />
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[14px] leading-[22px] font-medium">القسم</legend>
                <div className="flex flex-wrap gap-2">
                  {DEPARTMENTS.map(([k, l]) => <Chip key={k} label={l} selected={department === k} onClick={() => setDepartment(k)} />)}
                </div>
              </fieldset>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section aria-labelledby="sd-h" className={mobile ? 'flex flex-col gap-4 pt-4' : 'mx-auto flex max-w-[752px] flex-col gap-6 pt-12'}>
            <h1 id="sd-h" className="font-[family-name:var(--font-display)] text-[32px] leading-[48px] font-bold">{summary ? 'وصل طلبك للموردين' : createdId ? 'نرسل الطلب…' : 'جاهز للإرسال'}</h1>
            <dl className={mobile ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-3 gap-4'}>
              {[['البنود', `${readyItems.length} بند`], ['الموردين', `${allPicked.length} مورد`], ['التسليم', `${city} · ${requiredDate}`]].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-5 py-4">
                  <dt className="text-[14px] font-medium text-[var(--color-text-secondary)]">{k}</dt>
                  <dd className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {needsCheck.length ? <p className="text-[14px] text-[var(--color-text-warning)]">{needsCheck.length} بند بلا مورد مختار — ما ينرسل.</p> : null}
            {blockers.length && !sending ? <ul role="alert" className="flex flex-col gap-1 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] p-4 text-[14px] text-[var(--color-text-danger)]">{blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}

            {waAsk ? (
              <div role="alertdialog" aria-labelledby="wa-h" className="flex flex-col gap-3 rounded-[var(--radius-lg)] border-[1.5px] border-[var(--color-border-warning)] bg-[var(--color-bg-surface)] p-5">
                <p id="wa-h" className="text-[16px] font-medium">{waAsk.count} مورد يوصلهم الطلب عبر واتساب برسوم {waAsk.price} ر.س للرسالة. نرسل لهم؟</p>
                <div className="flex gap-3">
                  <Button variant="Primary" onClick={() => waAsk.resolve(true)}>نعم، أرسل عبر واتساب</Button>
                  <Button variant="Secondary" onClick={() => waAsk.resolve(false)}>لا، بدون واتساب</Button>
                </div>
              </div>
            ) : null}

            {sending ? (
              <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5" aria-live="polite">
                <p className="text-[16px] font-medium">{summary ? `تم الإرسال لـ ${summary.sent} من ${summary.total}${summary.failed ? ` · تعذّر ${summary.failed}` : ''}` : progress.text}</p>
                {progress.total && !summary ? (
                  <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-[3px] bg-[var(--color-bg-surface-2)]"><span className="block h-full rounded-[3px] bg-[var(--color-bg-brand)] transition-[width]" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></span>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <FlowFooter
        back={back}
        status={busy || `الخطوة ${step + 1} من 4${step === 1 ? ` · ${readyItems.length} بند جاهز${needsCheck.length ? `، و${needsCheck.length} تحتاج تأكيدك` : ''}` : ' · تقدر ترجع وتعدّل قبل الإرسال'}`}
        next={
          step === 0 ? <Button size="L" icon="arrow-forward" loading={Boolean(busy)} loadingLabel="نبحث عن موردين…" disabled={!usable.length || Boolean(reading)} onClick={() => void toReview()}>التالي</Button>
            : step === 1 ? <Button size="L" icon="arrow-forward" disabled={!readyItems.length} onClick={() => setStep(2)}>التالي: التوصيل</Button>
              : step === 2 ? <Button size="L" icon="arrow-forward" disabled={!city.trim() || !requiredDate || !quoteDeadline} onClick={() => setStep(3)}>التالي: الإرسال</Button>
                : createdId ? <Button size="L" icon="arrow-forward" onClick={openRequest}>افتح الطلب</Button>
                  : <Button size="L" icon="send" loading={sending} loadingLabel="جارٍ الإرسال…" disabled={blockers.length > 0} onClick={() => void send()}>أرسل الطلب</Button>
        }
      />
    </div>
  )
}

export default NewRequestV2
