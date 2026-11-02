'use client'

import { Baby, Loader2, MapPin, Store, Users } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { LoadError } from '@/components/shared/load-error'
import { Split, Stat, withReason } from '@/components/shared/stat'
import { Unavailable } from '@/components/shared/unavailable'
import { EXPLAIN } from '@/lib/explanations'
import { formatDistance, numberFormat } from '@/lib/insights-api'
import { PALETTE, readableOn } from '@/lib/palette'

/** /api/market/site-card (services/targeting-api/site_card.py). Every figure is computed there; this only draws it. */
export type SiteCardData = {
  people: {
    population: number | null
    men: number | null; women: number | null
    saudi: number | null; non_saudi: number | null
    children: number | null; children_is_estimate: boolean
    /** why a people figure is null, one short Arabic line per field (site_card.py); absent on older API builds */
    reasons?: Partial<Record<'population' | 'men' | 'women' | 'saudi' | 'non_saudi' | 'children', string>>
  }
  competitors: { n: number; per_km2: number | null; area_km2: number | null; nearest: { name: string | null; district_ar: string | null; distance_m: number | null }[] } | null
  residents_per_competitor: number | null
  reasons?: Partial<Record<'per_km2' | 'residents_per_competitor', string>>
}
export type SiteCardState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: SiteCardData }

/** A whole figure, or null when the data does not have it (Stat then reads «غير متاح»). */
const figure = (value: number | null | undefined) => (value == null ? null : numberFormat.format(Math.round(value)))
const show = (value: number | null | undefined) => figure(value) ?? <Unavailable />

/**
 * «بطاقة الموقع»: for one candidate site and its range, who already competes there (by name and distance) and who
 * lives there (women and men, Saudis and others, children as an estimate). A missing figure reads «غير متاح».
 */
export function SiteCard({ label, color, reach, activity, state, onRetry }: { label: string; color: string; reach: string; activity: string; state?: SiteCardState; onRetry?: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center gap-2 px-4 py-3" style={{ background: color, color: readableOn(color) }}>
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-white/25 text-sm font-bold">{label}</span>
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-tight">بطاقة الموقع {label}</h3>
          <p className="truncate text-xs opacity-90">{reach} · {activity}</p>
        </div>
      </header>
      {(!state || state.status === 'loading') && (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" aria-hidden />جارٍ حساب البطاقة</div>
      )}
      {state?.status === 'error' && <LoadError what="بطاقة الموقع" detail={state.message} onRetry={onRetry} className="m-4" />}
      {state?.status === 'ready' && <Body data={state.data} activity={activity} />}
    </article>
  )
}

function Body({ data, activity }: { data: SiteCardData; activity: string }) {
  const { people, competitors } = data
  return (
    <div className="space-y-4 p-4">
      <section className="space-y-2.5">
        <h4 className="flex items-center gap-1.5 text-sm font-bold"><Store className="size-4 text-primary" aria-hidden />المنافسون حولك</h4>
        {competitors == null ? (
          <p className="text-sm text-muted-foreground">اختر نشاطك في «أين ينقص نشاطي؟» لتظهر منافسيك هنا.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="عددهم" value={figure(competitors.n)} explain={EXPLAIN.siteCompetitors(activity)} />
              <Stat label="لكل كم²" value={competitors.per_km2 == null ? null : numberFormat.format(Math.round(competitors.per_km2 * 10) / 10)} explain={EXPLAIN.siteCompetitorDensity} reason={data.reasons?.per_km2} />
              <Stat label="ساكن لكل منافس" value={figure(data.residents_per_competitor)} explain={EXPLAIN.siteResidentsPerCompetitor} reason={data.reasons?.residents_per_competitor} />
            </div>
            {competitors.nearest.length > 0 ? (
              <ul className="divide-y rounded-xl border">
                {competitors.nearest.slice(0, 5).map((row, index) => (
                  <li key={`${row.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.name || 'منشأة بلا اسم'}</span>
                      {row.district_ar && <span className="block truncate text-xs text-muted-foreground">{row.district_ar}</span>}
                    </span>
                    {row.distance_m != null && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                        <MapPin className="size-3" aria-hidden />{formatDistance(row.distance_m)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium text-primary">لا منافس من نشاطك داخل هذه المنطقة.</p>
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="flex items-center gap-1.5 text-sm font-bold"><Users className="size-4 text-primary" aria-hidden />من يسكن حولك</h4>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">السكان</span>
          <Explained title="السكان" lines={people.population == null ? withReason(EXPLAIN.aroundPeople, people.reasons?.population) : EXPLAIN.aroundPeople} className="text-2xl font-bold tabular-nums">{show(people.population)}</Explained>
        </div>
        <Split title="النساء والرجال" explain={EXPLAIN.siteSplit('الإناث والذكور')} reason={people.reasons?.women ?? people.reasons?.men}
          left={{ label: 'نساء', value: people.women, color: PALETTE.plum }} right={{ label: 'رجال', value: people.men, color: PALETTE.slate }} />
        <Split title="السعوديون وغيرهم" explain={EXPLAIN.siteSplit('السعوديين')} reason={people.reasons?.saudi ?? people.reasons?.non_saudi}
          left={{ label: 'سعوديون', value: people.saudi, color: PALETTE.olive }} right={{ label: 'غيرهم', value: people.non_saudi, color: PALETTE.sand }} />
        <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium"><Baby className="size-4 text-primary" aria-hidden />أطفال دون 15 سنة</span>
          <span className="inline-flex items-center gap-2">
            <Explained title="أطفال دون 15 سنة" lines={people.children == null ? withReason(EXPLAIN.siteChildren, people.reasons?.children) : EXPLAIN.siteChildren} className="text-lg font-bold tabular-nums">{show(people.children)}</Explained>
            {people.children != null && people.children_is_estimate && <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">تقدير</span>}
          </span>
        </div>
      </section>
    </div>
  )
}
