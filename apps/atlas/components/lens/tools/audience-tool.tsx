'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Explained } from '@/components/shared/explained'
import { EXPLAIN } from '@/lib/explanations'
import { numberFormat, postMarket } from '@/lib/insights-api'
import { cn } from '@/lib/utils'
import type { DistrictRow } from '../city-data'
import { SHADES } from '../lens-map-canvas'
import type { Overlay } from './overlay'

type Mode = 'people' | 'businesses'
type Sex = 'all' | 'men' | 'women'
type Nationality = 'all' | 'saudi' | 'non_saudi'
type Share = { district_ar: string; male_pct: number; saudi_pct: number }
type Activity = { main_id: string; main_ar: string }
type Count = { district_ar: string; n: number; n_whatsapp?: number }
type Scored = { row: DistrictRow; size: number; score: number }

const INCOMES = [0, 8000, 12000, 16000]
const show = (value: number) => numberFormat.format(Math.round(value))

function Choice<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((option) => (
        <button key={String(option.id)} onClick={() => onChange(option.id)} aria-pressed={value === option.id}
          className={cn('flex-1 rounded-lg border py-2 text-sm', value === option.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Rank districts 0–100 by the audience in each, shade the map by it, and keep a district whose figure is unknown out. */
function score(rows: DistrictRow[], size: (row: DistrictRow) => number | null): { scored: Scored[]; unknown: number } {
  const known = rows.map((row) => ({ row, size: size(row) })).filter((item): item is { row: DistrictRow; size: number } => item.size != null)
  const largest = Math.max(0, ...known.map((item) => item.size))
  const scored = known
    .map((item) => ({ ...item, score: largest > 0 ? Math.round((100 * item.size) / largest) : 0 }))
    .sort((a, b) => b.size - a.size)
  return { scored, unknown: rows.length - known.length }
}

/**
 * «أين جمهوري؟» for marketers (docs/atlas-product-foundation.md §3.2). A consumer marketer filters people by sex,
 * nationality and income; a business marketer filters businesses by activity and WhatsApp reach. The map turns into
 * the best-matching districts and the card gives the audience size in the selected districts, or the whole city.
 */
export function AudienceTool({ city, rows, selected, onOverlay, onSelect }: {
  city: string
  rows: DistrictRow[]
  selected: DistrictRow[]
  onOverlay: (overlay: Overlay) => void
  onSelect: (id: string) => void
}) {
  const [mode, setMode] = useState<Mode>('people')
  const [sex, setSex] = useState<Sex>('all')
  const [nationality, setNationality] = useState<Nationality>('all')
  const [minIncome, setMinIncome] = useState(0)
  const [shares, setShares] = useState<Map<string, Share> | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [mainId, setMainId] = useState('')
  const [whatsappOnly, setWhatsappOnly] = useState(true)
  const [counts, setCounts] = useState<Map<string, Count> | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    setShares(null)
    postMarket<{ districts?: Share[] }>('district-audience', { city })
      .then((data) => setShares(new Map((data.districts ?? []).map((row) => [row.district_ar, row]))))
      .catch(() => setShares(new Map()))
    postMarket<{ summary?: { main_activities?: Activity[] } }>('market-summary', { city })
      .then((data) => setActivities(data.summary?.main_activities ?? []))
      .catch(() => setActivities([]))
  }, [city])

  useEffect(() => {
    if (mode !== 'businesses') return
    let active = true
    setStatus('loading')
    postMarket<{ districts?: Count[] }>('district-counts', { city, ...(mainId ? { main_id: mainId } : {}) })
      .then((data) => { if (active) { setCounts(new Map((data.districts ?? []).map((row) => [row.district_ar, row]))); setStatus('idle') } })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [city, mode, mainId])

  const { scored, unknown } = useMemo(() => {
    if (mode === 'businesses') {
      return score(rows, (row) => {
        const count = counts?.get(row.name)
        if (!counts) return null
        return count ? (whatsappOnly ? count.n_whatsapp ?? null : count.n) : 0
      })
    }
    return score(rows, (row) => {
      if (row.population == null) return null
      if (minIncome > 0 && row.income == null) return null   // no measured income: unknown, not excluded as poor
      if (minIncome > 0 && row.income! < minIncome) return 0
      const share = shares?.get(row.name)
      const needsShare = sex !== 'all' || nationality !== 'all'
      if (needsShare && !share) return null
      const sexShare = sex === 'all' ? 1 : (sex === 'men' ? share!.male_pct : 100 - share!.male_pct) / 100
      const nationalityShare = nationality === 'all' ? 1 : (nationality === 'saudi' ? share!.saudi_pct : 100 - share!.saudi_pct) / 100
      return row.population * sexShare * nationalityShare
    })
  }, [mode, rows, counts, whatsappOnly, shares, sex, nationality, minIncome])

  useEffect(() => {
    const colors = new Map<string, string>()
    for (const item of scored) colors.set(item.row.id, item.score > 0 ? SHADES[Math.min(4, Math.floor(item.score / 20))] : '#3f3f46')
    onOverlay({ colors })
  }, [scored, onOverlay])

  const scope = selected.length ? scored.filter((item) => selected.some((row) => row.id === item.row.id)) : scored
  const total = scope.reduce((sum, item) => sum + item.size, 0)
  const unit = mode === 'people' ? 'شخص' : 'منشأة'
  const explain = mode === 'people' ? EXPLAIN.audiencePeople(sex !== 'all' || nationality !== 'all', minIncome) : EXPLAIN.audienceBusinesses(whatsappOnly)

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="text-xl font-bold">أين جمهوري؟</h2>
      <Choice value={mode} onChange={setMode} options={[{ id: 'people', label: 'أستهدف أفراداً' }, { id: 'businesses', label: 'أستهدف منشآت' }]} />
      {mode === 'people' ? (
        <>
          <Choice value={sex} onChange={setSex} options={[{ id: 'all', label: 'الكل' }, { id: 'men', label: 'رجال' }, { id: 'women', label: 'نساء' }]} />
          <Choice value={nationality} onChange={setNationality} options={[{ id: 'all', label: 'كل الجنسيات' }, { id: 'saudi', label: 'سعوديون' }, { id: 'non_saudi', label: 'غير سعوديين' }]} />
          <div>
            <p className="mb-1 text-sm text-muted-foreground">متوسط دخل الحي الشهري</p>
            <Choice value={minIncome} onChange={setMinIncome} options={INCOMES.map((value) => ({ id: value, label: value ? `${numberFormat.format(value)}+` : 'أي دخل' }))} />
          </div>
        </>
      ) : (
        <>
          <select value={mainId} onChange={(event) => setMainId(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-base">
            <option value="">كل الأنشطة</option>
            {activities.map((activity) => <option key={activity.main_id} value={activity.main_id}>{activity.main_ar}</option>)}
          </select>
          <label className="flex items-center gap-2 text-base">
            <input type="checkbox" checked={whatsappOnly} onChange={(event) => setWhatsappOnly(event.target.checked)} className="size-4 accent-[#25c99a]" />
            التي يمكن الوصول لها بواتساب فقط
          </label>
        </>
      )}
      {status === 'loading' && <Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ الحساب" />}
      {status === 'error' && <p role="alert" className="text-base text-destructive">تعذر الحساب.</p>}
      {status !== 'loading' && (
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">حجم الجمهور {selected.length ? `في ${numberFormat.format(selected.length)} أحياء محددة` : 'في المدينة'}</p>
          <Explained title="حجم الجمهور" lines={[...explain, ...(unknown ? [`${numberFormat.format(unknown)} حياً بلا رقم مقاس فلم تُحسب، وتظهر بلا لون.`] : [])]} className="mt-0.5 text-xl font-bold">
            {scope.length ? `${show(total)} ${unit}` : 'غير متاح'}
          </Explained>
        </div>
      )}
      {scored.length > 0 && status !== 'loading' && (
        <div>
          <Explained title="درجة الحي" lines={EXPLAIN.audienceScore} className="mb-1 text-sm font-semibold text-muted-foreground">أعلى الأحياء مطابقةً</Explained>
          <ol className="divide-y text-base">
            {scored.slice(0, 10).map((item) => (
              <li key={item.row.id}>
                <button onClick={() => onSelect(item.row.id)} className="flex w-full items-center justify-between py-2 text-start hover:text-primary">
                  <span className="font-medium">{item.row.name}</span>
                  <span className="text-sm text-muted-foreground">{show(item.size)} {unit} · <span className="font-bold text-foreground">{numberFormat.format(item.score)}</span>/100</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
