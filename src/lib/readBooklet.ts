import { parseConstructionBoqPdf, type BoqReadProgress } from '../api/constructionClient'
import { rowsToLines, sanitizeBoqLines } from './parseBoq'
import { scanPurchaseRequest } from './purchaseRequests'
import { shrinkImage } from './imageShrink'

/*
 * Reads a booklet into lines — the same readers as «طلب جديد» (01): PDF → POST /boq/parse-pdf,
 * Excel and photos → POST /purchase-requests/scan. Both only read the file and return lines;
 * no request is created. Used by the targeting screen to turn a booklet into things to search for.
 */

export type BookletLine = { name: string; qty: string; unit: string; spec?: string }

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || '').split(',')[1] || '')
    r.onerror = () => reject(new Error('تعذّر فتح الملف.'))
    r.readAsDataURL(file)
  })
}

const fromScan = (items: { description?: string | null; quantity?: number | string | null; unit?: string | null; specification?: string | null }[]) =>
  items.filter((i) => String(i.description || '').trim())
    .map((i) => ({ name: String(i.description).trim(), qty: i.quantity != null ? String(i.quantity) : '', unit: i.unit || '', spec: i.specification || undefined }))

export async function readBooklet(files: File[], onNote: (note: string) => void): Promise<BookletLine[]> {
  if (!files.length) return []
  const images = files.filter((f) => /^image\//.test(f.type))
  if (images.length) {
    onNote(images.length > 1 ? `نقرأ ${images.length} صور…` : 'نقرأ الصورة…')
    const pages = []
    for (const f of images) pages.push(await shrinkImage(f))
    const { request } = await scanPurchaseRequest(pages)
    return fromScan(request.items)
  }
  const file = files[0]
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const isXlsx = file.type === XLSX || /\.xlsx$/i.test(file.name)
  if (!isPdf && !isXlsx) throw new Error('ارفع قائمة المنتجات أو الاحتياجات بصيغة PDF أو Excel (xlsx) أو صورة.')
  if (file.size > 25 * 1024 * 1024) throw new Error('الملف أكبر من 25 ميجابايت — قسّمه أو صدّره PDF أصغر.')
  if (isPdf) {
    const result = await parseConstructionBoqPdf(file, (p: BoqReadProgress) =>
      onNote(p.pageCount ? `صفحة ${p.pagesDone} من ${p.pageCount} · ${p.itemCount} بند` : `${p.itemCount} بند حتى الآن`))
    return sanitizeBoqLines(rowsToLines(result.rows || [])).map((l) => ({ name: l.name, qty: l.qty ? String(l.qty) : '', unit: l.unit || '' }))
  }
  onNote('نقرأ الجدول…')
  const { request } = await scanPurchaseRequest([{ mime: XLSX, base64: await fileToBase64(file) }])
  return fromScan(request.items)
}
