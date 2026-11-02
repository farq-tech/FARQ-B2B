'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Scale, Send, X } from 'lucide-react'
import { ltr, numberFormat } from '@/lib/insights-api'
import { perSqmLine, priceLine, typeLabel, type Listing } from '@/lib/real-estate'
import { cn } from '@/lib/utils'
import { SkeletonStatus, Skeleton } from '@/components/ui/skeleton'
import type { DistrictRow } from './city-data'
import { boldRuns, districtPairs, factsLine, figure, replyBlocks, type Fact } from './advisor-facts'

export type AdvisorSubject = { kind: 'listings'; listings: Listing[] } | { kind: 'districts'; rows: DistrictRow[] }
type Turn = { role: 'user' | 'assistant'; content: string }

const WHO = ['عائلة بأطفال', 'زوجان', 'أعزب', 'شخص يعيش وحده', 'لنشاط تجاري']
const PRIORITIES = ['السعر الأقل', 'مساحة أكبر', 'حي هادئ قليل المحلات', 'خدمات ومحلات قريبة', 'حي عائلي (فلل أكثر)']
const LETTERS = ['أ', 'ب']

/** A district's Atlas figures as one line for the advisor; a missing one stays «غير متاح». */
function districtFacts(row: DistrictRow | undefined, name: string): string {
  if (!row) return `حي ${name}: لا أرقام له في أطلس.`
  return `حي ${row.name} | ${factsLine(districtPairs(row))}`
}

/** A listing's figures as the ad states them, in the order the person sees them in the table. */
function listingPairs(listing: Listing): Fact[] {
  return [
    { label: 'السعر', value: priceLine(listing) },
    { label: 'المساحة', value: listing.area_sqm ? `${numberFormat.format(listing.area_sqm)} م²` : 'غير متاح' },
    { label: 'سعر المتر', value: perSqmLine(listing) ?? 'غير متاح' },
    { label: 'مقارنة بوسيط الحي', value: listing.vs_district_pct == null ? 'غير متاح' : ltr(`${listing.vs_district_pct > 0 ? '+' : ''}${numberFormat.format(listing.vs_district_pct)}%`) },
    { label: 'غرف النوم', value: figure(listing.beds) },
    { label: 'دورات المياه', value: figure(listing.wc) },
    { label: 'عرض الشارع', value: figure(listing.street_width, ' م') },
  ]
}

function listingFacts(listing: Listing, letter: string): string {
  return [
    `الخيار ${letter}: ${typeLabel(listing.type)} ${listing.kind === 'rent' ? 'للإيجار' : listing.kind === 'sale' ? 'للبيع' : ''} في ${listing.district_ar ? `حي ${listing.district_ar}` : 'حي غير محدد'}`,
    ...(listing.check ? ['أرقام الإعلان تحتاج تحققاً'] : []),
    factsLine(listingPairs(listing)),
  ].join(' | ')
}

export function subjectFacts(subject: AdvisorSubject, rows: DistrictRow[]): string {
  if (subject.kind === 'districts') return subject.rows.map((row, index) => `الخيار ${LETTERS[index]}: ${districtFacts(row, row.name)}`).join('\n')
  return subject.listings.map((listing, index) => [
    listingFacts(listing, LETTERS[index]),
    districtFacts(rows.find((row) => row.id === listing.district_id), listing.district_ar ?? 'غير محدد'),
  ].join('\n')).join('\n\n')
}

/** The two options' figures side by side: the same facts the assistant is given, row by row. */
function subjectTable(subject: AdvisorSubject, rows: DistrictRow[]): { heads: string[]; rows: { label: string; cells: string[] }[] } {
  const columns: Fact[][] = subject.kind === 'districts'
    ? subject.rows.map((row) => districtPairs(row))
    : subject.listings.map((listing) => {
      const district = rows.find((row) => row.id === listing.district_id)
      return [...listingPairs(listing), ...(district ? districtPairs(district).map((fact) => ({ ...fact, label: `الحي: ${fact.label}` })) : [])]
    })
  const labels = [...new Set(columns.flat().map((fact) => fact.label))]
  return {
    // districts are named; listings keep the letters the title and the assistant use («أ: شقة في …»)
    heads: subject.kind === 'districts' ? subject.rows.map((row) => row.name) : LETTERS.slice(0, columns.length),
    rows: labels.map((label) => ({ label, cells: columns.map((column) => column.find((fact) => fact.label === label)?.value ?? 'غير متاح') })),
  }
}

