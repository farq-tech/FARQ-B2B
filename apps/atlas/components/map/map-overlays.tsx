'use client'

import { BoxSelect, ChevronDown, ChevronUp, CircleCheck, List, MessageCircle, X, ZoomIn } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatNumber, formatPhone } from '@/lib/format'
import { LEVELS, signalFor, type AreaSummary, type MapLevel } from '@/lib/map-summary'
import { districtById, streetById } from '@/lib/mock-data'
import type { Business, ScoredBusiness } from '@/lib/types'
import { cn } from '@/lib/utils'

const LEVEL_HINT: Record<MapLevel, string> = {
  districts: 'اللون الأغمق يعني تركّزاً أعلى للفرص. اضغط على حي لرؤية ملخصه.',
  clusters: 'تظهر هنا التجمعات الأبرز في النطاق. اضغط على دائرة لرؤية ملخصها ثم انتقل إلى الشوارع للتفاصيل.',
  streets: 'اضغط على شارع نشاط لعرض كثافته وموقعه. لا تظهر جهات أو بيانات اتصال قبل تسجيل الدخول.',
  entities: 'اضغط على منشأة لتحديدها أو إلغاء تحديدها.',
}

interface ContextBarProps {
  cityName: string
  level: MapLevel
  progressive: boolean
  inView: number
  total: number
  selected: number
  hasEntityPins: boolean
  marketSignalCount: number
  areaMode: boolean
  areaLabel?: string
  pendingLevel?: MapLevel | null
  onLevel: (level: MapLevel) => void
  onToggleAreaMode: () => void
}

export function MapContextBar({
  cityName,
  level,
  progressive,
  inView,
  total,
  selected,
  hasEntityPins,
  marketSignalCount,
  areaMode,
  areaLabel,
  pendingLevel,
  onLevel,
  onToggleAreaMode,
}: ContextBarProps) {
  const levels = progressive ? LEVELS : LEVELS.slice(1)
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card/95 p-1.5 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="مستوى التفصيل" className="flex rounded-lg bg-muted p-0.5">
          {levels.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={level === l.id}
              onClick={() => onLevel(l.id)}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
                level === l.id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
        <p className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">{cityName}</span>
          {' · '}
          <span className="font-semibold text-foreground tabular-nums">{formatNumber(inView)}</span>
          {inView === total ? ' منشأة في العرض' : ` من ${formatNumber(total)} في العرض`}
          {selected ? (
            <>
              {' · '}
              <span className="font-semibold text-primary tabular-nums">{formatNumber(selected)}</span> محددة
            </>
          ) : null}
          {level === 'clusters' && marketSignalCount ? (
            <>
              {' · '}
              <span className="font-semibold text-primary tabular-nums">{formatNumber(marketSignalCount)}</span> تجمع نشاط حي
            </>
          ) : null}
        </p>
        <Button size="sm" variant={areaMode ? 'default' : 'outline'} onClick={onToggleAreaMode} aria-pressed={areaMode}>
          <BoxSelect data-icon="inline-start" />
          {areaMode ? 'إلغاء التحديد' : 'تحديد منطقة'}
        </Button>
      </div>
      <p className="px-1.5 pb-0.5 text-[11px] leading-relaxed text-muted-foreground" aria-live="polite">
        {pendingLevel
          ? `جارٍ إظهار ${LEVELS.find((item) => item.id === pendingLevel)?.label ?? 'النتائج'} على الخريطة…`
          : areaMode
            ? 'اسحب على الخريطة لرسم منطقة، أو اضغط على حي لاختياره كاملاً.'
            : areaLabel
              ? `القائمة محصورة في: ${areaLabel}. امسح المنطقة لعرض كل النتائج.`
              : level === 'entities' && !hasEntityPins
                ? 'سجّل الدخول لعرض الجهات المطابقة واختيارها. تظهر إشارات النشاط المجمّعة ومعالم المكان المتاحة عند هذا التقريب.'
                : LEVEL_HINT[level]}
      </p>
    </div>
  )
}

