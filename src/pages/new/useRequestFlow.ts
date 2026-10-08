import { useMemo, useRef, useState } from 'react'
import { parseConstructionBoqPdf, type BoqReadProgress } from '../../api/constructionClient'
import { farqSession } from '../../api/farqSession'
import { autoPickFor, buildPickContext } from '../../lib/autoPick'
import { loadCompanyProfile } from '../../lib/companyProfile'
import { shrinkImage } from '../../lib/imageShrink'
import { matchSuppliersForItems, rowsToLines, sanitizeBoqLines, type ParsedLine } from '../../lib/parseBoq'
import { scanPurchaseRequest } from '../../lib/purchaseRequests'
import { departmentForBoqItem, dominantEngineeringDepartment } from '../../lib/rfqPackages'
import { cleanLineName, readQty } from '../../lib/sendGuards'
import type { BOQItem } from '../../types'
import { sendRequest, type SendProgress, type SendSummary } from '../review/sendRequest'

/*
 * State of the new-request flow (01 → 02 → التوصيل → الإرسال), shared by src/pages/new and src/pages/review.
 * Moved from src/views/NewRequestV2.tsx (M4, 89af17d) without changing what is read or sent:
 * reading = فرق بناء's NewRequestScreen.tsx@5147808 (server PDF reader, scan endpoint for xlsx/photos),
 * matching = parseBoq.matchSuppliersForItems + autoPick, sending = ../review/sendRequest.ts.
 */

export type Method = 'booklet' | 'typed' | 'photo'
export type Step = 0 | 1 | 2 | 3
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const AUTO_PICK = 10

export const DEPARTMENTS: Array<[string, string]> = [['CIVIL', 'مدني'], ['ARCHITECTURAL', 'معماري'], ['ELECTRICAL', 'كهرباء'], ['MECHANICAL', 'ميكانيكا']]
export const DEPT_LABEL = Object.fromEntries(DEPARTMENTS) as Record<string, string>

function isoIn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || '').split(',')[1] || '')
    r.onerror = () => reject(new Error('تعذّر فتح الملف.'))
    r.readAsDataURL(file)
  })
}

export function useRequestFlow() {
  const [step, setStep] = useState<Step>(0)
  const [method, setMethodState] = useState<Method>('booklet')
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

  // delivery
  const [profile] = useState(loadCompanyProfile)
  // «هلا سارة» in Figma: only a real display name, never the e-mail.
  const greeting = (farqSession.getUser()?.displayName || '').trim().split(/\s+/)[0] || ''
  const [project, setProject] = useState('')
  const [city, setCity] = useState(profile.defaultDeliveryCity || 'الرياض')
  const [requiredDate, setRequiredDate] = useState(() => isoIn(profile.defaultDeadlineDays || 14))
  const [quoteDeadline, setQuoteDeadline] = useState(() => isoIn(5))
  const [requestType, setRequestType] = useState<'SUPPLY_ONLY' | 'SUPPLY_AND_INSTALL'>('SUPPLY_ONLY')
  const [department, setDepartment] = useState('')

  // sending
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState<SendProgress>({ text: '', done: 0, total: 0 })
  const [waAsk, setWaAsk] = useState<{ count: number; price: number; resolve: (yes: boolean) => void } | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<SendSummary | null>(null)

  /** Changing the way in clears the last read error (it was about the other input). */
  const setMethod = (m: Method) => { setReadError(null); setMethodState(m) }

  const addLines = (read: ParsedLine[]) => setLines((prev) => [...prev, ...read.map((l) => ({ ...l, id: nextId.current++ }))])

  /* ---------- 01: read the request ---------- */

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

  function addTyped(): boolean {
    const n = cleanLineName(name)
    if (!n) { setError('اكتب اسم البند.'); return false }
    if (!readQty(qty)) { setError('اكتب كمية صحيحة أكبر من صفر.'); return false }
    setError(null)
    addLines([{ id: 0, name: n, qty: qty.trim(), unit }])
    setName('')
    setQty('')
    if (!source) setSource('مكتوبة يدويًا')
    setSourceKind((k) => k || 'typed')
    return true
  }

  function removeLine(id: number) {
    setLines((p) => p.filter((x) => x.id !== id))
  }

  function clearLines() {
    setLines([])
    setSource(null)
    setSourceKind(null)
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

  /* ---------- 02: review ---------- */

  const allPicked = useMemo(() => [...new Set(Object.values(selected).flat())], [selected])
  const readyItems = useMemo(() => items.filter((i) => !i.workOnly && (selected[i.id] || []).length > 0), [items, selected])
  const needsCheck = useMemo(() => items.filter((i) => i.workOnly || !(selected[i.id] || []).length), [items, selected])

  function toggle(itemId: number, supplierId: string) {
    setSelected((prev) => {
      const cur = prev[itemId] || []
      return { ...prev, [itemId]: cur.includes(supplierId) ? cur.filter((x) => x !== supplierId) : [...cur, supplierId] }
    })
  }

  /* ---------- التوصيل / الإرسال (same blockers and payload as the source) ---------- */

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
      await sendRequest(
        { readyItems, allPicked, selected, department, city, project, requiredDate, quoteDeadline, requestType, profile },
        {
          setProgress,
          setCreatedId: (id) => { created = id; setCreatedId(id) },
          askWhatsApp: async (count, price) => {
            const yes = await new Promise<boolean>((resolve) => setWaAsk({ count, price, resolve }))
            setWaAsk(null)
            return yes
          },
          setSummary,
        },
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر إرسال الطلب.')
      if (!created) setSending(false)
    }
  }

  return {
    step, setStep, method, setMethod, lines, source, sourceKind, reading, readError, busy, error, setError,
    name, setName, qty, setQty, unit, setUnit,
    items, selected, toggle, allPicked, readyItems, needsCheck, departmentOf: (i: BOQItem) => departmentForBoqItem(i) || 'OTHER',
    greeting, project, setProject, city, setCity, requiredDate, setRequiredDate, quoteDeadline, setQuoteDeadline, requestType, setRequestType, department, setDepartment,
    sending, progress, waAsk, createdId, summary, blockers,
    onFiles, addTyped, removeLine, clearLines, usable, unusable, toReview, send,
  }
}

export type RequestFlow = ReturnType<typeof useRequestFlow>
