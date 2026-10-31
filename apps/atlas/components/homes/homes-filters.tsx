'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { numberFormat } from '@/lib/insights-api'
import { FEATURES, LISTING_TYPES, PERIOD_WORD, RENT_DEALS, TENANTS_LABEL } from '@/lib/real-estate'
import { AGE_STEPS, COUNT_STEPS, DEFAULT_FILTERS, SORTS, STREET_STEPS, ageStepLabel, dealOf, offersLabel, type HomeFilters } from '@/lib/real-estate-filters'
import { cn } from '@/lib/utils'

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b py-4 last:border-b-0">
      <div>
        <h3 className="text-base font-bold">{title}</h3>
        {hint && <p className="text-xs leading-6 text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** A number box that is empty for «any», never 0. */
function NumberBox({ label, value, onChange, unit }: { label: string; value: number | null; onChange: (value: number | null) => void; unit: string }) {
  return (
    <label className="flex flex-1 flex-col gap-1 rounded-xl border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring/60">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <input type="text" inputMode="numeric" dir="ltr" placeholder="أي" value={value == null ? '' : numberFormat.format(value)}
          onChange={(event) => { const digits = event.target.value.replace(/[^0-9]/g, ''); onChange(digits ? Number(digits) : null) }}
          className="w-full min-w-0 bg-transparent text-end text-base font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground" />
        <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>
      </span>
    </label>
  )
}

function Steps({ steps, value, onChange, label }: { steps: number[]; value: number; onChange: (value: number) => void; label: (step: number) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((step) => <Chip key={step} active={value === step} onClick={() => onChange(step)}>{step ? label(step) : 'أي'}</Chip>)}
    </div>
  )
}

/**
 * Every filter of «العقار» in one sheet: from the bottom on a phone, from the side on a wide screen. Each change applies
 * at once, so the button at the bottom always says how many listings are left.
 */
