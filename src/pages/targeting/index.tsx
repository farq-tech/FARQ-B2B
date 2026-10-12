import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { listCities, searchTargets, templateStatus, type City, waNumber, TargetingError, OUTREACH_TEMPLATE, type TargetRow, type TargetSearch, type TemplateStatus } from '../../api/targetingClient'
import { Badge, Button, ChannelBadge, Icon, Stat, useIsMobile, type Channel } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'
import TargetMap from './TargetMap'
import { readBooklet, type BookletLine } from '../../lib/readBooklet'

// Mapbox when the build has a public token (VITE_MAPBOX_TOKEN), else the drawn map; loaded on its own.
const HAS_MAPBOX = Boolean(import.meta.env.VITE_MAPBOX_TOKEN)
const MapboxMap = lazy(() => import('./MapboxMap'))
function MapView(props: Parameters<typeof TargetMap>[0]) {
  if (!HAS_MAPBOX) return <TargetMap {...props} />
  return (
    <Suspense fallback={null}>
      <MapboxMap {...props} />
      {props.legend === false ? null : (
        <div className="pointer-events-none absolute end-4 top-4 flex items-center gap-3 rounded-full bg-[var(--color-bg-inverse)]/80 px-3 py-2 text-[12px] leading-[18px] font-medium text-[var(--color-text-on-inverse)]">
          {[['واتساب', 'var(--brand-accent)'], ['إيميل', 'var(--brand-action-light)'], ['لا يمكن', 'var(--brand-text-3)']].map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c }} />{l}</span>
          ))}
        </div>
      )}
    </Suspense>
  )
}
import CampaignConfirmSheet from './CampaignConfirmSheet'

/*
 * «07 · الاستهداف» — Figma 51:2, on the targeting service's own data (POST /search over the
 * KSA places set). «10 · تأكيد إرسال الحملة» (54:607) opens in place from «أرسل الحملة».
 *
 * Only real numbers: the four counters, the results and the map come from the search answer.
 * Figma's «طلبوا الإيقاف» count and the batch pace are not in the service, so they are not shown.
 * The campaign is the approved WhatsApp template; only places with a valid mobile can be chosen.
 */

/** Per-message estimate the previous tool showed the owner (paid marketing template). */
const COST_PER_MESSAGE = 0.17
const PAGE = 150

export const channelOf = (r: TargetRow): Channel => (waNumber(r) ? 'WhatsApp' : r.email ? 'Email' : 'Unreachable')
const nameOf = (r: TargetRow) => r.name_ar || r.name_en || 'بدون اسم'
const placeOf = (r: TargetRow) => [r.district_ar || r.district_en, r.region_ar || r.city_en].filter(Boolean).join(' · ')
const n = (v: number) => v.toLocaleString('en-US')
const CITY_KEY = 'farq.targeting.city'
/** «حدد المناسبين»: AI-likely places with WhatsApp; without an AI check, everyone with WhatsApp. */
const pickBest = (rows: TargetRow[]) => {
  const ai = rows.some((r) => r.ai)
  return new Set(rows.filter((r) => waNumber(r) && (!ai || r.ai === 'L')).map((r) => r.poi_key))
}
const rowSub = (r: TargetRow) => [r.reason || null, r.target_role === 'buyer' ? 'مشتري محتمل' : null, r.sources?.includes('farq_supplier') ? 'مورد في فرق' : null, r.target_role === 'buyer' ? null : r.match === 'seller' ? 'يبيعه غالبًا' : r.match === 'product' ? 'يذكر المنتج' : null, placeOf(r)].filter(Boolean).join(' · ') || '—'
const FIT = { L: { tone: 'Success', label: 'مناسب' }, M: { tone: 'Warning', label: 'محتمل' }, N: { tone: 'Neutral', label: 'غير مناسب' } } as const
const fitBadge = (r: TargetRow) => (r.ai ? <Badge tone={FIT[r.ai].tone} showDot={false} label={FIT[r.ai].label} className="text-[12px] leading-[18px]" /> : null)
const arabic = (s: string) => /[؀-ۿ]/.test(s)

