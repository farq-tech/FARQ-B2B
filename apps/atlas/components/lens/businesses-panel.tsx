'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ClipboardList, Loader2, Megaphone, Search, SearchX } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { toast } from 'sonner'
import { counted, numberFormat } from '@/lib/insights-api'
import type { PublicDirectoryEntity } from '@/lib/live-directory'
import { BusinessDetail } from './business-detail'
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton'
import { useAppStore } from '@/lib/store'
import { useStudiedActivity } from '@/lib/sticky-state'
import { Icon3D } from '@/components/shared/icon-3d'
import type { RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'

type Status = 'idle' | 'loading' | 'ready' | 'login' | 'error' | 'needs-scope'
const PAGE = 200
// one search per district, so a wide selection is read up to this many districts and the count says so
const MAX_DISTRICTS = 5

/**
 * The step that turns an insight into action: the selected districts' real businesses, optionally narrowed to an
 * activity, picked and turned into a request — a quote request, a WhatsApp campaign or a saved list. The request
 * opens in «الطلبات» for review; nothing is sent from here (docs/atlas-product-foundation.md §5).
 */
export function BusinessesPanel({ city, districts, query }: { city: string; districts: string[]; query?: string }) {
  const router = useRouter()
  const { createDraft } = useAppStore()
  const [activity, setActivity] = useState(query ?? '')
  // the activity studied in the other steps, offered as a one-tap start before anything is shown
  const [studied] = useStudiedActivity()
  const [rows, setRows] = useState<PublicDirectoryEntity[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  // how many of the selected districts the last search covered (it reads the first MAX_DISTRICTS of them)
  const [searched, setSearched] = useState<number | null>(null)
  // the poi_key of the business whose directory details are expanded, or null
  const [openId, setOpenId] = useState<string | null>(null)
  const key = districts.join('|')
  // each search takes a number; an answer that is no longer the latest (another search, city or districts since) is dropped
  const latest = useRef(0)

  useEffect(() => { latest.current++; setRows([]); setTotal(null); setPicked(new Set()); setStatus('idle') }, [key, city])
  // a search from the top of the map runs at once, over the selected districts or the whole city
  useEffect(() => { if (query) void load() }, [query, city]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load(text: string = activity) {
    const typed = text.trim()
    const mine = ++latest.current
    // the whole city is searched by activity only: with no district and nothing typed there is nothing to search,
    // and an empty answer would read as «no businesses in the city»
    if (!districts.length && !typed) { setStatus('needs-scope'); return }
    const stale = () => mine !== latest.current
    setStatus('loading')
    try {
      const found: PublicDirectoryEntity[] = []
      let count = 0
      // no district chosen: one search over the whole city, which needs an activity
      const scopes: (string | null)[] = districts.length ? districts.slice(0, MAX_DISTRICTS) : typed ? [null] : []
      for (const district of scopes) {
        const response = await fetch('/api/market/entities', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ city, ...(district ? { district } : {}), limit: PAGE, offset: 0, ...(typed ? { q: typed, objective: 'purchase' } : {}) }),
        })
        const body = await response.json().catch(() => null) as { rows?: PublicDirectoryEntity[]; total?: number; error?: string } | null
        if (stale()) return
        if (response.status === 401) { setStatus('login'); return }
        if (!response.ok || !body) throw new Error(body?.error || 'تعذر تحميل المنشآت.')
        found.push(...(body.rows ?? []))
        count += typeof body.total === 'number' ? body.total : (body.rows ?? []).length
      }
      if (stale()) return
      const unique = [...new Map(found.map((row) => [row.id, row])).values()]
      setRows(unique)
      setTotal(count)
      setSearched(districts.length ? scopes.length : null)
      setPicked(new Set())
      setStatus('ready')
    } catch (error) {
      if (stale()) return
      setMessage(error instanceof Error ? error.message : 'تعذر تحميل المنشآت.')
      setStatus('error')
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
      <h2 className="text-xl font-bold">منشآت {where}</h2>
      <form role="search" className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void load() }}>
        <input value={activity} onChange={(event) => setActivity(event.target.value)} aria-label="النشاط" enterKeyHint="search"
          placeholder="كل الأنشطة، أو اكتب نشاطاً" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-base" />
        <button type="submit" disabled={status === 'loading'} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-base font-semibold text-primary-foreground disabled:opacity-60">
          {status === 'loading' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />} اعرض
        </button>
      </form>
      {(status === 'idle' || status === 'needs-scope') && (
        <div role="group" aria-label="ابدأ بـ" className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setActivity(studied.label); void load(studied.label) }}
            className="inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-3 text-sm hover:border-primary hover:text-primary">
            <Icon3D activity={studied.label} />{studied.label}
          </button>
          {districts.length > 0 && (
            <button type="button" onClick={() => { setActivity(''); void load('') }}
              className="rounded-full border px-3 py-1 text-sm hover:border-primary hover:text-primary">كل الأنشطة</button>
          )}
        </div>
      )}
      {status === 'loading' && (
        <>
          <Skeleton className="h-4 w-32" aria-hidden />
          <SkeletonRows rows={6} sub leading="check" />
        </>
      )}
      {status === 'needs-scope' && <p role="status" className="text-base text-muted-foreground">اكتب نشاطاً لتبحث في المدينة كلها، أو حدّد حياً على الخريطة لترى كل منشآته.</p>}
      {status === 'login' && <p className="text-base">لعرض المنشآت وإنشاء طلب <Link href="/login?next=/map" className="font-semibold text-primary underline">سجّل الدخول</Link>.</p>}
      {status === 'error' && <p role="alert" className="text-base text-destructive">{message}</p>}
      {status === 'ready' && rows.length === 0 && (
        <EmptyState compact icon={SearchX} title={`لا منشآت ${activity.trim() ? `«${activity.trim()}» ` : ''}في ${where}`} body={activity.trim() ? 'جرّب اسماً آخر للنشاط، أو كل الأنشطة.' : 'جرّب حياً آخر.'} />
      )}
      {status === 'ready' && rows.length > 0 && (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{numberFormat.format(shown.length)} منشأة معروضة{total != null && total > rows.length ? ` من ${numberFormat.format(total)}` : ''}{searched != null && searched < districts.length ? ` · في ${numberFormat.format(searched)} من ${counted(districts.length, 'district')} محددة` : ''}</span>
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
                    <span className="block truncate text-sm text-muted-foreground">{row.category}{row.district ? ` · ${row.district}` : ''}</span>
                  </button>
                  <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform', openId === row.id && 'rotate-180')} />
                </div>
                {openId === row.id && <BusinessDetail row={row} />}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-3 gap-1.5">
            {([['rfq', 'طلب تسعير', ClipboardList], ['campaign', 'حملة واتساب', Megaphone], ['list', 'حفظ قائمة', ClipboardList]] as const).map(([type, label, Icon]) => (
              <button key={type} disabled={!picked.size} onClick={() => act(type)}
                className={cn('inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-sm font-semibold', picked.size ? 'border-primary text-primary hover:bg-primary hover:text-primary-foreground' : 'cursor-not-allowed opacity-50')}>
                <Icon className="size-4" aria-hidden /> {label}{picked.size ? ` (${numberFormat.format(picked.size)})` : ''}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{picked.size ? 'يُفتح الطلب في «الطلبات» لتراجعه. لا يُرسل شيء من هنا.' : 'اختر منشأة أو أكثر لتنشئ منها طلباً. لا يُرسل شيء من هنا.'}</p>
        </>
      )}
    </section>
  )
}
