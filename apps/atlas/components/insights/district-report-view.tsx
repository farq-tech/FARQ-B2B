'use client'

import { FileText, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { districtName, numberFormat, postMarket, useCities, useDistricts } from '@/lib/insights-api'

type Profile = {
  city: string
  district: string
  population: number | null
  male: number | null
  female: number | null
  saudi_pct: number | null
  ages: { age_group: string; male: number | null; female: number | null; total: number }[]
  businesses: number | null
  whatsapp: number | null
  wholesale: number | null
  main_activities: { main_id: string; main_ar: string; n: number }[]
  growth: { under_construction: number; new_buildings: number; homes_under_construction: number; floor_area_m2: number } | null
  income: { income_all?: number; income_male?: number; income_female?: number; income_saudi?: number; income_non_saudi?: number } | null
  income_source: string | null
  sources: Record<string, string>
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  )
}

// the golden population table labels every district with one of three sources (services/targeting-api/golden.py)
function populationSource(source?: string) {
  if (source?.startsWith('910ths')) return 'المصدر: 910ths'
  if (source === 'farq_buildings_v3') return 'تقدير من المباني'
  return 'تقدير WorldPop 2025'
}

const money = (value?: number) => (value == null ? 'غير متاح' : `${numberFormat.format(value)} ر.س`)