function defaultMessage(cat: string | null, area: string | null) {
  return `معك أحمد من فرق. يوصلنا طلبات تسعير${cat ? ` ${cat}` : ''} من منشآت وشركات${area ? ` في ${area}` : ''} — تبي توصلك على واتساب؟\nللإيقاف أرسل: إيقاف`
}

export default function TargetingPage({ onTemplates }: { onTemplates: () => void }) {
  const mobile = useIsMobile()
  const [objective, setObjective] = useState<'purchase' | 'marketing'>(() => { try { return sessionStorage.getItem('farq-target-direction') === 'marketing' ? 'marketing' : 'purchase' } catch { return 'purchase' } })
  const generation = useRef(0)
  const direction = <fieldset className="flex gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] p-2" aria-label="من تبحث عنه؟">
    {([{ value: 'purchase', label: 'بائعون — أبي أشتري' }, { value: 'marketing', label: 'مشترون — أبي أبيع' }] as const).map(option => <label key={option.value} className="flex flex-1 items-center gap-2 text-[14px]">
      <input type="radio" name="target-direction" checked={objective === option.value} onChange={() => { generation.current++; setObjective(option.value); setRes(null); setSelected(new Set()); setLines(ls => ls.map(({ found: _found, ...line }) => line)); setActiveLine(null); setError(null); setConfirming(false); setComposeOpen(false) }} />{option.label}
    </label>)}
  </fieldset>
  const [q, setQ] = useState(() => { try { return sessionStorage.getItem('farq-target-query') || '' } catch { return '' } })
  useEffect(() => { try { sessionStorage.removeItem('farq-target-query') } catch { /* optional handoff */ } }, [])
  const [query, setQuery] = useState('')
  const [res, setRes] = useState<TargetSearch | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(PAGE)
  const [message, setMessage] = useState(defaultMessage(null, null))
  const [tpl, setTpl] = useState<TemplateStatus | null>(null)
  const [tplError, setTplError] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  // a booklet turned into lines: tap a line to search for it in the chosen city
  const fileInput = useRef<HTMLInputElement>(null)
  const [lines, setLines] = useState<(BookletLine & { found?: number })[]>([])
  const [booklet, setBooklet] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [readErr, setReadErr] = useState<string | null>(null)
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const list = useRef<HTMLUListElement>(null)
  // the city is required: the search runs inside one city only
  const [cities, setCities] = useState<City[]>([])
  const [city, setCity] = useState(() => { try { return localStorage.getItem(CITY_KEY) || '' } catch { return '' } })
  const pickCity = (v: string) => { generation.current++; setCity(v); setError(null); setRes(null); setSelected(new Set()); setActiveLine(null); setLines(ls => ls.map(({ found: _found, ...line }) => line)); try { localStorage.setItem(CITY_KEY, v) } catch { /* storage blocked */ } }

  useEffect(() => { templateStatus().then(setTpl, () => setTplError(true)) }, [])
  useEffect(() => {
    let active = true
    listCities().then(values => {
      if (!active) return
      setCities(values)
      setCity(saved => values.some(value => value.en === saved) ? saved : '')
    }, () => { if (active) setCities([]) })
    return () => { active = false }
  }, [])
  const cityName = (en: string) => cities.find((c) => c.en === en)?.ar || en

  const rows = useMemo(() => res?.rows || [], [res])
  const counts = useMemo(() => {
    let wa = 0, emailOnly = 0, none = 0
    for (const r of rows) { const c = channelOf(r); if (c === 'WhatsApp') wa++; else if (c === 'Email') emailOnly++; else none++ }
    return { wa, emailOnly, none }
  }, [rows])
  const truncated = res ? rows.length < res.total : false
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.poi_key)), [rows, selected])
  const hasAi = Boolean(res?.ai_checked)
  const citySelect = (cls: string) => (
    <>
      <label className="sr-only" htmlFor="targeting-city">المدينة</label>
      <select id="targeting-city" required value={cities.some(value => value.en === city) ? city : ''} onChange={(e) => pickCity(e.target.value)} aria-invalid={!city}
        className={`shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2 py-1.5 ${city ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'} ${FOCUS_RING} ${cls}`}>
        <option value="">اختر المدينة</option>
        {cities.map((c) => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}
      </select>
    </>
  )

  const chips = useMemo(() => {
    if (!res) return []
    const p = res.parsed || {}
    const cat = (p.keywords || []).filter(arabic)[0] || ''
    const area = p.city ? cityName(p.city) : null
    return [cat ? `المنتج: ${cat}` : null, p.seller_label ? `الجهات المناسبة: ${p.seller_label}` : null, area ? `المدينة: ${area}` : null].filter(Boolean) as string[]
  }, [res, cities])

  async function search(e?: FormEvent) {
    e?.preventDefault()
    setActiveLine(null)
    await runSearch(q.trim())
  }
  async function searchLine(i: number) {
    if (!city || !cities.some(value => value.en === city)) { setError('اختر مدينة البحث من القائمة.'); return }
    setActiveLine(i); setQ(lines[i].name)
    const found = await runSearch(lines[i].name)
    if (found != null) setLines((ls) => ls.map((l, k) => (k === i ? { ...l, found } : l)))
  }
  async function onBooklet(files: File[]) {
    if (!files.length) return
    setReadErr(null); setReading('بدأنا القراءة…')
    try {
      const read = await readBooklet(files, setReading)
      if (!read.length) throw new Error('ما لقينا منتجات أو خدمات في الملف. ارفع قائمة احتياجات أو كتالوجًا واضحًا.')
      setLines(read); setBooklet(files.length > 1 ? `${files.length} ملفات` : files[0].name); setActiveLine(null)
    } catch (err) {
      setReadErr(err instanceof Error ? err.message : 'تعذّرت قراءة الملف.')
    } finally { setReading(null); if (fileInput.current) fileInput.current.value = '' }
  }
  async function runSearch(text: string): Promise<number | null> {
    if (!text || !city || busy) return null
    setBusy(true); setError(null); setNotice(null)
    const version = generation.current
    try {
      const r = await searchTargets(text, city, 10, objective)
      if (version !== generation.current) return null
      setRes(r); setQuery(text); setShown(PAGE)
      setSelected(new Set())
      const p = r.parsed || {}
      const cat = (p.keywords || []).filter(arabic)[0] || null
      setMessage(defaultMessage(cat, cityName(city)))
      return r.total
    } catch (err) {
      if (version !== generation.current) return null
      setError(err instanceof TargetingError ? err.message : 'تعذّر البحث. تأكد من الاتصال وحاول مرة ثانية.')
      return null
    } finally { setBusy(false) }
  }

  const fileField = (
    <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden
      accept=".pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*"
      onChange={(e) => void onBooklet([...(e.target.files || [])])} />
  )
  const uploadButton = (label: string, variant: 'Secondary' | 'Ghost') => (
    <Button variant={variant} size="S" icon="upload" disabled={Boolean(reading)} loading={Boolean(reading)} loadingLabel="نقرأ…" onClick={() => fileInput.current?.click()}>{label}</Button>
  )
  const linesPanel = (row: boolean) => (reading || readErr || lines.length) ? (
    <section aria-label="منتجات وخدمات الملف" className="flex flex-col gap-2">
      {reading ? <p role="status" className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{reading}</p> : null}
      {readErr ? <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">{readErr}</p> : null}
      {lines.length ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-[14px] leading-[22px] font-medium ${row ? 'text-[var(--color-text-on-inverse)]' : ''}`}>عناصر الملف ({n(lines.length)}){booklet ? <span className={row ? 'text-[var(--color-text-on-inverse-secondary)]' : 'text-[var(--color-text-tertiary)]'}> · <bdi>{booklet}</bdi></span> : null}</p>
            <button type="button" onClick={() => { setLines([]); setBooklet(null); setActiveLine(null) }} className={`text-[12px] leading-[18px] ${row ? 'text-[var(--color-text-on-inverse-secondary)]' : 'text-[var(--color-text-tertiary)]'} hover:underline ${FOCUS_RING}`}>إزالة</button>
          </div>
          <ul className={row ? '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1' : 'flex max-h-[112px] flex-wrap gap-2 overflow-y-auto'}>
            {lines.map((l, i) => (
              <li key={i} className="shrink-0">
                <button type="button" onClick={() => void searchLine(i)} disabled={busy} aria-pressed={activeLine === i} title={l.name}
                  className={`flex max-w-[280px] items-center gap-2 rounded-full border px-3 py-1.5 text-start text-[14px] leading-[22px] disabled:opacity-60 ${activeLine === i ? 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-text-info)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)] hover:border-[var(--color-border-strong)]'} ${FOCUS_RING}`}>
                  <span className="truncate">{l.name}</span>
                  {l.qty ? <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{l.qty} {l.unit}</span> : null}
                  {l.found != null ? <span className="shrink-0 rounded-full bg-[var(--color-bg-success)] px-1.5 text-[12px] text-[var(--color-text-success)]">{n(l.found)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  ) : null

  const toggle = (r: TargetRow) => {
    if (!waNumber(r)) return
    setSelected((s) => { const x = new Set(s); if (x.has(r.poi_key)) x.delete(r.poi_key); else x.add(r.poi_key); return x })
  }
  const focusRow = (key: string) => {
    const i = rows.findIndex((r) => r.poi_key === key)
    if (i < 0) return
    if (i >= shown) setShown(i + 1)
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const approved = tpl?.status === 'APPROVED'
  const holder = tpl?.holder?.holder_rfq_id || null
  const sendBlock = objective === 'marketing' ? 'اكتشاف المشترين فقط؛ الإرسال غير مفعّل لهذا المسار' : !res ? 'ابحث أولًا' : !chosen.length ? 'حدد جهة وحدة على الأقل' : !message.trim() ? 'اكتب نص الرسالة' : tplError ? 'تعذّر التحقق من حالة القالب' : !tpl ? 'جارٍ التحقق من القالب…' : !approved ? `القالب ${OUTREACH_TEMPLATE} غير معتمد من Meta (${tpl.status})` : !holder ? 'ما فيه طلب حاضن للردود' : null
  const cost = (chosen.length * COST_PER_MESSAGE).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const compose = (
    <section aria-labelledby="campaign-title" className={`flex flex-col gap-3 rounded-[var(--radius-xl)] bg-[var(--color-bg-surface)] p-5 text-start shadow-[var(--elevation-lg)] ${mobile ? 'w-full' : 'w-[520px] max-w-[calc(100%-48px)]'}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="campaign-title" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">رسالة الحملة</h2>
        {approved ? <Badge tone="Success" showDot={false} label="قالب واتساب معتمد" /> : tpl ? <Badge tone="Warning" showDot={false} label={`القالب: ${tpl.status}`} /> : tplError ? <Badge tone="Danger" showDot={false} label="حالة القالب غير معروفة" /> : null}
      </div>
      <label className="flex flex-col rounded-[var(--radius-lg)] bg-[var(--color-bg-surface-2)] px-3.5 py-3 focus-within:outline-2 focus-within:outline-solid focus-within:outline-[var(--color-border-primary)]">
        <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">السلام عليكم {'{اسم المحل}'}،</span>
        <span className="sr-only">نص الرسالة</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={900}
          className="w-full resize-none bg-transparent text-[16px] leading-[26px] text-[var(--color-text-primary)] outline-none" />
      </label>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[16px] leading-[26px] font-medium">بيوصل لـ {n(chosen.length)} جهة</p>
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">
            {res ? `${n(counts.wa)} عندهم واتساب · التكلفة التقديرية ≈ ${cost} ر.س` : 'ابحث عن الجهات أولًا'}
          </p>
        </div>
        <Button variant="Primary" size="M" icon="send" disabled={Boolean(sendBlock)} title={sendBlock || undefined} onClick={() => setConfirming(true)}>أرسل الحملة</Button>
      </div>
      {sendBlock && res ? <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{sendBlock}</p> : null}
      {notice ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-success)]">{notice}</p> : null}
    </section>
  )

  const results = (
    <section aria-labelledby="results-title" className={`flex min-h-0 flex-col bg-[var(--color-bg-surface)] ${mobile ? 'w-full border-t' : 'h-full w-[380px] shrink-0 border-e'} border-[var(--color-border-default)]`}>
      <div className="flex items-baseline justify-between gap-2 px-5 py-4">
        <h2 id="results-title" className="flex items-baseline gap-2">
          <span className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">النتائج</span>
          {res ? <span className="text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)]">{n(res.total)}</span> : null}
        </h2>
        {res && counts.wa ? (
          <button type="button" className={`text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] hover:underline ${FOCUS_RING}`}
            onClick={() => setSelected(chosen.length ? new Set() : pickBest(rows))}>
            {chosen.length ? 'إلغاء التحديد' : hasAi ? 'حدد المناسبين' : 'حدد اللي عندهم واتساب'}
          </button>
        ) : null}
      </div>
      {!res ? (
        <p className="border-t border-[var(--color-border-default)] px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">{busy ? 'جارٍ البحث…' : 'اكتب وش تبي توصل له (نشاط ومدينة) واضغط ابحث.'}</p>
      ) : !rows.length ? (
        <p className="border-t border-[var(--color-border-default)] px-5 py-6 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">ما لقينا جهات بهذا الوصف. جرّب كلمة ثانية أو مدينة أوسع.</p>
      ) : (
        <ul ref={list} className={`${mobile ? 'max-h-[60dvh]' : 'min-h-0 flex-1'} overflow-y-auto`}>
          {rows.slice(0, shown).map((r) => {
            const ch = channelOf(r)
            const on = selected.has(r.poi_key)
            const can = ch === 'WhatsApp'
            return (
              <li key={r.poi_key} data-key={r.poi_key} className="border-t border-[var(--color-border-default)]">
                <label className={`flex items-center gap-3 px-5 py-3.5 ${can ? 'cursor-pointer hover:bg-[var(--color-bg-surface-2)]' : ''}`} title={can ? undefined : ch === 'Email' ? 'الحملة على واتساب فقط' : 'ما عنده وسيلة تواصل صالحة'}>
                  <input type="checkbox" checked={on} disabled={!can} onChange={() => toggle(r)} className={`size-5 shrink-0 accent-[var(--color-bg-primary)] ${FOCUS_RING}`} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={`truncate text-[16px] leading-[26px] font-medium ${ch === 'Unreachable' ? 'text-[var(--color-text-tertiary)]' : ''}`}>{nameOf(r)}</span>
                    <span className="truncate text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{rowSub(r)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><ChannelBadge channel={ch} />{fitBadge(r)}</span>
                </label>
              </li>
            )
          })}
          {shown < rows.length ? (
            <li className="border-t border-[var(--color-border-default)] px-5 py-3">
              <Button variant="Ghost" size="S" onClick={() => setShown((s) => s + PAGE)}>اعرض {n(Math.min(PAGE, rows.length - shown))} أكثر</Button>
            </li>
          ) : null}
          {truncated ? <li className="border-t border-[var(--color-border-default)] px-5 py-3 text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">معروض أول {n(rows.length)} من {n(res.total)} — الأقرب للوصف أولًا.</li> : null}
        </ul>
      )}
    </section>
  )

  const basisOf = truncated ? `من أول ${n(rows.length)} نتيجة` : null
  const confirmSheet = confirming && holder ? (
    <CampaignConfirmSheet holderRfqId={holder} rows={chosen} message={message.trim()} query={query} cost={cost}
      onClose={() => setConfirming(false)}
      onDone={(sent, failed) => { setConfirming(false); setComposeOpen(false); setNotice(`أُرسلت ${n(sent)} رسالة${failed ? ` · ما وصلت ${n(failed)}` : ''}. الردود توصلك في صندوق الوارد.`) }} />
  ) : null

  // Phones: Figma M07 (59:439) — the map fills the screen under a floating search; counters, results and the
  // campaign button sit in a bottom sheet; the message opens in its own sheet, then the confirm sheet (10).
  if (mobile) {
    const mini = (label: string, value: number, color: string) => (
      <div className="flex flex-col items-center rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] py-2">
        <span className="font-[family-name:var(--font-display)] text-[18px] leading-[26px] font-semibold tabular-nums" style={{ color }}>{n(value)}</span>
        <span className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      </div>
    )
    return (
      <div className="relative h-[calc(100dvh-72px)] overflow-hidden bg-[var(--color-bg-inverse)]">
        <h1 className="sr-only">الاستهداف</h1>
        <div className="absolute inset-x-0 top-0 h-[50%]">
          <MapView rows={rows} selected={selected} onToggle={(r) => { toggle(r); focusRow(r.poi_key) }} topInset={(chips.length ? 170 : 130) + (lines.length ? 70 : 0)} legend={false} />
        </div>
        <div className="absolute inset-x-4 top-4 flex flex-col gap-3">
          {direction}
          <form role="search" onSubmit={search} className="flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] py-1.5 ps-4 pe-1.5 shadow-[var(--elevation-lg)]">
            <Icon name="search" size={18} className="text-[var(--color-icon-secondary)]" />
            <label className="sr-only" htmlFor="targeting-q">وش تبي توصل له؟</label>
            <input id="targeting-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={objective === "marketing" ? "وش تخصصك أو وش تبيع؟" : "وش تبي تشتري؟ منتج أو خدمة"}
              className="min-w-0 flex-1 bg-transparent text-[16px] leading-[26px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
            {citySelect('max-w-[96px] text-[14px]')}
            <Button type="submit" variant="Primary" size="S" disabled={!q.trim() || !city || busy} loading={busy} loadingLabel="…">ابحث</Button>
          </form>
          {chips.length ? (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {chips.map((c) => <button key={c} type="button" onClick={() => input.current?.focus()} className={`shrink-0 whitespace-nowrap rounded-full bg-[var(--color-bg-surface)] px-4 py-1.5 text-[14px] leading-[22px] font-medium ${FOCUS_RING}`}>{c.replace(/^[^:]+:\s*/, '')}</button>)}
            </div>
          ) : null}
          {error ? <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]">{error}</p> : null}
          {linesPanel(true)}
          {fileField}
        </div>
        <section aria-label="النتائج" className="absolute inset-x-0 bottom-0 flex h-[52%] flex-col rounded-t-[var(--radius-xl)] bg-[var(--color-bg-surface)] shadow-[var(--elevation-lg)]">
          <div className="flex items-center justify-between px-4 pt-2">
            <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-[var(--color-border-strong)]" />
          </div>
          <div className="flex items-center justify-between gap-2 px-4 pt-2">
            <p className="text-[14px] leading-[22px] font-medium">{res ? `${n(res.total)} نتيجة` : objective === 'marketing' ? 'ابحث عن مشترين محتملين' : 'ابحث عن بائعين'}</p>
            <div className="flex items-center gap-3">
              {res && counts.wa ? (
                <button type="button" className={`text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] ${FOCUS_RING}`}
                  onClick={() => setSelected(chosen.length ? new Set() : pickBest(rows))}>
                  {chosen.length ? 'إلغاء التحديد' : hasAi ? 'حدد المناسبين' : 'حدد واتساب'}
                </button>
              ) : null}
              {uploadButton(objective === 'marketing' ? 'ارفع كتالوج' : 'ارفع قائمة', 'Ghost')}
              <Button variant="Ghost" size="S" icon="whatsapp" onClick={onTemplates}>القوالب</Button>
            </div>
          </div>
          {res ? (
            <div className="grid grid-cols-4 gap-2 px-4 py-3">
              {mini('وُجد', res.total, 'var(--color-text-primary)')}
              {mini('واتساب', counts.wa, 'var(--color-text-success)')}
              {mini('إيميل', counts.emailOnly, 'var(--color-text-info)')}
              {mini('لا يمكن', counts.none, 'var(--color-text-tertiary)')}
            </div>
          ) : null}
          <ul ref={list} className="min-h-0 flex-1 overflow-y-auto">
            {!res && !busy ? <li className="px-5 py-6 text-[14px] leading-[24px] text-[var(--color-text-secondary)]">{objective === 'marketing' ? 'اكتب تخصصك مثل «مواد سباكة»، أو ارفع كتالوجك ثم اختر تخصصًا أو منتجًا للبحث عن مشترين محتملين.' : 'اكتب المنتج أو الخدمة التي تحتاجها، أو ارفع قائمة احتياجاتك ثم اختر عنصرًا للبحث عن بائعين.'} اختر المدينة لتحديد نطاق البحث.</li> : null}
            {busy ? <li role="status" className="px-5 py-6 text-[14px]">نفهم المنتج أو الخدمة ونبحث عن الجهات المناسبة…</li> : null}
            {res && !rows.length ? <li className="px-5 py-6 text-[14px]">لم نجد جهات مناسبة لهذا العنصر في المدينة المختارة. جرّب وصفًا أوضح أو مدينة أخرى.</li> : null}
            {rows.slice(0, shown).map((r) => {
              const ch = channelOf(r), can = ch === 'WhatsApp'
              return (
                <li key={r.poi_key} data-key={r.poi_key}>
                  <label className="flex items-center gap-3 px-4 py-2.5">
                    <input type="checkbox" checked={selected.has(r.poi_key)} disabled={!can} onChange={() => toggle(r)} className={`size-5 shrink-0 accent-[var(--color-bg-primary)] ${FOCUS_RING}`} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-[16px] leading-[24px] font-medium ${ch === 'Unreachable' ? 'text-[var(--color-text-tertiary)]' : ''}`}>{nameOf(r)}</span>
                      <span className="truncate text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{rowSub(r)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1"><ChannelBadge channel={ch} />{fitBadge(r)}</span>
                  </label>
                </li>
              )
            })}
            {shown < rows.length ? <li className="px-4 py-2"><Button variant="Ghost" size="S" onClick={() => setShown((s) => s + PAGE)}>اعرض {n(Math.min(PAGE, rows.length - shown))} أكثر</Button></li> : null}
          </ul>
          {notice ? <p role="status" className="mx-4 mb-2 rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-success)]">{notice}</p> : null}
          <div className="border-t border-[var(--color-border-default)] p-4">
            <Button variant="Primary" size="L" icon="send" fullWidth disabled={!chosen.length} onClick={() => setComposeOpen(true)}>اكتب رسالة الحملة لـ {n(chosen.length)} جهة</Button>
          </div>
        </section>
        {composeOpen ? (
          <div className="fixed inset-0 z-50 flex items-end bg-[var(--color-bg-inverse)]/40" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setComposeOpen(false) }}>
            <div role="dialog" aria-modal="true" aria-label="رسالة الحملة" className="w-full">
              {compose}
              <div className="bg-[var(--color-bg-surface)] px-5 pb-5"><Button variant="Secondary" size="M" fullWidth onClick={() => setComposeOpen(false)}>رجوع</Button></div>
            </div>
          </div>
        ) : null}
        {confirmSheet}
      </div>
    )
  }

  return (
    <div className={`flex min-w-0 flex-col ${mobile ? '' : 'h-dvh'}`}>
      <header className={`flex flex-col gap-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/70 ${mobile ? 'px-4 py-4' : 'px-8 py-6'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">الاستهداف</h1>
            {direction}
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">اكتشف البائعين أو المشترين المحتملين حسب هدفك</p>
          </div>
          <div className="flex items-center gap-2">
            {uploadButton('ارفع كراسة', 'Secondary')}
            <Button variant="Secondary" size="S" icon="whatsapp" onClick={onTemplates}>قوالب واتساب</Button>
          </div>
          {fileField}
        </div>
        <form role="search" onSubmit={search} className="flex items-center gap-3 rounded-[var(--radius-lg)] border-2 border-[var(--color-border-primary)] bg-[var(--color-bg-surface)] py-2 ps-4 pe-2">
          <Icon name="search" size={22} className="text-[var(--color-icon-secondary)]" />
          <label className="sr-only" htmlFor="targeting-q">وش تبي توصل له؟</label>
          <input id="targeting-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={objective === "marketing" ? "مثال: مواد سباكة أو أجهزة كمبيوتر" : "مثال: أشتري أجهزة كمبيوتر"}
            className="min-w-0 flex-1 bg-transparent text-[18px] leading-[30px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
          {citySelect('w-[170px] text-[16px]')}
          <Button type="submit" variant="Primary" size="M" disabled={!q.trim() || !city || busy} loading={busy} loadingLabel="جارٍ البحث…">ابحث</Button>
        </form>
        {chips.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[14px] leading-[22px] font-medium text-[var(--color-text-secondary)]"><Icon name="bolt" size={16} />فهمنا طلبك كذا:</span>
            {chips.map((c) => (
              <button key={c} type="button" onClick={() => input.current?.focus()} className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--color-bg-info)] px-3 py-1.5 text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] ${FOCUS_RING}`}>
                {c}<Icon name="edit" size={14} />
              </button>
            ))}
            {res?.parsed?.ai === false ? <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">(فهم بالقاموس الداخلي)</span> : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-danger)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-danger)]"><Icon name="alert" size={18} />{error}</p> : null}
        {linesPanel(false)}
      </header>

      {res ? (
        <div className={`grid gap-4 ${mobile ? 'grid-cols-2 px-4 py-4' : 'grid-cols-4 px-8 py-4'}`}>
          <Stat label="وُجد" value={n(res.total)} basis={res.ai_checked ? `الذكاء فحص ${n(res.ai_checked)}: مناسب ${n(res.ai_likely || 0)} · محتمل ${n(res.ai_maybe || 0)}` : res.parsed?.ai === false ? 'بيانات عامة · فهم بالقاموس' : 'بيانات عامة · فهم بالذكاء'} />
          <Stat label="عندهم واتساب" tone="Success" value={n(counts.wa)} basis={basisOf || 'رقم جوال سعودي صيغته صحيحة'} />
          <Stat label="إيميل فقط" value={n(counts.emailOnly)} basis={basisOf || 'ما عندهم واتساب معروف'} />
          <Stat label="لا يمكن الإرسال" tone="Danger" value={n(counts.none)} basis={basisOf || 'بدون وسيلة تواصل صالحة'} />
        </div>
      ) : null}

      <div className={`flex min-h-0 flex-1 ${mobile ? 'flex-col' : 'flex-row'}`}>
        {results}
        <div className={`relative min-w-0 flex-1 overflow-hidden bg-[var(--color-bg-inverse)] ${mobile ? 'h-[360px] flex-none' : ''}`}>
          <MapView rows={rows} selected={selected} onToggle={(r) => { toggle(r); focusRow(r.poi_key) }} bottomInset={320} />
          {mobile ? null : <div className="pointer-events-none absolute inset-x-6 bottom-6 flex justify-start"><div className="pointer-events-auto">{compose}</div></div>}
        </div>
        {mobile ? <div className="p-4">{compose}</div> : null}
      </div>

      {confirmSheet}
    </div>
  )
}
