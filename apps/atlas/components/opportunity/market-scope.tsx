'use client'

import { Crosshair, MapPinned, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { GoalDef } from '@/lib/goals'

export function MarketScope({ goal, city, query, district, total, viewportScoped = false, onClearQuery, onClearDistrict }: {
  goal: GoalDef
  city: string
  query: string
  district: string | null
  total: number | null
  viewportScoped?: boolean
  onClearQuery: () => void
  onClearDistrict: () => void
}) {
  const Icon = goal.icon
  return (
    <section aria-label="نطاق قرارك الحالي" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="flex items-start justify-between gap-3 bg-primary/[0.04] px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Icon className="size-4" /></span>
          <div className="min-w-0"><p className="text-xs text-muted-foreground">قرارك الحالي</p><h2 className="truncate text-sm font-semibold">{goal.label}</h2></div>
        </div>
        {total != null ? <span className="shrink-0 rounded-full bg-card px-2.5 py-1 text-xs font-semibold tabular-nums text-primary">{total.toLocaleString('en-US')} منشأة</span> : null}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <ScopeRow icon={<MapPinned className="size-3.5" />} label="المدينة" value={city} />
        {district ? <ScopeRow icon={<Crosshair className="size-3.5" />} label="النطاق" value={`حي ${district}`} onClear={onClearDistrict} /> : null}
        {viewportScoped ? <p className="text-xs leading-5 text-muted-foreground">المؤشرات الآن محصورة في الجزء الظاهر من الخريطة؛ القائمة تبقى ضمن نطاق الحي أو البحث.</p> : null}
        {query ? <ScopeRow icon={<Search className="size-3.5" />} label="النشاط" value={query} onClear={onClearQuery} /> : <p className="text-xs leading-5 text-muted-foreground">اختر حيًا أو اكتب نشاطًا لتتحول القراءة العامة إلى قائمة منشآت قابلة للمراجعة.</p>}
      </div>
    </section>
  )
}

function ScopeRow({ icon, label, value, onClear }: { icon: ReactNode; label: string; value: string; onClear?: () => void }) {
  return <div className="flex min-w-0 items-center gap-2 text-xs"><span className="text-primary">{icon}</span><span className="shrink-0 text-muted-foreground">{label}</span><span className="min-w-0 flex-1 truncate font-medium text-foreground">{value}</span>{onClear ? <Button type="button" variant="ghost" size="icon-xs" onClick={onClear} aria-label={`مسح ${label}`}><X className="size-3.5" /></Button> : null}</div>
}