export function HomesFilters({ open, onClose, filters, onChange, districts, count, loading, cities, city, onCity }: {
  open: boolean
  cities: readonly (readonly [string, string])[]
  city: string
  onCity: (city: string) => void
  onClose: () => void
  filters: HomeFilters
  onChange: (next: Partial<HomeFilters>) => void
  /** The city's districts, by name. */
  districts: { id: string; name: string }[]
  count: number
  loading: boolean
}) {
  const [query, setQuery] = useState('')
  const deal = dealOf(filters)
  const period = PERIOD_WORD[deal] ? ` ${PERIOD_WORD[deal]}` : ''
  const types = LISTING_TYPES.filter((item) => item.kinds.includes(filters.kind))
  const chosen = new Set(filters.districts)
  const shownDistricts = useMemo(() => {
    const text = query.trim()
    const list = text ? districts.filter((item) => item.name.includes(text)) : districts
    // the chosen ones first, then by name
    return [...list].sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.name.localeCompare(b.name, 'ar'))
  }, [districts, query, filters.districts])
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item])
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 64rem)').matches

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side={wide ? 'right' : 'bottom'} dir="rtl"
        className={cn('gap-0 p-0', wide ? 'w-full sm:max-w-[28rem]' : 'max-h-[92dvh] rounded-t-3xl')}>
        <SheetHeader className="border-b px-5 py-4 pe-12 text-start">
          <SheetTitle>الفلاتر</SheetTitle>
          <SheetDescription>كل تغيير يُطبَّق فوراً.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <Section title="المدينة">
            <div className="flex flex-wrap gap-2">
              {cities.map(([id, label]) => <Chip key={id} active={city === id} onClick={() => onCity(id)}>{label}</Chip>)}
            </div>
          </Section>

          <Section title="إيجار أو شراء">
            <div className="flex flex-wrap gap-2">
              {RENT_DEALS.map((item) => (
                <Chip key={item.id} active={filters.kind === 'rent' && filters.rentDeal === item.id} onClick={() => onChange({ kind: 'rent', rentDeal: item.id })}>إيجار {item.label}</Chip>
              ))}
              <Chip active={filters.kind === 'sale'} onClick={() => onChange({ kind: 'sale' })}>شراء</Chip>
            </div>
          </Section>

          <Section title="نوع العقار" hint="اختر نوعاً أو أكثر.">
            <div className="flex flex-wrap gap-2">
              {types.map((item) => (
                <Chip key={item.id} active={filters.types.includes(item.id)}
                  onClick={() => { const next = toggle(filters.types, item.id); onChange({ types: next.length ? next : filters.types }) }}>{item.label}</Chip>
              ))}
            </div>
          </Section>

          <Section title="الحي" hint={filters.districts.length ? `${numberFormat.format(filters.districts.length)} مختارة` : 'كل الأحياء. اختر حياً أو أكثر.'}>
            <label className="flex h-11 items-center gap-2 rounded-xl border bg-card px-3 focus-within:ring-2 focus-within:ring-ring/60">
              <Search className="size-4 text-muted-foreground" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن حي" aria-label="ابحث عن حي"
                className="w-full min-w-0 bg-transparent text-sm outline-none" />
            </label>
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {shownDistricts.map((item) => (
                <Chip key={item.id} active={chosen.has(item.id)} onClick={() => onChange({ districts: toggle(filters.districts, item.id) })}>{item.name}</Chip>
              ))}
              {!shownDistricts.length && <p className="text-sm text-muted-foreground">{districts.length ? 'لا حي بهذا الاسم.' : 'أحياء المدينة غير متاحة الآن.'}</p>}
            </div>
          </Section>

          <Section title="السعر" hint={`كما في الإعلان${period}.`}>
            <div className="flex gap-3">
              <NumberBox label="من" value={filters.minPrice} onChange={(value) => onChange({ minPrice: value })} unit="ريال" />
              <NumberBox label="إلى" value={filters.maxPrice} onChange={(value) => onChange({ maxPrice: value })} unit="ريال" />
            </div>
          </Section>

          <Section title="المساحة">
            <div className="flex gap-3">
              <NumberBox label="من" value={filters.minArea} onChange={(value) => onChange({ minArea: value })} unit="م²" />
              <NumberBox label="إلى" value={filters.maxArea} onChange={(value) => onChange({ maxArea: value })} unit="م²" />
            </div>
          </Section>

          <Section title="الغرف">
            <Steps steps={COUNT_STEPS} value={filters.beds} onChange={(beds) => onChange({ beds })} label={(step) => `${numberFormat.format(step)}+`} />
          </Section>
          <Section title="الصالات">
            <Steps steps={COUNT_STEPS.slice(0, 4)} value={filters.livings} onChange={(livings) => onChange({ livings })} label={(step) => `${numberFormat.format(step)}+`} />
          </Section>
          <Section title="دورات المياه">
            <Steps steps={COUNT_STEPS.slice(0, 5)} value={filters.wc} onChange={(wc) => onChange({ wc })} label={(step) => `${numberFormat.format(step)}+`} />
          </Section>
          <Section title="عرض الشارع">
            <Steps steps={STREET_STEPS} value={filters.street} onChange={(street) => onChange({ street })} label={(step) => `${numberFormat.format(step)} م فأكثر`} />
          </Section>

          <Section title="عمر العقار" hint="كما ذكره الإعلان. إذا اخترت عمراً لا تظهر الإعلانات التي لا تذكر عمر العقار.">
            <div className="flex flex-wrap gap-2">
              {AGE_STEPS.map((step) => <Chip key={String(step)} active={filters.maxAge === step} onClick={() => onChange({ maxAge: step })}>{ageStepLabel(step)}</Chip>)}
            </div>
          </Section>

          {filters.kind === 'rent' && (
            <Section title="السكن" hint="كما ذكره الإعلان. العرض المفتوح للعوائل والعزاب يظهر في الاختيارين، والإعلان الذي لا يذكر ذلك لا يظهر.">
              <div className="flex flex-wrap gap-2">
                <Chip active={filters.tenants == null} onClick={() => onChange({ tenants: null })}>الكل</Chip>
                <Chip active={filters.tenants === 'families'} onClick={() => onChange({ tenants: 'families' })}>{TENANTS_LABEL.families}</Chip>
                <Chip active={filters.tenants === 'singles'} onClick={() => onChange({ tenants: 'singles' })}>{TENANTS_LABEL.singles}</Chip>
              </div>
            </Section>
          )}

          <Section title="يجب أن يتوفر" hint="كما سجّله المعلن في إعلانه. الإعلان الذي لا يذكر الميزة لا يظهر.">
            <div className="flex flex-wrap gap-2">
              {FEATURES.map(([key, label]) => {
                const on = filters.features.includes(key)
                return <Chip key={key} active={on} onClick={() => onChange({ features: on ? filters.features.filter((item) => item !== key) : [...filters.features, key] })}>{label}</Chip>
              })}
            </div>
          </Section>

          <Section title="مقارنة بالحي" hint="سعر المتر أقل من الوسيط: نصف عروض الحي المماثلة أرخص منه ونصفها أغلى.">
            <div className="flex flex-wrap gap-2">
              <Chip active={filters.belowMedian} onClick={() => onChange({ belowMedian: !filters.belowMedian })}>أقل من وسيط الحي</Chip>
            </div>
          </Section>

          <Section title="الترتيب">
            <div className="flex flex-wrap gap-2">
              {SORTS.map((item) => <Chip key={item.id} active={filters.sort === item.id} onClick={() => onChange({ sort: item.id })}>{item.label}</Chip>)}
            </div>
          </Section>
        </div>
        <SheetFooter className="flex-row items-center justify-between gap-3 border-t px-5 py-3">
          <Button variant="ghost" onClick={() => onChange({ ...DEFAULT_FILTERS, kind: filters.kind, rentDeal: filters.rentDeal, types: filters.types.slice(0, 1) })}>مسح الكل</Button>
          <Button onClick={onClose} className="h-11 rounded-full px-6">{loading ? 'جارٍ التحميل…' : count ? `اعرض ${offersLabel(count)}` : 'لا عروض بهذه الفلاتر'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
