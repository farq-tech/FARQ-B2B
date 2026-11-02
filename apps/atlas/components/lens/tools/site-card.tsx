'use client'

import { Baby, Loader2, MapPin, Store, Users } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, percent } from '@/lib/insights-api'
import { PALETTE } from '@/lib/palette'
import { cn } from '@/lib/utils'

/** /api/market/site-card (services/targeting-api/site_card.py). Every figure is computed there; this only draws it. */
export type SiteCardData = {
  people: {
    population: number | null
    men: number | null; women: number | null
    saudi: number | null; non_saudi: number | null
    children: number | null; children_is_estimate: boolean
  }
  competitors: { n: number; per_km2: number | null; area_km2: number | null; nearest: { name: string | null; district_ar: string | null; distance_m: number | null }[] } | null
  residents_per_competitor: number | null
}
export type SiteCardState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: SiteCardData }

const show = (value: number | null | undefined) => (value == null ? 'غير متاح' : numberFormat.format(Math.round(value)))
const distance = (metres: number | null) => (metres == null ? '' : metres < 1000 ? `${numberFormat.format(Math.round(metres / 10) * 10)} م` : `${numberFormat.format(Math.round(metres / 100) / 10)} كم`)

function Stat({ label, value, explain }: { label: string; value: string; explain: string[] }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Explained title={label} lines={explain} className={cn('mt-0.5 font-bold tabular-nums', value === 'غير متاح' ? 'text-sm text-muted-foreground' : 'text-xl')}>{value}</Explained>
    </div>
  )
}

/** Two parts of one whole (women and men, Saudis and others) as one bar, each part with its number and share. */
function Split({ title, left, right, explain }: {
  title: string
  left: { label: string; value: number | null; color: string }
  right: { label: string; value: number | null; color: string }
  explain: string[]
}) {
  const total = left.value != null && right.value != null ? left.value + right.value : null
  if (!total) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{title}</span>
        <Explained title={title} lines={explain} className="text-muted-foreground">غير متاح</Explained>
      </div>
    )
  }
  const share = (value: number) => Math.round((100 * value) / total)
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{title}</p>
      <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden>
        <span style={{ width: `${share(left.value!)}%`, background: left.color }} />
        <span style={{ width: `${100 - share(left.value!)}%`, background: right.color }} />
      </div>
      <div className="flex justify-between text-sm">
        {[left, right].map((part) => (
          <Explained key={part.label} title={part.label} lines={explain} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: part.color }} aria-hidden />
            <span className="text-muted-foreground">{part.label}</span>
            <span className="font-bold tabular-nums">{show(part.value)}</span>
            <span className="text-xs text-muted-foreground">{percent(share(part.value!))}</span>
          </Explained>
        ))}
      </div>
    </div>
  )
}

/**
 * «بطاقة الموقع»: for one candidate site and its range, who already competes there (by name and distance) and who
 * lives there (women and men, Saudis and others, children as an estimate). A missing figure reads «غير متاح».
 */
export function SiteCard({ label, color, reach, activity, state }: { label: string; color: string; reach: string; activity: string; state?: SiteCardState }) {
  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center gap-2 px-4 py-3 text-white" style={{ background: color }}>
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-white/25 text-sm font-bold">{label}</span>
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-tight">بطاقة الموقع {label}</h3>
          <p className="truncate text-xs opacity-90">{reach} · {activity}</p>
        </div>
      </header>
      {(!state || state.status === 'loading') && (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" aria-hidden />جارٍ حساب البطاقة</div>
      )}
      {state?.status === 'error' && <p className="p-4 text-sm text-destructive">{state.message}</p>}
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
              <Stat label="عددهم" value={show(competitors.n)} explain={EXPLAIN.siteCompetitors(activity)} />
              <Stat label="لكل كم²" value={competitors.per_km2 == null ? 'غير متاح' : numberFormat.format(Math.round(competitors.per_km2 * 10) / 10)} explain={EXPLAIN.siteCompetitorDensity} />
              <Stat label="ساكن لكل منافس" value={show(data.residents_per_competitor)} explain={EXPLAIN.siteResidentsPerCompetitor} />
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
                        <MapPin className="size-3" aria-hidden />{distance(row.distance_m)}
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
          <Explained title="السكان" lines={EXPLAIN.aroundPeople} className="text-2xl font-bold tabular-nums">{show(people.population)}</Explained>
        </div>
        <Split title="النساء والرجال" explain={EXPLAIN.siteSplit('الإناث والذكور')}
          left={{ label: 'نساء', value: people.women, color: PALETTE.plum }} right={{ label: 'رجال', value: people.men, color: PALETTE.slate }} />
        <Split title="السعوديون وغيرهم" explain={EXPLAIN.siteSplit('السعوديين')}
          left={{ label: 'سعوديون', value: people.saudi, color: PALETTE.olive }} right={{ label: 'غيرهم', value: people.non_saudi, color: PALETTE.sand }} />
        <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium"><Baby className="size-4 text-primary" aria-hidden />أطفال دون 15 سنة</span>
          <span className="inline-flex items-center gap-2">
            <Explained title="أطفال دون 15 سنة" lines={EXPLAIN.siteChildren} className="text-lg font-bold tabular-nums">{show(people.children)}</Explained>
            {people.children != null && <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">تقدير</span>}
          </span>
        </div>
      </section>
    </div>
  )
}