/** An assistant reply in parts: paragraphs, then points as a list, «**…**» as bold; every word of the reply kept. */
function Reply({ text }: { text: string }) {
  const runs = (line: string) => boldRuns(line).map(([part, bold], index) => (bold ? <strong key={index}>{part}</strong> : <span key={index}>{part}</span>))
  return (
    <div className="flex flex-col gap-2">
      {replyBlocks(text).map((block, index) => (block.kind === 'p'
        ? <p key={index} className="whitespace-pre-line">{runs(block.text)}</p>
        : <ul key={index} className="list-disc space-y-1 ps-5">{block.items.map((item, at) => <li key={at}>{runs(item)}</li>)}</ul>))}
    </div>
  )
}

/** «الأرقام التي يقارن بها»: what the assistant was handed, folded, so any figure in its answer can be checked here. */
function FactsTable({ subject, rows }: { subject: AdvisorSubject; rows: DistrictRow[] }) {
  const table = subjectTable(subject, rows)
  return (
    <details className="rounded-xl border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">الأرقام التي يقارن بها</summary>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-muted-foreground"><th className="py-1 text-start font-medium" />{table.heads.map((head) => <th key={head} className="py-1 text-center font-semibold">{head}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {table.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="py-1.5 text-start font-normal text-muted-foreground">{row.label}</th>
              {row.cells.map((cell, index) => <td key={index} className="py-1.5 text-center tabular-nums">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
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
  const thread = useRef<HTMLOListElement>(null)

  // a new turn (or the reply placeholder) can land below the fold of the scrolling thread: bring its start into view
  useEffect(() => {
    const last = thread.current?.lastElementChild
    if (last instanceof HTMLElement) thread.current!.scrollTo({ top: last.offsetTop, behavior: 'smooth' })   // the list is `relative`, so offsetTop is measured from it
  }, [turns, status])

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
          <ol ref={thread} aria-live="polite" aria-relevant="additions" aria-label="المحادثة" className="relative flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {turns.map((turn, index) => (
              <li key={index} className={cn('rounded-xl px-3 py-2 text-base leading-7', turn.role === 'assistant' ? 'bg-muted/50' : 'ms-8 whitespace-pre-line bg-primary/10')}>
                {turn.role === 'assistant' ? <Reply text={turn.content} /> : turn.content}
              </li>
            ))}
            {status === 'loading' && (
              <li>
                <SkeletonStatus label="جارٍ التحضير" className="flex flex-col gap-2 rounded-xl bg-muted/50 px-3 py-3">
                  <Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" />
                </SkeletonStatus>
              </li>
            )}
          </ol>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); send() }}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} aria-label="سؤالك عن المقارنة" enterKeyHint="send"
              placeholder="اكتب سؤالك عن المقارنة" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-base" />
            <button type="submit" disabled={!draft.trim() || status === 'loading'} aria-label="أرسل"
              className="rounded-lg bg-primary px-3 text-primary-foreground disabled:opacity-50"><Send className="size-4" aria-hidden /></button>
          </form>
        </>
      )}
      <FactsTable subject={subject} rows={rows} />
      {status === 'login' && <p className="text-base">لاستخدام المقارنة <Link href="/login?next=/map" className="font-semibold text-primary underline">سجّل الدخول</Link>.</p>}
      {status === 'error' && <p role="alert" className="text-base text-destructive">{message}</p>}
      <p className="text-sm text-muted-foreground">يقارن من أرقام أطلس فقط، ولا يقرر عنك.</p>
    </section>
  )
}
