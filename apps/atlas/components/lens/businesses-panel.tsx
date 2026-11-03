'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ClipboardList, ListPlus, Loader2, LogIn, MapPin, Megaphone, PlusCircle, Search, SearchX } from 'lucide-react'
import { readAddTarget } from '@/lib/handoff'
import { draftsFor } from '@/lib/request-add'
import type { BusinessDot } from './lens-map-canvas'
import { TYPE_LABEL } from '@/lib/format'
import { EmptyState, NoResult } from '@/components/shared/empty-state'
import { LoadError } from '@/components/shared/load-error'
import { toast } from 'sonner'
import { counted, numberFormat, useCities } from '@/lib/insights-api'
import type { PublicDirectoryEntity } from '@/lib/live-directory'
import { GUEST_PREVIEW, type GuestPreviewRow } from '@/lib/guest-preview'
import { BusinessDetail } from './business-detail'
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton'
import { useAppStore } from '@/lib/store'
import { useStickyState, useStudiedActivity } from '@/lib/sticky-state'
import { Icon3D } from '@/components/shared/icon-3d'
import type { RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AnimatePresence, DURATION, EASE, Expand, Reveal, ease, motion, useReducedMotion } from '@/lib/motion'

/** The picked count inside an action button, popping as it changes (scale/opacity only, so it reads the same in RTL). */
function PickCount({ value, reduce }: { value: number; reduce: boolean | null }) {
  return (
    <span className="relative inline-flex min-w-[1.25rem] justify-center tabular-nums">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={value}
          initial={reduce ? false : { opacity: 0, scale: 0.6, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 4 }}
          transition={{ duration: reduce ? 0 : DURATION.fast, ease: EASE }}>
          ({numberFormat.format(value)})
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

type Status = 'idle' | 'loading' | 'ready' | 'login' | 'guest' | 'error' | 'needs-scope'
const PAGE = 200
// one search per district, so a wide selection is read up to this many districts and the count says so
const MAX_DISTRICTS = 5

/**
 * The step that turns an insight into action: the selected districts' real businesses, optionally narrowed to an
 * activity, picked and turned into a request — a quote request, a WhatsApp campaign or a saved list. The request
 * opens in «الطلبات» for review; nothing is sent from here (docs/atlas-product-foundation.md §5).
 */
export function BusinessesPanel({ city, districts, query, onLocate, located, onMarkers, pointed = null, onPoint, bounds = null, prefill = null }: {
  city: string
  districts: string[]
  query?: string
  /** Frames the map on one business and marks it (the map's own panel); absent where there is no map beside it. */
  onLocate?: (row: PublicDirectoryEntity) => void
  /** The business the map is marking now. */
  located?: string | null
  /** The list's businesses for the map, each named at its place (olive once in the request being built). */
  onMarkers?: (dots: BusinessDot[], rows: PublicDirectoryEntity[]) => void
  /** The business under the pointer on the map: its row is lit. */
  pointed?: string | null
  /** A row under the pointer or focus: its dot on the map is lit. */
  onPoint?: (id: string | null) => void
  /** What the map shows now (west, south, east, north): with «حدّث القائمة عند تحريك الخريطة» the list keeps only those. */
  bounds?: [number, number, number, number] | null
  /** The activity the step before already studied: the list opens on it at once for a picked district, typed in the field. */
  prefill?: string | null
}) {
  const router = useRouter()
  const cities = useCities()
  const reduce = useReducedMotion()
  const { createDraft, addToRequest, removeFromRequest, requests } = useAppStore()
  // the request a pick joins: named by the address when the person came from it («أضف منشآت من الخريطة»), or chosen
  // from the city's drafts; only a draft can still take businesses
  const [addId, setAddId] = useState<string | null>(null)
  useEffect(() => { setAddId(readAddTarget(window.location.search)) }, [])
  const drafts = draftsFor(requests, city)
  const target = addId ? drafts.find((request) => request.id === addId) ?? null : null
  // the businesses already in that request: marked in the list and on the map, and taken off it right here
  const inRequest = new Set(target?.businessIds ?? [])
  const inRequestKey = target?.businessIds.join('|') ?? ''
  const [activity, setActivity] = useState(query ?? '')
  // a short confirm flash on the picked rows the moment a draft is prepared, before the request page opens
  const [flashing, setFlashing] = useState(false)
  // the activity studied in the other steps, offered as a one-tap start before anything is shown
  const [studied] = useStudiedActivity()
  const [rows, setRows] = useState<PublicDirectoryEntity[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  // how many of the selected districts the last search covered (it reads the first MAX_DISTRICTS of them)
  const [searched, setSearched] = useState<number | null>(null)
  // the poi_key of the business whose directory details are expanded, or null; kept in the map's address
  // (map-query.ts `biz`) with this list's own search (`bq`), so a reload opens the same list on the same card
  const [openId, setOpenId] = useStickyState<string | null>('businesses.open', null)
  const [kept, setKept] = useStickyState<{ q: string; scope: string | null } | null>('businesses.search', null)
  // a signed-out search: the match count and the first few names the server allows (lib/guest-preview.ts)
  const [preview, setPreview] = useState<GuestPreviewRow[]>([])
  const key = districts.join('|')
  // the list a kept search belongs to: another city, other districts or another search from the top start afresh
  const scope = `${city}|${key}|${query ?? ''}`
  // each search takes a number; an answer that is no longer the latest (another search, city or districts since) is dropped
  const latest = useRef(0)

  useEffect(() => {
    latest.current++; setRows([]); setTotal(null); setPicked(new Set()); setStatus('idle')
    // a search and a card kept for another list leave (and the address with them)
    if (kept?.scope != null && kept.scope !== scope) { setKept(null); setOpenId(null) }
  }, [key, city]) // eslint-disable-line react-hooks/exhaustive-deps
  // a search from the top of the map runs at once, over the selected districts or the whole city; a search made in
  // this same list before (a reload, or a step left and opened again) runs instead
  useEffect(() => {
    if (kept && (kept.scope == null || kept.scope === scope)) {
      if (kept.scope == null) setKept({ q: kept.q, scope })
      setActivity(kept.q)
      void load(kept.q)
    } else if (query) void load()
  }, [query, city]) // eslint-disable-line react-hooks/exhaustive-deps

  // a district picked from an answer that already studied an activity (gaps, a business audience) opens its list on it:
  // the activity is typed in the field and searched at once, never asked again
  useEffect(() => {
    if (!prefill || !districts.length || query || (kept && kept.scope === scope)) return
    setActivity(prefill)
    void load(prefill)
  }, [key, city, prefill]) // eslint-disable-line react-hooks/exhaustive-deps

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
      let guest = false
      // no district chosen: one search over the whole city, which needs an activity
      const scopes: (string | null)[] = districts.length ? districts.slice(0, MAX_DISTRICTS) : typed ? [null] : []
      for (const district of scopes) {
        const response = await fetch('/api/market/entities', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ city, ...(district ? { district } : {}), limit: PAGE, offset: 0, ...(typed ? { q: typed, objective: 'purchase' } : {}) }),
        })
        const body = await response.json().catch(() => null) as { rows?: PublicDirectoryEntity[]; total?: number; error?: string; guest?: boolean } | null
        if (stale()) return
        if (response.status === 401) { setStatus('login'); return }
        if (!response.ok || !body) throw new Error(body?.error || 'تعذر تحميل المنشآت.')
        if (body.guest) {
          guest = true
          setPreview((current) => (count ? current : []).concat(((body.rows ?? []) as unknown as GuestPreviewRow[])).slice(0, GUEST_PREVIEW))
          count += typeof body.total === 'number' ? body.total : 0
          continue
        }
        found.push(...(body.rows ?? []))
        count += typeof body.total === 'number' ? body.total : (body.rows ?? []).length
      }
      if (stale()) return
      if (guest) { setTotal(count); setSearched(districts.length ? scopes.length : null); setStatus('guest'); setKept(query && typed === query.trim() ? null : { q: typed, scope }); return }
      const unique = [...new Map(found.map((row) => [row.id, row])).values()]
      setRows(unique)
      setTotal(count)
      setSearched(districts.length ? scopes.length : null)
      setPicked(new Set())
      setStatus('ready')
      // a search typed here is kept for this list; the top search's own is already in the address
      setKept(query && typed === query.trim() ? null : { q: typed, scope })
      // a card kept open on a business this list no longer holds closes
      setOpenId((current) => (current && unique.some((row) => row.id === current) ? current : null))
    } catch (error) {
      if (stale()) return
      setMessage(error instanceof Error ? error.message : 'تعذر تحميل المنشآت.')
      setStatus('error')
    }
  }

  // the list can follow the map: only the businesses in view, as «العقار» does; the dots outside stay on the map
  const [followMap, setFollowMap] = useState(false)
  const inView = (row: PublicDirectoryEntity) => {
    if (!bounds || row.latitude == null || row.longitude == null) return false
    const [w, so, e, n] = bounds
    return row.longitude >= w && row.longitude <= e && row.latitude >= so && row.latitude <= n
  }
  const byMap = followMap && bounds != null
  const shown = byMap ? rows.filter(inView) : rows
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
      cityName: cities.find((item) => item.en === city)?.ar ?? undefined,
      query: activity.trim() || undefined,
      categoryHint: activity.trim() || undefined,
      districtHint: districts.length === 1 ? districts[0] : undefined,
      liveBusinesses: rows.filter((row) => picked.has(row.id)),
      // the map view the businesses were picked in: the request leads back to it
      origin: `${window.location.pathname}${window.location.search}`,
    })
    toast.success('جُهّزت المسودة', { description: `${numberFormat.format(ids.length)} منشأة، راجعها قبل أي إرسال.` })
    const go = () => router.push(`/requests/${id}`)
    // reduced motion: straight to the request, no flash; otherwise a brief acknowledgement on the picked rows first
    if (reduce) { go(); return }
    setFlashing(true)
    window.setTimeout(go, 260)
  }

  // the answer's businesses go to the map as named dots while the list is on screen, and leave with it
  const markers = useRef(onMarkers)
  markers.current = onMarkers
  useEffect(() => {
    const ready = status === 'ready' ? rows : []
    markers.current?.(ready.flatMap((row) => (row.latitude != null && row.longitude != null
      ? [{ id: row.id, lon: row.longitude, lat: row.latitude, name: row.name, inRequest: inRequest.has(row.id) }] : [])), ready)
    // keyed by the answer and the request's list, not the Set rebuilt each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, status, inRequestKey])
  useEffect(() => () => markers.current?.([], []), [])

  function removeHere(row: PublicDirectoryEntity) {
    if (!target) return
    if (removeFromRequest(target.id, [row.id])) toast.success(`أُزيلت ${row.name} من «${target.title}»`, { description: 'تبقى في القائمة هنا إن أردت إعادتها.' })
  }

  function addTo(requestId: string) {
    const request = requests.find((item) => item.id === requestId)
    const picks = rows.filter((row) => picked.has(row.id))
    if (!request || !picks.length) return
    const added = addToRequest(requestId, picks)
    toast.success(added ? `أُضيفت ${counted(added, 'business')} إلى «${request.title}»` : 'كلها في الطلب من قبل',
      { description: added && added < picks.length ? `${counted(picks.length - added, 'business')} في الطلب من قبل. راجعه قبل أي إرسال.` : 'راجعه قبل أي إرسال.' })
    router.push(`/requests/${requestId}`)
  }

  // sign-in returns to this same view (city, districts and search kept in the address)
  const here = () => typeof window === 'undefined' ? '/map' : `${window.location.pathname}${window.location.search}`
  const where = !districts.length ? 'المدينة' : districts.length === 1 ? districts[0] : counted(districts.length, 'district')

  return (
    <section aria-label="منشآت الحي" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">منشآت {where}</h2>
      {/* in «add to this request» mode the panel says where the picks go, from the first look */}
      {target && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
          <PlusCircle className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">تضيف إلى «{target.title}» · {target.businessIds.length ? `فيه ${counted(target.businessIds.length, 'business')}` : 'لا منشآت فيه بعد'}</span>
          <button type="button" onClick={() => setAddId(null)} className="shrink-0 font-semibold underline-offset-4 hover:underline">طلب جديد بدلاً منه</button>
        </p>
      )}
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
      {status === 'login' && <p className="text-base">لعرض المنشآت وإنشاء طلب <Link href={`/login?next=${encodeURIComponent(here())}`} className="font-semibold text-primary underline">سجّل الدخول</Link>.</p>}
      {status === 'guest' && total === 0 && (
        <NoResult title={`لا منشآت «${activity.trim()}» في ${where}`} body="جرّب اسماً آخر للنشاط."
          action={<Link href={`/login?next=${encodeURIComponent(here())}`} className="text-sm font-semibold text-primary underline">سجّل الدخول</Link>} />
      )}
      {status === 'guest' && total != null && total > 0 && (
        <>
          <p role="status" className="text-base"><span className="font-bold">{numberFormat.format(total)}</span> منشأة «{activity.trim()}» في {where}{searched != null && searched < districts.length ? ` (في ${numberFormat.format(searched)} من ${counted(districts.length, 'district')} محددة)` : ''}</p>
          <ul className="divide-y rounded-lg border text-base">
            {preview.map((row, index) => (
              <li key={index} className="px-3 py-2">
                <span className="block truncate font-medium">{row.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{row.category}{row.district ? ` · ${row.district}` : ''}</span>
              </li>
            ))}
          </ul>
          {total > preview.length && <p className="text-sm text-muted-foreground">أول {numberFormat.format(preview.length)} من {numberFormat.format(total)}.</p>}
          <Link href={`/login?next=${encodeURIComponent(here())}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-base font-semibold text-primary-foreground">
            <LogIn className="size-4" aria-hidden /> سجّل الدخول لترى الكل وتتواصل
          </Link>
          <p className="text-sm text-muted-foreground">بعد الدخول ترى كل المنشآت وتفاصيلها، وتختار منها لطلب تسعير أو قائمة.</p>
        </>
      )}
      {status === 'error' && <LoadError what="المنشآت" detail={message === 'تعذر تحميل المنشآت.' ? undefined : message} onRetry={() => void load()} />}
      {status === 'ready' && rows.length === 0 && (
        <NoResult title={`لا منشآت ${activity.trim() ? `«${activity.trim()}» ` : ''}في ${where}`} body={activity.trim() ? 'جرّب اسماً آخر للنشاط، أو كل الأنشطة.' : 'جرّب حياً آخر.'} />
      )}
      {status === 'ready' && rows.length > 0 && (
        // one gentle container fade as the skeleton gives way to the real list — perceived speed, not a hard cut; it
        // plays once on mount, never again on a pick toggle, and collapses to instant when motion is reduced
        <Reveal className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{byMap
              ? `${numberFormat.format(shown.length)} منشأة في ما تُظهره الخريطة من ${numberFormat.format(rows.length)}`
              : `${numberFormat.format(shown.length)} منشأة معروضة${total != null && total > rows.length ? ` من ${numberFormat.format(total)}` : ''}${searched != null && searched < districts.length ? ` · في ${numberFormat.format(searched)} من ${counted(districts.length, 'district')} محددة` : ''}`}</span>
          </div>
          {/* the same switch as «العقار»: the list narrows to what the map shows as it moves */}
          {onMarkers && bounds && rows.some((row) => row.latitude != null && row.longitude != null) && (
            <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={followMap} onChange={(event) => setFollowMap(event.target.checked)} className="size-4 accent-primary" />
              حدّث القائمة عند تحريك الخريطة
            </label>
          )}
          {byMap && !shown.length && <p className="text-sm text-muted-foreground">لا منشأة من هذه القائمة في ما تُظهره الخريطة. حرّك الخريطة أو صغّرها.</p>}
          {shown.length > 0 && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((row) => row.id)))} className="size-4 accent-primary" />
              اختر الكل ({numberFormat.format(shown.length)})
            </label>
          )}
          <ul className="max-h-80 divide-y overflow-y-auto text-base">
            {shown.map((row) => (
              <li key={row.id} id={`biz-row-${row.id}`} className="scroll-mt-2" onMouseEnter={() => onPoint?.(row.id)} onMouseLeave={() => onPoint?.(null)}
                onFocus={() => onPoint?.(row.id)} onBlur={() => onPoint?.(null)}>
                {/* the whole row answers a hover and a press (cheap CSS, so a long list stays smooth); a picked row keeps
                    a soft olive tint, and flashes once the moment its draft is prepared */}
                <div className={cn('flex items-center gap-2 py-2 transition-colors hover:bg-muted/40 active:bg-muted/60',
                  picked.has(row.id) && 'bg-primary/5', pointed === row.id && 'bg-muted/60', flashing && picked.has(row.id) && 'atlas-confirm-flash')}>
                  {/* a business already in the request is not picked again: it says so, and comes off with «أزل» */}
                  {inRequest.has(row.id)
                    ? <button type="button" onClick={() => removeHere(row)} aria-label={`أزل ${row.name} من «${target?.title ?? ''}»`}
                        className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-1.5">في الطلب · أزل</button>
                    : <input type="checkbox" aria-label={`اختيار ${row.name}`} checked={picked.has(row.id)} onChange={() => toggle(row.id)} className="size-4 shrink-0 accent-primary" />}
                  <button type="button" onClick={() => setOpenId(openId === row.id ? null : row.id)} aria-expanded={openId === row.id} className="min-w-0 flex-1 text-start">
                    <span className="block truncate font-medium">{row.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{row.category}{row.district ? ` · ${row.district}` : ''}</span>
                  </button>
                  {/* where it is: the map flies to the business and marks it (only with a location on file) */}
                  {onLocate && row.latitude != null && row.longitude != null && (
                    <button type="button" onClick={() => onLocate(row)} aria-pressed={located === row.id} aria-label={`اعرض ${row.name} على الخريطة`} title="على الخريطة"
                      className={cn('grid size-8 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-10', located === row.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-primary')}>
                      <MapPin className="size-4" aria-hidden />
                    </button>
                  )}
                  <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform', openId === row.id && 'rotate-180')} />
                </div>
                {/* the details open in sync with the chevron: height and opacity together, instant when motion is reduced */}
                <Expand open={openId === row.id}><BusinessDetail row={row} /></Expand>
              </li>
            ))}
          </ul>
          {/* the picks join a draft already started (the one named by the address first) instead of a new request */}
          {target ? (
            <button disabled={!picked.size} onClick={() => addTo(target.id)}
              className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold', picked.size ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'cursor-not-allowed bg-primary/40 text-primary-foreground')}>
              <PlusCircle className="size-4" aria-hidden /> أضف{picked.size ? ` ${counted(picked.size, 'business')}` : ''} إلى «{target.title}»
            </button>
          ) : drafts.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="shrink-0 font-medium">أضف إلى مسودة</span>
              <select value="" disabled={!picked.size} onChange={(event) => { if (event.target.value) addTo(event.target.value) }}
                className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm disabled:opacity-50">
                <option value="">{picked.size ? 'اختر المسودة' : 'اختر منشأة أولاً'}</option>
                {drafts.map((request) => <option key={request.id} value={request.id}>{TYPE_LABEL[request.type]}: {request.title}</option>)}
              </select>
            </label>
          )}
          {/* the action bar is the acknowledgement: it arrives only once a business is picked, so the step reads «now you
              can act», not a row of dead buttons. It leaves again when the selection is cleared. */}
          <AnimatePresence initial={false}>
            {picked.size > 0 && (
              <motion.div key="actions" className="grid grid-cols-3 gap-1.5"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                transition={ease(reduce)}>
                {([['rfq', 'طلب تسعير', ClipboardList], ['campaign', 'حملة واتساب', Megaphone], ['list', 'حفظ قائمة', ListPlus]] as const).map(([type, label, Icon]) => (
                  <button key={type} onClick={() => act(type)}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-primary px-2 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground">
                    <Icon className="size-4" aria-hidden /> {label} <PickCount value={picked.size} reduce={reduce} />
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <p className="text-sm text-muted-foreground">{picked.size ? 'يُفتح الطلب في «الطلبات» لتراجعه. لا يُرسل شيء من هنا.' : 'اختر منشأة أو أكثر لتنشئ منها طلباً. لا يُرسل شيء من هنا.'}</p>
        </Reveal>
      )}
    </section>
  )
}
