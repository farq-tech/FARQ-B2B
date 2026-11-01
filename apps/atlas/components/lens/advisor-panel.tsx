'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Loader2, Scale, Send, X } from 'lucide-react'
import { ltr, numberFormat } from '@/lib/insights-api'
import { perSqmLine, priceLine, typeLabel, type Listing } from '@/lib/real-estate'
import { cn } from '@/lib/utils'
import type { DistrictRow } from './city-data'

export type AdvisorSubject = { kind: 'listings'; listings: Listing[] } | { kind: 'districts'; rows: DistrictRow[] }
type Turn = { role: 'user' | 'assistant'; content: string }

const WHO = ['عائلة بأطفال', 'زوجان', 'أعزب', 'شخص يعيش وحده', 'لنشاط تجاري']
const PRIORITIES = ['السعر الأقل', 'مساحة أكبر', 'حي هادئ قليل المحلات', 'خدمات ومحلات قريبة', 'حي عائلي (فلل أكثر)']
const LETTERS = ['أ', 'ب']

const figure = (value: number | null | undefined, unit = '') => (value == null ? 'غير متاح' : `${numberFormat.format(Math.round(value))}${unit}`)

/** A district's Atlas figures as one line for the advisor; a missing one stays «غير متاح». */
function districtFacts(row: DistrictRow | undefined, name: string): string {
  if (!row) return `حي ${name}: لا أرقام له في أطلس.`
  const median = (key: string) => figure(row.realEstate[key]?.median, ' ريال')
  return [
    `حي ${row.name}`,
    `السكان ${figure(row.population)}`,
    `المنشآت ${figure(row.businesses)}`,
    `ساكن لكل منشأة ${figure(row.residentsPerBusiness)}`,
    `متوسط الدخل الشهري ${figure(row.income, ' ريال')}`,
    `حصة الفلل من المساكن ${figure(row.villaShare, '%')}`,
    `مبانٍ تحت الإنشاء ${figure(row.underConstruction)}`,
    `وسيط إيجار السكن السنوي للمتر ${median('rent_year_residential')}`,
    `وسيط إيجار السكن الشهري للمتر ${median('rent_month_residential')}`,
    `وسيط سعر بيع السكن للمتر ${median('sale_residential')}`,
    `وسيط إيجار المحل السنوي للمتر ${median('rent_year_commercial')}`,
    `وسيط إيجار المحل للمتر (المدة غير مذكورة) ${median('rent_unstated_commercial')}`,
    `وسيط سعر الأرض للمتر ${median('sale_land')}`,
  ].join(' | ')
}

function listingFacts(listing: Listing, letter: string): string {
  return [
    `الخيار ${letter}: ${typeLabel(listing.type)} ${listing.kind === 'rent' ? 'للإيجار' : listing.kind === 'sale' ? 'للبيع' : ''} في ${listing.district_ar ? `حي ${listing.district_ar}` : 'حي غير محدد'}`,
    priceLine(listing),
    listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : 'المساحة غير مذكورة',
    perSqmLine(listing) ?? 'سعر المتر غير متاح',
    ...(listing.check ? ['أرقام الإعلان تحتاج تحققاً'] : []),
    `مقارنة بوسيط الحي ${listing.vs_district_pct == null ? 'غير متاح' : ltr(`${listing.vs_district_pct > 0 ? '+' : ''}${numberFormat.format(listing.vs_district_pct)}%`)}`,
    `غرف النوم ${figure(listing.beds)}`,
    `دورات المياه ${figure(listing.wc)}`,
    `عرض الشارع ${figure(listing.street_width, ' م')}`,
  ].join(' | ')
}

export function subjectFacts(subject: AdvisorSubject, rows: DistrictRow[]): string {
  if (subject.kind === 'districts') return subject.rows.map((row, index) => `الخيار ${LETTERS[index]}: ${districtFacts(row, row.name)}`).join('\n')
  return subject.listings.map((listing, index) => [
    listingFacts(listing, LETTERS[index]),
    districtFacts(rows.find((row) => row.id === listing.district_id), listing.district_ar ?? 'غير محدد'),
  ].join('\n')).join('\n\n')
}

const subjectTitle = (subject: AdvisorSubject) => (subject.kind === 'districts'
  ? subject.rows.map((row) => row.name).join(' مقابل ')
  : subject.listings.map((listing, index) => `${LETTERS[index]}: ${typeLabel(listing.type)} في ${listing.district_ar}`).join(' مقابل '))

function Chips({ options, chosen, onToggle }: { options: string[]; chosen: string[]; onToggle: (option: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button key={option} onClick={() => onToggle(option)} aria-pressed={chosen.includes(option)}
          className={cn('rounded-full border px-3 py-1.5 text-sm', chosen.includes(option) ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>
          {option}
        </button>
      ))}
    </div>
  )
}

