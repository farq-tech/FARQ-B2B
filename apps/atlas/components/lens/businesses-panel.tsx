'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ClipboardList, Loader2, Megaphone, Search } from 'lucide-react'
import { toast } from 'sonner'
import { counted, numberFormat } from '@/lib/insights-api'
import { dedupeDirectoryEntities, exactDirectoryTotal, type PublicDirectoryEntity } from '@/lib/live-directory'
import { BusinessDetail } from './business-detail'
import { useAppStore } from '@/lib/store'
import type { RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<string, string> = {
  open: 'مفتوح',
  closed_temporary: 'مغلق مؤقتاً',
  closed_permanent: 'مغلق نهائياً',
  inactive: 'غير نشط',
  hidden: 'الحالة غير متاحة',
  unknown_empty: 'حالة التشغيل غير متاحة',
  unknown_invalid: 'حالة التشغيل غير متاحة',
}

type Status = 'idle' | 'loading' | 'ready' | 'login' | 'error'
const PAGE = 200
const CONCURRENCY = 5
type MoreScope = { district: string | null; offset: number; total: number }

/**
 * The step that turns an insight into action: the selected districts' real businesses, optionally narrowed to an
 * activity, picked and turned into a request — a quote request, a WhatsApp campaign or a saved list. The request
 * opens in «الطلبات» for review; nothing is sent from here (docs/atlas-product-foundation.md §5).
 */
export function BusinessesPanel({ city, districts, query }: { city: string; districts: string[]; query?: string }) {
  const router = useRouter()
  const { createDraft } = useAppStore()
  const [activity, setActivity] = useState(query ?? '')
  const [rows, setRows] = useState<PublicDirectoryEntity[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [moreScopes, setMoreScopes] = useState<MoreScope[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreProgress, setMoreProgress] = useState<{ done: number; total: number } | null>(null)
  const [moreError, setMoreError] = useState('')
  // the poi_key of the business whose directory details are expanded, or null
  const [openId, setOpenId] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const key = districts.join('|')

  useEffect(() => {
    controllerRef.current?.abort()
    requestVersion.current += 1
    setRows([])
    setTotal(null)
    setPicked(new Set())
    setOpenId(null)
    setProgress(null)
    setMoreScopes([])
    setLoadingMore(false)
    setMoreProgress(null)
    setMoreError('')
    setStatus('idle')
    return () => {
      requestVersion.current += 1
      controllerRef.current?.abort()
    }
  }, [key, city])
  // a search from the top of the map runs at once, over the selected districts or the whole city
  useEffect(() => { if (query) void load() }, [query, city, key]) // eslint-disable-line react-hooks/exhaustive-deps

  function changeActivity(value: string) {
    setActivity(value)
    controllerRef.current?.abort()
    controllerRef.current = null
    requestVersion.current += 1
    setRows([])
    setTotal(null)
    setPicked(new Set())
    setOpenId(null)
    setProgress(null)
    setMoreScopes([])
    setLoadingMore(false)
    setMoreProgress(null)
    setMoreError('')
    setMessage('')
    setStatus('idle')
  }

  async function load() {
    controllerRef.current?.abort()
    controllerRef.current = null
    requestVersion.current += 1
    const scopes: MoreScope[] = (districts.length ? districts : activity.trim() ? [null] : []).map((district) => ({ district, offset: 0, total: 0 }))
    if (!scopes.length) {
      setRows([])
      setTotal(null)
      setPicked(new Set())
      setOpenId(null)
      setProgress(null)
      setMoreScopes([])
      setLoadingMore(false)
      setMoreProgress(null)
      setMoreError('')
      setMessage('')
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    const version = ++requestVersion.current
    setMessage('')
    setLoadingMore(false)
    setMoreProgress(null)
    setMoreError('')
    setStatus('loading')
    try {
      // no district chosen: one search over the whole city, which needs an activity
      const results: { district: string | null; rows: PublicDirectoryEntity[]; total: number; hasMore: boolean; nextOffset: number | null }[] = new Array(scopes.length)
      let next = 0
      let completed = 0
      setProgress(scopes.length > 1 ? { done: 0, total: scopes.length } : null)
      async function worker() {
        while (!controller.signal.aborted) {
          const index = next++
          if (index >= scopes.length) return
          const scope = scopes[index]
          const response = await fetch('/api/market/entities', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ city, ...(scope.district ? { district: scope.district } : {}), limit: PAGE, offset: scope.offset, ...(activity.trim() ? { q: activity.trim(), objective: 'purchase' } : {}) }),
            signal: controller.signal,
          })
          const body = await response.json().catch(() => null) as { rows?: PublicDirectoryEntity[]; total?: number; hasMore?: boolean; nextOffset?: number | null; error?: string } | null
          if (version !== requestVersion.current || controller.signal.aborted) return
          if (response.status === 401) { setProgress(null); setStatus('login'); controller.abort(); return }
          if (!response.ok || !body) throw new Error(body?.error || 'تعذر تحميل المنشآت.')
          const validNextPage = typeof body.total === 'number' && Number.isSafeInteger(body.total) && typeof body.nextOffset === 'number' && Number.isSafeInteger(body.nextOffset) && body.nextOffset > scope.offset && body.nextOffset <= body.total
          if (!Array.isArray(body.rows) || typeof body.total !== 'number' || !Number.isSafeInteger(body.total) || body.total < body.rows.length || typeof body.hasMore !== 'boolean' || (body.hasMore && !validNextPage) || (!body.hasMore && body.nextOffset !== null) || !body.rows.every((row) => row && typeof row.id === 'string' && row.id.length > 0)) {
            throw new Error('استجابة دليل المنشآت غير مكتملة.')
          }
          results[index] = { district: scope.district, rows: body.rows, total: body.total, hasMore: body.hasMore, nextOffset: body.nextOffset ?? null }
          completed += 1
          if (scopes.length > 1) setProgress({ done: completed, total: scopes.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, scopes.length) }, () => worker()))
      if (version !== requestVersion.current || controller.signal.aborted) return
      const found = results.flatMap((result) => result.rows)
      const unique = dedupeDirectoryEntities(found)
      const remainingScopes = results.flatMap((result) => result.hasMore && result.nextOffset != null ? [{ district: result.district, offset: result.nextOffset, total: result.total }] : [])
      setRows(unique)
      setTotal(exactDirectoryTotal({
        scopeCount: scopes.length,
        pendingScopes: remainingScopes.length,
        uniqueCount: unique.length,
        singleScopeTotal: results[0]?.total ?? 0,
      }))
      setPicked(new Set())
      setMoreScopes(remainingScopes)
      setMoreError('')
      setLoadingMore(false)
      setMoreProgress(null)
      setProgress(null)
      setStatus('ready')
    } catch (error) {
      if (controller.signal.aborted || version !== requestVersion.current) return
      controller.abort()
      setProgress(null)
      setMessage(error instanceof Error ? error.message : 'تعذر تحميل المنشآت.')
      setStatus('error')
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }

  async function loadMore() {
    if (loadingMore || !moreScopes.length) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const version = requestVersion.current
    const scopes = moreScopes
    const results: { district: string | null; offset: number; total: number; rows: PublicDirectoryEntity[]; hasMore: boolean; nextOffset: number | null }[] = new Array(scopes.length)
    let next = 0
    let completed = 0
    setLoadingMore(true)
    setMoreError('')
    setMoreProgress(scopes.length > 1 ? { done: 0, total: scopes.length } : null)
    try {
      async function worker() {
        while (!controller.signal.aborted) {
          const index = next++
          if (index >= scopes.length) return
          const scope = scopes[index]
          const response = await fetch('/api/market/entities', {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ city, ...(scope.district ? { district: scope.district } : {}), limit: PAGE, offset: scope.offset, ...(activity.trim() ? { q: activity.trim(), objective: 'purchase' } : {}) }),
            signal: controller.signal,
          })
          const body = await response.json().catch(() => null) as { rows?: PublicDirectoryEntity[]; total?: number; hasMore?: boolean; nextOffset?: number | null; error?: string } | null
          if (version !== requestVersion.current || controller.signal.aborted) return
          if (response.status === 401) { setLoadingMore(false); setMoreProgress(null); setStatus('login'); controller.abort(); return }
          if (!response.ok || !body) throw new Error(body?.error || 'تعذر تحميل بقية المنشآت.')
          const validNextPage = typeof body.total === 'number' && Number.isSafeInteger(body.total) && typeof body.nextOffset === 'number' && Number.isSafeInteger(body.nextOffset) && body.nextOffset > scope.offset && body.nextOffset <= body.total
          if (!Array.isArray(body.rows) || typeof body.total !== 'number' || !Number.isSafeInteger(body.total) || body.total !== scope.total || body.total < body.rows.length || typeof body.hasMore !== 'boolean' || (body.hasMore && !validNextPage) || (!body.hasMore && body.nextOffset !== null) || !body.rows.every((row) => row && typeof row.id === 'string' && row.id.length > 0)) {
            throw new Error('استجابة دليل المنشآت غير مكتملة.')
          }
          results[index] = { district: scope.district, offset: scope.offset, total: scope.total, rows: body.rows, hasMore: body.hasMore, nextOffset: body.nextOffset ?? null }
          completed += 1
          if (scopes.length > 1) setMoreProgress({ done: completed, total: scopes.length })
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, scopes.length) }, () => worker()))
      if (version !== requestVersion.current || controller.signal.aborted) return
      const remainingScopes = results.flatMap((result) => result.hasMore && result.nextOffset != null ? [{ district: result.district, offset: result.nextOffset, total: result.total }] : [])
      const uniqueRows = dedupeDirectoryEntities([...rows, ...results.flatMap((result) => result.rows)])
      setRows(uniqueRows)
      setTotal(exactDirectoryTotal({
        scopeCount: districts.length || (activity.trim() ? 1 : 0),
        pendingScopes: remainingScopes.length,
        uniqueCount: uniqueRows.length,
        singleScopeTotal: scopes[0]?.total ?? uniqueRows.length,
      }))
      setMoreScopes(remainingScopes)
      setLoadingMore(false)
      setMoreProgress(null)
    } catch (error) {
      if (controller.signal.aborted || version !== requestVersion.current) return
      controller.abort()
      setLoadingMore(false)
      setMoreProgress(null)
      setMoreError(error instanceof Error ? error.message : 'تعذر تحميل بقية المنشآت.')
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }

  const shown = rows
  const allPicked = shown.length > 0 && shown.every((row) => picked.has(row.id))
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  function act(type: RequestType) {
    const ids = [...picked]
    if (!ids.length) return
    const id = createDraft({
      type,
      businessIds: ids,
      cityId: city.toLowerCase(),
      query: activity.trim() || undefined,
      categoryHint: activity.trim() || undefined,
      districtHint: districts.length === 1 ? districts[0] : undefined,
      liveBusinesses: rows.filter((row) => picked.has(row.id)),
    })
    toast.success('جُهّزت المسودة', { description: `${numberFormat.format(ids.length)} منشأة، راجعها قبل أي إرسال.` })
    router.push(`/requests/${id}`)
  }

  const where = !districts.length ? 'المدينة' : districts.length === 1 ? districts[0] : counted(districts.length, 'district')

  return (
    <section aria-label="منشآت الحي" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-lg font-bold">منشآت {where}</h2>
      <div className="flex gap-2">
        <input value={activity} onChange={(event) => changeActivity(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }}
          placeholder="كل الأنشطة، أو اكتب نشاطاً" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-base" />
        <button onClick={() => void load()} disabled={status === 'loading' || (!districts.length && !activity.trim())} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-base font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          <Search className="size-4" aria-hidden /> اعرض
        </button>
      </div>
      {status === 'idle' && !districts.length && !activity.trim() && <p role="status" className="text-sm text-muted-foreground">اكتب نشاطاً للبحث في منشآت المدينة، أو اختر حياً على الخريطة.</p>}
      {status === 'idle' && (districts.length > 0 || activity.trim()) && <p role="status" className="text-sm text-muted-foreground">اضغط «اعرض» لتحميل المنشآت حسب اختيارك.</p>}
      {status === 'loading' && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin text-primary" aria-hidden />{progress ? `جارٍ تحميل الأحياء: ${numberFormat.format(progress.done)} من ${numberFormat.format(progress.total)}` : 'جارٍ تحميل المنشآت'}</div>}
      {status === 'login' && <p className="text-base">لعرض المنشآت وإنشاء طلب <Link href="/login?next=/map" className="font-semibold text-primary underline">سجّل الدخول</Link>.</p>}
      {status === 'error' && <p role="alert" className="text-base text-destructive">{message} <button onClick={() => void load()} className="font-semibold underline">أعد المحاولة</button></p>}
      {status === 'ready' && (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{numberFormat.format(shown.length)} منشأة معروضة{total != null && total > rows.length ? ` من ${numberFormat.format(total)}` : ''}</span>
          </div>
          {shown.length > 0 && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((row) => row.id)))} className="size-4 accent-primary" />
              اختر الكل ({numberFormat.format(shown.length)})
            </label>
          )}
          <ul className="max-h-80 divide-y overflow-y-auto text-base">
            {shown.map((row) => (
              <li key={row.id}>
                <div className="flex items-center gap-2 py-2">
                  <input type="checkbox" aria-label={`اختيار ${row.name}`} checked={picked.has(row.id)} onChange={() => toggle(row.id)} className="size-4 shrink-0 accent-primary" />
                  <button type="button" onClick={() => setOpenId(openId === row.id ? null : row.id)} aria-expanded={openId === row.id} className="min-w-0 flex-1 text-start">
                    <span className="block truncate font-medium">{row.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {row.category}{row.district ? ` · ${row.district}` : ''} · {row.status ? STATUS_LABEL[row.status] ?? 'حالة التشغيل غير متاحة' : 'حالة التشغيل غير متاحة'}
                    </span>
                  </button>
                  <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform', openId === row.id && 'rotate-180')} />
                </div>
                {openId === row.id && <BusinessDetail row={row} />}
              </li>
            ))}
          </ul>
          {moreError && <p role="alert" className="text-sm text-destructive">{moreError} <button onClick={() => void loadMore()} className="font-semibold underline">أعد المحاولة</button></p>}
          {moreScopes.length > 0 && (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="h-10 rounded-lg border border-primary/50 text-sm font-semibold text-primary disabled:opacity-60">
              {loadingMore ? <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden />{moreProgress ? `جارٍ تحميل الصفحات: ${numberFormat.format(moreProgress.done)} من ${numberFormat.format(moreProgress.total)}` : 'جارٍ تحميل المزيد'}</span> : 'عرض المزيد'}
            </button>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            {([['rfq', 'طلب تسعير', ClipboardList], ['campaign', 'حملة واتساب', Megaphone], ['list', 'حفظ قائمة', ClipboardList]] as const).map(([type, label, Icon]) => (
              <button key={type} disabled={!picked.size} onClick={() => act(type)}
                className={cn('inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-sm font-semibold', picked.size ? 'border-primary text-primary hover:bg-primary hover:text-primary-foreground' : 'cursor-not-allowed opacity-50')}>
                <Icon className="size-4" aria-hidden /> {label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">يُفتح الطلب في «الطلبات» لتراجعه. لا يُرسل شيء من هنا.</p>
        </>
      )}
    </section>
  )
}
