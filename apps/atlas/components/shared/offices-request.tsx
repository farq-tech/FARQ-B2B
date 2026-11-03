'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Chip } from '@/components/ui/chip'
import { makeId } from '@/lib/format'
import { loginHref } from '@/lib/handoff'
import { numberFormat } from '@/lib/insights-api'
import type { PublicDirectoryEntity } from '@/lib/live-directory'
import { typeLabel } from '@/lib/real-estate'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/** The period a price is stated in, after it (a sale has none). */
const PERIOD: Record<string, string> = { rent_year: ' سنوياً', rent_month: ' شهرياً', sale: '' }

/** The directory's real-estate offices (the «مكتب عقار» sub-activity of «عقار»), asked by their taxonomy id. */
export const REAL_ESTATE = { sub_id: 're.office', label: 'مكتب عقار', plural: 'مكاتب العقار', noun: 'مكتب عقار' }
/** And its valuers («تقييم عقاري»), offered beside the offices for a sale. */
export const VALUERS = { sub_id: 're.valuation', label: 'تقييم عقاري', plural: 'مكاتب التقييم العقاري', noun: 'مكتب تقييم' }
export type Kindred = typeof REAL_ESTATE
const DEAL_WORD: Record<string, string> = { rent_year: 'للإيجار السنوي', rent_month: 'للإيجار الشهري', sale: 'للبيع' }

/**
 * A priced property turned into a quote request to the district's real-estate businesses: the draft names the property
 * (type, deal, area, district) and Atlas's expected price, and opens in «الطلبات» for review. Nothing is sent: a quote
 * request is shared by the person after review (docs/atlas-product-foundation.md §1.5), and no contact is shown here.
 */
export function OfficesRequest({ asked, cityName, price, fromListing = null, to = REAL_ESTATE, className = 'sm:col-span-2', compact = false }: { asked: { city: string; district?: string; districtName?: string; deal: string; kind: string; area: number }; cityName: string; price?: number; fromListing?: { id: string; ask: number | null } | null; to?: Kindred; className?: string; /** A link-sized button, for a card (a listing's). */ compact?: boolean }) {
  const valuation = to.sub_id === VALUERS.sub_id
  const router = useRouter()
  const { createDraft } = useAppStore()
  const [state, setState] = useState<'idle' | 'loading' | 'login' | 'empty' | 'error'>('idle')
  const name = asked.districtName ?? 'الحي'
  const start = async () => {
    if (!asked.districtName) return
    setState('loading')
    const response = await fetch('/api/market/entities', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city: asked.city, district: asked.districtName, sub_id: to.sub_id, q: to.label, objective: 'purchase', limit: 50, offset: 0 }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null) as { rows?: PublicDirectoryEntity[]; guest?: boolean } | null
    // a signed-out visitor sees the sign-in, never a preview turned into a request
    if (response?.status === 401 || body?.guest) { setState('login'); return }
    if (!response?.ok || !body) { setState('error'); return }
    const rows = body.rows ?? []
    if (!rows.length) { setState('empty'); return }
    const property = `${typeLabel(asked.kind)} ${DEAL_WORD[asked.deal] ?? ''} في ${name}`.replace(/\s+/g, ' ')
    const id = createDraft({
      type: 'rfq', businessIds: rows.map((row) => row.id), liveBusinesses: rows, cityId: asked.city.toLowerCase(), cityName,
      query: to.label, categoryHint: to.label, districtHint: name,
      title: valuation ? `طلب تقييم ${property}` : fromListing ? `طلب عروض مثل عرض ${property}` : `طلب عروض ${property}`,
      rfq: {
        lineItems: [{ id: makeId('l'), name: property, qty: 1, unit: 'عقار', spec: `${numberFormat.format(asked.area)} م²` }],
        deliveryCity: cityName,
        notes: [
          fromListing?.ask != null ? `عرض مثله معروض الآن بـ ${numberFormat.format(fromListing.ask)} ريال${PERIOD[asked.deal] ?? ''}.` : null,
          price != null ? `السعر المتوقع في أطلس: ${numberFormat.format(price)} ريال${PERIOD[asked.deal] ?? ''}.` : null,
          valuation ? 'أرسلوا عرض سعر لتقييم العقار ومدته.' : 'أرسلوا عروضاً مشابهة إن وُجدت.',
        ].filter(Boolean).join(' '),
      },
    })
    toast.success(valuation ? 'جُهّز طلب التقييم' : 'جُهّز طلب العروض', { description: `${numberFormat.format(rows.length)} ${to.noun} في ${name}. راجعه قبل أي مشاركة، لا يُرسل شيء تلقائياً.` })
    router.push(`/requests/${id}`)
  }
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <button type="button" onClick={() => void start()} disabled={state === 'loading' || !asked.districtName}
        className={compact
          ? 'inline-flex items-center gap-1.5 self-start rounded-lg py-1 text-start text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 pointer-coarse:min-h-11'
          : 'inline-flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-start text-sm font-semibold outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'}>
        {state === 'loading' ? <Loader2 className={cn('shrink-0 animate-spin text-primary', compact ? 'size-4' : 'size-5')} aria-hidden /> : <ClipboardList className={cn('shrink-0 text-primary', compact ? 'size-4' : 'size-5')} aria-hidden />}
        <span>{valuation ? 'اطلب تقييماً' : fromListing ? 'اطلب عروضاً مثل هذا العرض' : 'اطلب عروضاً مشابهة'} من {to.plural} في {name}</span>
      </button>
      {state === 'login' && <p className="text-sm">لتجهيز الطلب <a href={loginHref(`${window.location.pathname}${window.location.search}`)} className="font-semibold text-primary underline">سجّل الدخول</a>.</p>}
      {state === 'empty' && <p className="text-sm text-muted-foreground">لا {to.plural} في {name} في الدليل.</p>}
      {state === 'error' && <p role="alert" className="flex items-center gap-2 text-sm text-muted-foreground">تعذّر التحميل.<Chip onClick={() => void start()}>أعد المحاولة</Chip></p>}
    </div>
  )
}