/**
 * The comparison assistant: a few taps on who it is for and what matters, then the assistant compares the two options
 * from Atlas figures only and may ask a follow-up. It never decides for the person.
 */
export function AdvisorPanel({ subject, rows, onClose }: { subject: AdvisorSubject; rows: DistrictRow[]; onClose?: () => void }) {
  const [who, setWho] = useState<string[]>([])
  const [priorities, setPriorities] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [turns, setTurns] = useState<Turn[] | null>(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'login' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const profile = [
    who.length ? `لمن: ${who.join('، ')}` : '',
    priorities.length ? `الأهم: ${priorities.join('، ')}` : '',
    note.trim() ? `ملاحظة: ${note.trim()}` : '',
  ].filter(Boolean).join('\n')

  async function ask(next: Turn[]) {
    setStatus('loading')
    // an unanswered question goes back into the box, so the conversation keeps alternating
    const giveBack = () => { if (next.length) { setTurns(next.slice(0, -1)); setDraft(next[next.length - 1].content) } }
    try {
      const response = await fetch('/api/advisor', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ facts: subjectFacts(subject, rows), profile, turns: next }),
      })
      const body = await response.json().catch(() => null) as { reply?: string; error?: string } | null
      if (response.status === 401) { giveBack(); setStatus('login'); return }
      if (!response.ok || !body?.reply) throw new Error(body?.error || 'تعذر الحصول على رد.')
      setTurns([...next, { role: 'assistant', content: body.reply }])
      setStatus('idle')
    } catch (error) {
      giveBack()
      setMessage(error instanceof Error ? error.message : 'تعذر الحصول على رد.')
      setStatus('error')
    }
  }

  function send() {
    const text = draft.trim()
    if (!text || !turns || status === 'loading') return
    setDraft('')
    const next: Turn[] = [...turns, { role: 'user', content: text }]
    setTurns(next)
    void ask(next)
  }

  const toggle = (setter: (update: (current: string[]) => string[]) => void) => (option: string) =>
    setter((current) => (current.includes(option) ? current.filter((item) => item !== option) : [...current, option]))

  return (
    <section aria-label="المقارنة" className="flex flex-col gap-3 rounded-2xl border border-primary/40 bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold"><Scale className="size-5 text-primary" aria-hidden /> المقارنة</h2>
          <p className="text-sm text-muted-foreground">{subjectTitle(subject)}</p>
        </div>
        {onClose && <button onClick={onClose} aria-label="إغلاق المقارنة" className="rounded-full p-1.5 hover:bg-muted"><X className="size-4" aria-hidden /></button>}
      </div>

      {turns === null ? (
        <>
          <div>
            <p className="mb-1.5 text-sm font-semibold">لمن تبحث؟</p>
            <Chips options={WHO} chosen={who} onToggle={toggle(setWho)} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">ما الأهم لك؟</p>
            <Chips options={PRIORITIES} chosen={priorities} onToggle={toggle(setPriorities)} />
          </div>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300}
            placeholder="شيء آخر؟ مثلاً: عملي في العليا، أو عندي ثلاثة أطفال" className="rounded-lg border bg-background px-3 py-2 text-base" />
          <button onClick={() => void ask([])} disabled={status === 'loading'}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-base font-semibold text-primary-foreground disabled:opacity-60">
            {status === 'loading' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Scale className="size-4" aria-hidden />} قارن
          </button>
        </>
      ) : (
        <>
          <ol className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {turns.map((turn, index) => (
              <li key={index} className={cn('whitespace-pre-line rounded-xl px-3 py-2 text-base leading-7', turn.role === 'assistant' ? 'bg-muted/50' : 'ms-8 bg-primary/10')}>
                {turn.content}
              </li>
            ))}
            {status === 'loading' && <li><Loader2 className="size-5 animate-spin text-primary" aria-label="جارٍ التحضير" /></li>}
          </ol>
          <div className="flex gap-2">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') send() }} maxLength={500}
              placeholder="اكتب سؤالك عن المقارنة" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-base" />
            <button onClick={send} disabled={!draft.trim() || status === 'loading'} aria-label="أرسل"
              className="rounded-lg bg-primary px-3 text-primary-foreground disabled:opacity-50"><Send className="size-4" aria-hidden /></button>
          </div>
        </>
      )}
      {status === 'login' && <p className="text-base">لاستخدام المقارنة <Link href="/login?next=/map" className="font-semibold text-primary underline">سجّل الدخول</Link>.</p>}
      {status === 'error' && <p role="alert" className="text-base text-destructive">{message}</p>}
      <p className="text-sm text-muted-foreground">يقارن من أرقام أطلس فقط، ولا يقرر عنك.</p>
    </section>
  )
}