function CardShell({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  return (
    <section aria-label={label} className="relative flex flex-col gap-3 rounded-xl border bg-card p-3.5 shadow-lg">
      <button
        type="button"
        onClick={onClose}
        aria-label="إغلاق البطاقة"
        className="absolute top-2.5 left-2.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      {children}
    </section>
  )
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col rounded-lg bg-muted/60 px-2.5 py-1.5">
      <span className={cn('text-base font-semibold tabular-nums', accent && 'text-primary')}>{formatNumber(value)}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

function SummaryBody({ s }: { s: AreaSummary }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        <Stat value={s.count} label="منشأة" />
        <Stat value={s.whatsappSignals} label="إشارة واتساب" />
        <Stat value={s.selected} label="محددة" accent={s.selected > 0} />
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">إشارة واتساب لا تعني موافقة على التواصل.</p>
      {s.topCategories.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-medium text-muted-foreground">أبرز التصنيفات</p>
          <ul className="flex flex-col gap-1">
            {s.topCategories.map((c) => (
              <li key={c.name} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(8, (c.count / s.count) * 100)}%` }} />
                </span>
                <span className="w-5 text-left tabular-nums text-muted-foreground">{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}

export function DistrictCard({
  name,
  summary,
  intensity,
  onClose,
  onZoom,
  onUseAsArea,
}: {
  name: string
  summary: AreaSummary
  intensity: number
  onClose: () => void
  onZoom: () => void
  onUseAsArea: () => void
}) {
  const signal = signalFor(intensity)
  return (
    <CardShell onClose={onClose} label={`ملخص حي ${name}`}>
      <div className="flex flex-col gap-1 pl-7">
        <p className="text-sm font-semibold">حي {name}</p>
        <div className="flex items-center gap-1.5">
          <Badge variant={signal.tone === 'high' ? 'default' : 'secondary'}>{signal.label}</Badge>
          <span className="text-[11px] text-muted-foreground">مقارنة بأحياء المدينة</span>
        </div>
      </div>
      <SummaryBody s={summary} />
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={onZoom} disabled={!summary.count}>
          <ZoomIn data-icon="inline-start" />
          اقترب من الحي
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onUseAsArea} disabled={!summary.count}>
          <BoxSelect data-icon="inline-start" />
          حصر القائمة فيه
        </Button>
      </div>
    </CardShell>
  )
}

export function ClusterCard({
  summary,
  districtNames,
  onClose,
  onZoom,
  onSelectAll,
}: {
  summary: AreaSummary
  districtNames: string[]
  onClose: () => void
  onZoom: () => void
  onSelectAll: () => void
}) {
  const remaining = summary.count - summary.selected
  return (
    <CardShell onClose={onClose} label="ملخص التجمع">
      <div className="flex flex-col gap-0.5 pl-7">
        <p className="text-sm font-semibold">تجمع من {formatNumber(summary.count)} منشأة</p>
        <p className="truncate text-xs text-muted-foreground">{districtNames.join('، ')}</p>
      </div>
      <SummaryBody s={summary} />
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={onZoom}>
          <ZoomIn data-icon="inline-start" />
          اقترب لرؤية المنشآت
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onSelectAll} disabled={remaining === 0}>
          <CircleCheck data-icon="inline-start" />
          {remaining === 0 ? 'كلها محددة' : `تحديد ${formatNumber(remaining)}`}
        </Button>
      </div>
    </CardShell>
  )
}

export function LiveEntityCard({
  entity,
  selected,
  onClose,
  onToggle,
}: {
  entity: { name: string; category: string; district: string; street: string; whatsapp: boolean; reason: string }
  selected: boolean
  onClose: () => void
  onToggle: () => void
}) {
  return (
    <CardShell onClose={onClose} label={`تفاصيل ${entity.name}`}>
      <div className="flex flex-col gap-0.5 pl-7">
        <p className="truncate text-sm font-semibold">{entity.name}</p>
        <p className="truncate text-xs text-muted-foreground">{entity.category}</p>
      </div>
      <p className="text-xs text-muted-foreground">{[entity.district, entity.street].filter(Boolean).join('، ')}</p>
      {entity.reason ? <p className="text-xs leading-5 text-muted-foreground">{entity.reason}</p> : null}
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{entity.whatsapp ? 'إشارة واتساب متاحة' : 'لم تُتحقق قناة واتساب'}</span>
        <span>لا تظهر بيانات الاتصال هنا</span>
      </div>
      <Button size="sm" className="w-full" variant={selected ? 'outline' : 'default'} onClick={onToggle}>
        <CircleCheck data-icon="inline-start" />
        {selected ? 'إلغاء التحديد' : 'تحديد للمراجعة'}
      </Button>
    </CardShell>
  )
}

export function MarketClusterCard({
  label,
  count,
  wholesale,
  district,
  onClose,
  onZoom,
}: {
  label: string
  count: number
  wholesale: number
  district?: string
  onClose: () => void
  onZoom: () => void
}) {
  return (
    <CardShell onClose={onClose} label={`ملخص تجمع ${label}`}>
      <div className="flex flex-col gap-0.5 pl-7">
        <p className="text-sm font-semibold">{label || 'تجمع فرص'}</p>
        {district ? <p className="truncate text-xs text-muted-foreground">{district}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Stat value={count} label="منشأة ضمن التجمع" />
        <Stat value={wholesale} label="منشأة بالجملة" accent={wholesale > 0} />
      </div>
      <Button size="sm" className="w-full" onClick={onZoom}>
        <ZoomIn data-icon="inline-start" />
        استعرض شوارع التجمع
      </Button>
    </CardShell>
  )
}

export function MarketStreetCard({
  label,
  count,
  wholesale,
  district,
  onClose,
}: {
  label: string
  count: number
  wholesale: number
  district?: string
  onClose: () => void
}) {
  return (
    <CardShell onClose={onClose} label={`ملخص شارع ${label}`}>
      <div className="flex flex-col gap-0.5 pl-7">
        <p className="text-sm font-semibold">{label || 'شارع نشاط'}</p>
        {district ? <p className="truncate text-xs text-muted-foreground">{district}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Stat value={count} label="منشأة على الشارع" />
        <Stat value={wholesale} label="منشأة بالجملة" accent={wholesale > 0} />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">هذه قراءة مجمعة للسوق. سجّل الدخول لعرض الجهات المطابقة واختيارها للمراجعة.</p>
    </CardShell>
  )
}

export function AreaCard({
  label,
  summary,
  onClose,
  onClear,
  onSelectAll,
  onShowList,
}: {
  label: string
  summary: AreaSummary
  onClose: () => void
  onClear: () => void
  onSelectAll: () => void
  onShowList?: () => void
}) {
  const remaining = summary.count - summary.selected
  return (
    <CardShell onClose={onClose} label="ملخص المنطقة المحددة">
      <div className="flex flex-col gap-0.5 pl-7">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <BoxSelect className="size-4 text-primary" aria-hidden />
          {label}
        </p>
        <p className="text-xs text-muted-foreground">
          {summary.count ? 'القائمة تعرض منشآت هذه المنطقة فقط.' : 'لا توجد نتائج مطابقة داخل المنطقة. جرّب رسم منطقة أوسع.'}
        </p>
      </div>
      {summary.count ? <SummaryBody s={summary} /> : null}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={onSelectAll} disabled={remaining === 0}>
          <CircleCheck data-icon="inline-start" />
          {summary.count === 0 ? 'لا نتائج' : remaining === 0 ? 'كلها محددة' : `تحديد ${formatNumber(remaining)}`}
        </Button>
        {onShowList ? (
          <Button size="sm" variant="outline" className="flex-1 @2xl:hidden" onClick={onShowList} disabled={!summary.count}>
            <List data-icon="inline-start" />
            عرض القائمة
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClear}>
          مسح المنطقة
        </Button>
      </div>
    </CardShell>
  )
}

export function BusinessCard({
  business,
  selected,
  onClose,
  onToggle,
}: {
  business: Business
  selected: boolean
  onClose: () => void
  onToggle: () => void
}) {
  const reasons = (business as Partial<ScoredBusiness>).reasons?.slice(0, 2) ?? []
  const reachable = business.whatsapp && business.consent === 'granted'
  return (
    <CardShell onClose={onClose} label={`بطاقة ${business.name}`}>
      <div className="flex flex-col gap-1 pl-7">
        <p className="text-sm leading-snug font-semibold">{business.name}</p>
        <p className="text-xs text-muted-foreground">
          {business.activity} · {districtById.get(business.districtId)?.name} · {streetById.get(business.streetId)?.name}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Badge variant="secondary">{business.role}</Badge>
          {business.wholesale ? <Badge variant="secondary">جملة</Badge> : null}
          <Badge variant={reachable ? 'outline' : 'secondary'} className={cn(reachable ? 'text-primary' : 'text-muted-foreground')}>
            <MessageCircle />
            {reachable ? 'واتساب بموافقة' : business.whatsapp ? 'واتساب بلا موافقة' : 'بلا واتساب'}
          </Badge>
        </div>
      </div>
      {reasons.length ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
          {formatPhone(business.whatsapp)}
        </span>
        <Button size="sm" variant={selected ? 'outline' : 'default'} onClick={onToggle}>
          {selected ? 'إلغاء التحديد' : 'تحديد'}
        </Button>
      </div>
    </CardShell>
  )
}

function LegendRow({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-2 text-muted-foreground">
      <span className="flex w-5 shrink-0 justify-center">{swatch}</span>
      {label}
    </li>
  )
}

export function MapLegend({
  level,
  open,
  onOpenChange,
  hasArea,
  hasGhosts,
  showStreets,
}: {
  level: MapLevel
  open: boolean
  onOpenChange: (open: boolean) => void
  hasArea: boolean
  hasGhosts: boolean
  showStreets: boolean
}) {
  const title = level === 'districts' ? 'دليل: الأحياء' : level === 'clusters' ? 'دليل: التجمعات' : level === 'streets' ? 'دليل: الشوارع' : 'دليل: المنشآت'
  return (
    <div className="rounded-xl border bg-card/95 text-xs shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 font-semibold"
      >
        {title}
        {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronUp className="size-3.5 text-muted-foreground" />}
      </button>
      {open ? (
        <ul className="flex flex-col gap-1.5 border-t px-3 pt-2 pb-2.5">
          {level === 'districts' ? (
            <>
              <li className="flex flex-col gap-1 pb-0.5">
                <span className="h-2 w-full rounded-full bg-gradient-to-l from-accent to-primary" aria-hidden />
                <span className="flex justify-between text-[10px] text-muted-foreground">
                  <span>تركّز منخفض</span>
                  <span>مرتفع</span>
                </span>
              </li>
              <LegendRow swatch={<span className="size-2.5 rounded-full border-2 border-card bg-primary ring-1 ring-primary" />} label="منشأة محددة" />
              <LegendRow swatch={<span className="size-3 rounded-sm border-2 border-primary" />} label="حي ضمن الفلتر" />
            </>
          ) : null}
          {level === 'clusters' ? (
            <>
              <LegendRow
                swatch={<span className="flex size-4 items-center justify-center rounded-full border-2 border-primary bg-card text-[8px] font-bold text-primary">9</span>}
                label="تجمع منشآت (العدد)"
              />
              <LegendRow swatch={<span className="size-2.5 rounded-full bg-foreground ring-2 ring-card" />} label="يحتوي منشآت محددة" />
              <LegendRow swatch={<span className="size-3 rounded-full border-[2.5px] border-primary bg-card" />} label="منشأة منفردة" />
            </>
          ) : null}
          {level === 'streets' ? (
            <>
              <LegendRow swatch={<span className="h-1.5 w-5 rounded bg-primary" />} label="شارع نشاط" />
              <LegendRow swatch={<span className="size-2.5 rounded-full border-2 border-primary bg-card" />} label="اضغط لعرض الملخص" />
            </>
          ) : null}
          {level === 'entities' ? (
            <>
              <LegendRow swatch={<span className="size-3 rounded-full border-[2.5px] border-primary bg-card" />} label="منشأة" />
              <LegendRow swatch={<span className="size-3.5 rounded-full border-2 border-card bg-primary ring-1 ring-primary" />} label="منشأة محددة" />
              {hasGhosts ? <LegendRow swatch={<span className="size-3 rounded-full border border-muted-foreground bg-card" />} label="مرشح للإضافة" /> : null}
            </>
          ) : null}
          {showStreets && level === 'clusters' ? (
            <LegendRow swatch={<span className="h-1 w-4 rounded bg-primary/60" />} label="شارع نشاط (3+ منشآت)" />
          ) : null}
          {hasArea ? <LegendRow swatch={<span className="size-3 rounded-sm border-2 border-dashed border-primary bg-primary/10" />} label="المنطقة المحددة" /> : null}
        </ul>
      ) : null}
    </div>
  )
}
