import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { searchTargets, templateStatus, waNumber, TargetingError, OUTREACH_TEMPLATE, type TargetRow, type TargetSearch, type TemplateStatus } from '../../api/targetingClient'
import { Badge, Button, ChannelBadge, Icon, Stat, useIsMobile, type Channel } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'
import TargetMap from './TargetMap'
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
const arabic = (s: string) => /[؀-ۿ]/.test(s)

function defaultMessage(cat: string | null, area: string | null) {
  return `معك أحمد من فرق. يوصلنا طلبات تسعير${cat ? ` ${cat}` : ''} من مقاولين${area ? ` في ${area}` : ''} — تبي توصلك على واتساب؟\nللإيقاف أرسل: إيقاف`
}

export default function TargetingPage({ onTemplates }: { onTemplates: () => void }) {
  const mobile = useIsMobile()
  const [q, setQ] = useState('')
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
  const [notice, setNotice] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => { templateStatus().then(setTpl, () => setTplError(true)) }, [])

  const rows = useMemo(() => res?.rows || [], [res])
  const counts = useMemo(() => {
    let wa = 0, emailOnly = 0, none = 0
    for (const r of rows) { const c = channelOf(r); if (c === 'WhatsApp') wa++; else if (c === 'Email') emailOnly++; else none++ }
    return { wa, emailOnly, none }
  }, [rows])
  const truncated = res ? rows.length < res.total : false
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.poi_key)), [rows, selected])

  const chips = useMemo(() => {
    if (!res) return []
    const p = res.parsed || {}
    const cat = (p.keywords || []).filter(arabic).slice(0, 2).join(' و')
    const regionAr = rows.find((r) => r.region_en && r.region_en === p.region)?.region_ar
    const area = regionAr || p.city || null
    return [cat ? `الفئة: ${cat}` : null, area ? `المنطقة: ${area}` : null].filter(Boolean) as string[]
  }, [res, rows])

  async function search(e?: FormEvent) {
    e?.preventDefault()
    const text = q.trim()
    if (!text || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await searchTargets(text)
      setRes(r); setQuery(text); setShown(PAGE)
      setSelected(new Set())
      const p = r.parsed || {}
      const cat = (p.keywords || []).filter(arabic)[0] || null
      const area = r.rows.find((x) => x.region_en && x.region_en === p.region)?.region_ar || null
      setMessage(defaultMessage(cat, area))
    } catch (err) {
      setError(err instanceof TargetingError ? err.message : 'تعذّر البحث. تأكد من الاتصال وحاول مرة ثانية.')
    } finally { setBusy(false) }
  }

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
  const sendBlock = !res ? 'ابحث أولًا' : !chosen.length ? 'حدد جهة وحدة على الأقل' : !message.trim() ? 'اكتب نص الرسالة' : tplError ? 'تعذّر التحقق من حالة القالب' : !tpl ? 'جارٍ التحقق من القالب…' : !approved ? `القالب ${OUTREACH_TEMPLATE} غير معتمد من Meta (${tpl.status})` : !holder ? 'ما فيه طلب حاضن للردود' : null
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
            onClick={() => setSelected(chosen.length ? new Set() : new Set(rows.filter((r) => waNumber(r)).map((r) => r.poi_key)))}>
            {chosen.length ? 'إلغاء التحديد' : 'حدد اللي عندهم واتساب'}
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
                    <span className="truncate text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{placeOf(r) || '—'}</span>
                  </span>
                  <ChannelBadge channel={ch} />
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
  return (
    <div className={`flex min-w-0 flex-col ${mobile ? '' : 'h-dvh'}`}>
      <header className={`flex flex-col gap-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/70 ${mobile ? 'px-4 py-4' : 'px-8 py-6'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">الاستهداف</h1>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">دعوة موردين للانضمام</p>
          </div>
          <Button variant="Secondary" size="S" icon="whatsapp" onClick={onTemplates}>قوالب واتساب</Button>
        </div>
        <form role="search" onSubmit={search} className="flex items-center gap-3 rounded-[var(--radius-lg)] border-2 border-[var(--color-border-primary)] bg-[var(--color-bg-surface)] py-2 ps-4 pe-2">
          <Icon name="search" size={22} className="text-[var(--color-icon-secondary)]" />
          <label className="sr-only" htmlFor="targeting-q">وش تبي توصل له؟</label>
          <input id="targeting-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: محلات أدوات صحية وسباكة في الرياض"
            className="min-w-0 flex-1 bg-transparent text-[18px] leading-[30px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
          <Button type="submit" variant="Primary" size="M" disabled={!q.trim() || busy} loading={busy} loadingLabel="جارٍ البحث…">ابحث</Button>
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
      </header>

      {res ? (
        <div className={`grid gap-4 ${mobile ? 'grid-cols-2 px-4 py-4' : 'grid-cols-4 px-8 py-4'}`}>
          <Stat label="وُجد" value={n(res.total)} basis={res.parsed?.ai === false ? 'بيانات عامة · فهم بالقاموس' : 'بيانات عامة · فهم بالذكاء'} />
          <Stat label="عندهم واتساب" tone="Success" value={n(counts.wa)} basis={basisOf || 'رقم جوال سعودي صيغته صحيحة'} />
          <Stat label="إيميل فقط" value={n(counts.emailOnly)} basis={basisOf || 'ما عندهم واتساب معروف'} />
          <Stat label="لا يمكن الإرسال" tone="Danger" value={n(counts.none)} basis={basisOf || 'بدون وسيلة تواصل صالحة'} />
        </div>
      ) : null}

      <div className={`flex min-h-0 flex-1 ${mobile ? 'flex-col' : 'flex-row'}`}>
        {results}
        <div className={`relative min-w-0 flex-1 overflow-hidden bg-[var(--color-bg-inverse)] ${mobile ? 'h-[360px] flex-none' : ''}`}>
          <TargetMap rows={rows} selected={selected} onToggle={(r) => { toggle(r); focusRow(r.poi_key) }} />
          {mobile ? null : <div className="pointer-events-none absolute inset-x-6 bottom-6 flex justify-start"><div className="pointer-events-auto">{compose}</div></div>}
        </div>
        {mobile ? <div className="p-4">{compose}</div> : null}
      </div>

      {confirming && holder ? (
        <CampaignConfirmSheet holderRfqId={holder} rows={chosen} message={message.trim()} query={query} cost={cost}
          onClose={() => setConfirming(false)}
          onDone={(sent, failed) => { setConfirming(false); setNotice(`أُرسلت ${n(sent)} رسالة${failed ? ` · ما وصلت ${n(failed)}` : ''}. الردود توصلك في صندوق الوارد.`) }} />
      ) : null}
    </div>
  )
}