export function DistrictReportView() {
  const cities = useCities()
  const [city, setCity] = useState('Riyadh')
  const features = useDistricts(city)
  const names = useMemo(() => [...new Set(features.map(districtName))].sort((a, b) => a.localeCompare(b, 'ar')), [features])
  const [district, setDistrict] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    const preset = new URLSearchParams(window.location.search)
    if (preset.get('city')) setCity(preset.get('city') as string)
    if (preset.get('district')) setDistrict(preset.get('district') as string)
  }, [])

  useEffect(() => {
    if (!district) { setProfile(null); return }
    setStatus('loading')
    setError('')
    postMarket<Profile>('district-profile', { city, district })
      .then(setProfile)
      .catch((failure) => setError(failure instanceof Error ? failure.message : 'تعذر تحميل التقرير.'))
      .finally(() => setStatus('idle'))
  }, [city, district])

  const people = profile?.male != null && profile?.female != null ? profile.male + profile.female : 0
  const largestAge = Math.max(1, ...(profile?.ages ?? []).map((row) => row.total))
  const cityName = cities.find((c) => c.en === city)?.ar || city

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 pb-24 lg:py-10">
      <header>
        <p className="flex items-center gap-2 text-sm font-semibold text-primary"><FileText className="size-4" aria-hidden /> تقرير الحي</p>
        <h1 className="mt-1 text-2xl font-bold">كل ما نعرفه عن الحي في صفحة واحدة: السكان والمنشآت والنمو والدخل مع مصدر كل رقم</h1>
      </header>
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs font-medium">المدينة
          <select value={city} onChange={(e) => { setCity(e.target.value); setDistrict('') }} className="h-10 rounded-lg border bg-background px-3 text-sm">
            {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium">الحي
          <select value={district} onChange={(e) => setDistrict(e.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm">
            <option value="">اختر حياً</option>
            {names.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </section>
      {status === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> جارٍ إعداد التقرير…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {profile && status === 'idle' && (
        <article className="flex flex-col gap-5">
          <header className="border-b pb-3">
            <p className="text-sm text-muted-foreground">فرق أطلس · تقرير حي · {new Date().toLocaleDateString('ar-SA-u-nu-latn')}</p>
            <h2 className="mt-1 text-3xl font-bold">حي {profile.district} · {cityName}</h2>
          </header>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="السكان" value={profile.population == null ? 'غير متاح' : numberFormat.format(profile.population)} note={populationSource(profile.sources.population)} />
            <Stat label="الجنس" value={people ? `ذكور ${Math.round((100 * (profile.male ?? 0)) / people)}٪` : 'غير متاح'} note={people ? `إناث ${Math.round((100 * (profile.female ?? 0)) / people)}٪ · المصدر: 910ths` : 'لا يوجد قياس لهذا الحي'} />
            <Stat label="المنشآت" value={profile.businesses == null ? 'غير متاح' : numberFormat.format(profile.businesses)} note={profile.population && profile.businesses ? `منشأة لكل ${numberFormat.format(Math.round(profile.population / profile.businesses))} ساكن` : undefined} />
            <Stat label="تحت الإنشاء" value={profile.growth ? numberFormat.format(profile.growth.under_construction) : 'غير متاح'} note={profile.growth ? `منها ${numberFormat.format(profile.growth.homes_under_construction)} سكني · ${numberFormat.format(profile.growth.new_buildings)} مبنى جديد` : undefined} />
            <Stat label="السعوديون" value={profile.saudi_pct == null ? 'غير متاح' : `${Math.round(profile.saudi_pct)}٪`} note={profile.saudi_pct == null ? 'لا يوجد قياس لهذا الحي' : 'من السكان · المصدر: 910ths'} />
            <Stat label="منشآت بواتساب" value={profile.whatsapp == null ? 'غير متاح' : numberFormat.format(profile.whatsapp)} note={profile.whatsapp != null && profile.businesses ? `${Math.round((100 * profile.whatsapp) / profile.businesses)}٪ من المنشآت` : undefined} />
            <Stat label="منشآت جملة" value={profile.wholesale == null ? 'غير متاح' : numberFormat.format(profile.wholesale)} note={profile.wholesale != null && profile.businesses ? `${Math.round((100 * profile.wholesale) / profile.businesses)}٪ من المنشآت` : undefined} />
            <Stat label="مساحة البناء الجاري" value={profile.growth ? `${numberFormat.format(profile.growth.floor_area_m2)} م²` : 'غير متاح'} note={profile.growth ? 'مجموع مساحات الطوابق تحت الإنشاء' : undefined} />
          </section>

          {profile.income && (
            <section>
              <h3 className="mb-2 font-bold">متوسط الدخل الشهري للفرد العامل</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="الكل" value={money(profile.income.income_all)} />
                <Stat label="ذكور" value={money(profile.income.income_male)} />
                <Stat label="إناث" value={money(profile.income.income_female)} />
                <Stat label="سعوديون" value={money(profile.income.income_saudi)} />
                <Stat label="غير سعوديين" value={money(profile.income.income_non_saudi)} />
              </div>
            </section>
          )}

          {profile.ages.length > 0 && (
            <section>
              <h3 className="mb-2 font-bold">الهرم العمري</h3>
              <div className="flex flex-col gap-1 text-xs">
                {profile.ages.map((row) => (
                  <div key={row.age_group} className="flex items-center gap-2">
                    <span className="w-12 text-muted-foreground">{row.age_group}</span>
                    <div className="flex h-3 flex-1 overflow-hidden rounded bg-muted">
                      {row.male == null || row.female == null
                        ? <span className="h-full bg-muted-foreground/40" style={{ width: `${(100 * row.total) / largestAge}%` }} />
                        : <>
                          <span className="h-full bg-sky-500" style={{ width: `${(100 * row.male) / largestAge}%` }} />
                          <span className="h-full bg-pink-500" style={{ width: `${(100 * row.female) / largestAge}%` }} />
                        </>}
                    </div>
                    <span className="w-14 text-end">{numberFormat.format(row.total)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground"><span className="text-sky-500">■</span> ذكور <span className="text-pink-500">■</span> إناث</p>
            </section>
          )}

          {profile.main_activities.length > 0 && (
            <section>
              <h3 className="mb-2 font-bold">كل الأنشطة الرئيسية في الحي</h3>
              <table className="w-full text-sm">
                <tbody>
                  {profile.main_activities.map((row) => (
                    <tr key={row.main_id} className="border-t">
                      <td className="py-1.5">{row.main_ar}</td>
                      <td className="py-1.5 text-end font-semibold">{numberFormat.format(row.n)}</td>
                      <td className="py-1.5 text-end text-xs text-muted-foreground">{profile.population ? `ساكن لكل منشأة ${numberFormat.format(Math.round(profile.population / row.n))}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

        </article>
      )}
    </main>
  )
}
