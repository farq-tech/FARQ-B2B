'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Loader2, Megaphone, MessageCircle, Search } from 'lucide-react'
import { numberFormat } from '@/lib/insights-api'
import type { PublicDirectoryEntity } from '@/lib/live-directory'
import { useAppStore } from '@/lib/store'
import type { RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'

type Status = 'idle' | 'loading' | 'ready' | 'login' | 'error'
const PAGE = 200

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
  const [whatsappOnly, setWhatsappOnly] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const key = districts.join('|')

  useEffect(() => { setRows([]); setTotal(null); setPicked(new Set()); setStatus('idle') }, [key, city])
  // a search from the top of the map runs at once, over the selected districts or the whole city
  useEffect(() => { if (query) void load() }, [query, city]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setStatus('loading')
    try {
      const found: PublicDirectoryEntity[] = []
      let count = 0
      // no district chosen: one search over the whole city, which needs an activity
      const scopes: (string | null)[] = districts.length ? districts.slice(0, 5) : activity.trim() ? [null] : []
      for (const district of scopes) {
        const response = await fetch('/api/market/entities', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ city, ...(district ? { district } : {}), limit: PAGE, offset: 0, ...(activity.trim() ? { q: activity.trim(), objective: 'purchase' } : {}) }),
        })
        const body = await response.json().catch(() => null) as { rows?: PublicDirectoryEntity[]; total?: number; error?: string } | null
        if (response.status === 401) { setStatus('login'); return }
        if (!response.ok || !body) throw new Error(body?.error || 'تعذر تحميل المنشآت.')
        found.push(...(body.rows ?? []))
        count += typeof body.total === 'number' ? body.total : (body.rows ?? []).length
      }
      const unique = [...new Map(found.map((row) => [row.id, row])).values()]
      setRows(unique)
      setTotal(count)
      setPicked(new Set())
      setStatus('ready')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تحميل المنشآت.')
      setStatus('error')
    }
  }

  const shown = useMemo(() => (whatsappOnly ? rows.filter((row) => row.whatsapp) : rows), [rows, whatsappOnly])
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
    router.push(`/requests/${id}`)
  }

  const where = !districts.length ? 'المدينة' : districts.length === 1 ? districts[0] : `${numberFormat.format(districts.length)} أحياء`

  return (
    <section aria-label="منشآت الحي" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-lg font-bold">منشآت {where}</h2>
      <div className="flex gap-2">
        <input value={activity} onChange={(event) => setActivity(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }}
          placeholder="كل الأنشطة، أو اكتب نشاطاً" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-base" />
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-base font-semibold text-primary-foreground">
          <Search className="size-4" aria-hidden /> اعرض
        </button>
      </div>
      {status === 'loading' && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ التحميل" />}
      {status === 'login' && <p className="text-base">لعرض المنشآت وإنشاء طلب <Link href="/login?next=/map" className="font-semibold text-primary underline">سجّل الدخول</Link>.</p>}
      {status === 'error' && <p role="alert" className="text-base text-destructive">{message}</p>}
      {status === 'ready' && (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{numberFormat.format(shown.length)} منشأة معروضة{total != null && total > rows.length ? ` من ${numberFormat.format(total)}` : ''}</span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={whatsappOnly} onChange={(event) => setWhatsappOnly(event.target.checked)} className="size-4 accent-[#25c99a]" /> بواتساب فقط
            </label>
          </div>
          {shown.length > 0 && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((row) => row.id)))} className="size-4 accent-[#25c99a]" />
              اختر الكل ({numberFormat.format(shown.length)})
            </label>
          )}
          <ul className="max-h-80 divide-y overflow-y-auto text-base">
            {shown.map((row) => (
              <li key={row.id}>
                <label className="flex cursor-pointer items-center gap-2 py-2">
                  <input type="checkbox" checked={picked.has(row.id)} onChange={() => toggle(row.id)} className="size-4 shrink-0 accent-[#25c99a]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{row.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{row.category}{row.district ? ` · ${row.district}` : ''}</span>
                  </span>
                  {row.whatsapp && <MessageCircle className="size-4 shrink-0 text-primary" aria-label="واتساب" />}
                </label>
              </li>
            ))}
          </ul>
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
