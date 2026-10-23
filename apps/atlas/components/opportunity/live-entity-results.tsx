'use client'

import Link from 'next/link'
import { Building2, ChevronLeft, ChevronRight, Loader2, MapPin, MessageCircle, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LiveBusinessSnapshot } from '@/lib/types'

export type DirectoryObjective = 'purchase' | 'marketing' | 'browse'

export type LiveEntity = LiveBusinessSnapshot & {
  verification: 'verified' | 'unverified' | 'unknown' | null
  roles: string[]
  specialties: string[]
  status: string | null
}

export type LiveEntityResult = { total: number; withWhatsapp: number; rows: LiveEntity[]; offset: number; hasMore: boolean; nextOffset: number | null; mapQuery: string | null }

type State = { kind: 'idle' | 'loading' | 'ready' | 'auth' | 'blocked' | 'error'; data: LiveEntityResult | null; message?: string }

export function LiveEntityResults({ query, cityId, objective, district, onResults, selectedIds = [], onToggle }: { query: string; cityId: string; objective: DirectoryObjective; district?: string; onResults?: (result: LiveEntityResult | null) => void; selectedIds?: string[]; onToggle?: (id: string) => void }) {
  const [state, setState] = useState<State>({ kind: 'idle', data: null })
  const [offset, setOffset] = useState(0)
  const pageSize = 50

  useEffect(() => { setOffset(0) }, [query, cityId, objective, district])

  useEffect(() => {
    const q = query.trim()
    if (!q && !district) { setState({ kind: 'idle', data: null }); return }
    const controller = new AbortController()
    setState({ kind: 'loading', data: null })
    fetch('/api/market/entities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q, city: cityId, objective, district, limit: pageSize, offset }), signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as (LiveEntityResult & { error?: string }) | null
        if (response.status === 401) return setState({ kind: 'auth', data: null, message: payload?.error })
        if (response.status === 403) return setState({ kind: 'blocked', data: null, message: payload?.error })
        if (!response.ok || !payload) return setState({ kind: 'error', data: null, message: payload?.error || 'تعذر تحميل الجهات.' })
        setState({ kind: 'ready', data: payload })
      })
      .catch((error) => { if (!controller.signal.aborted) setState({ kind: 'error', data: null, message: error instanceof Error && error.name === 'AbortError' ? undefined : 'تعذر الاتصال بخدمة الدليل.' }) })
    return () => controller.abort()
  }, [query, cityId, objective, district, offset])

  useEffect(() => { onResults?.(state.data ?? null) }, [onResults, state.data])

  if (state.kind === 'idle') return <EmptySearch />
  if (state.kind === 'loading') return <Loading />
  if (state.kind === 'auth') return <SignInPrompt />
  if (state.kind === 'blocked') return <Notice tone="warning" text={state.message || 'لا يملك هذا الحساب صلاحية دليل الجهات.'} />
  if (state.kind === 'error') return <Notice tone="error" text={state.message || 'تعذر تحميل الجهات.'} />
  const data = state.data
  if (!data) return null
  const first = data.total ? offset + 1 : 0
  const last = Math.min(offset + data.rows.length, data.total)
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="الجهات المطابقة">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">الجهات المطابقة{district ? ` في ${district}` : ''}</h2><p className="mt-1 text-xs text-muted-foreground">نتائج حية للاطلاع؛ لا نعرض أرقام الاتصال في هذه المرحلة.</p></div>
        <span className="rounded-full bg-accent px-2 py-1 text-xs font-medium text-accent-foreground tabular-nums">{data.total.toLocaleString('en-US')}</span>
      </div>
      {data.rows.length ? <ul className="mt-3 flex flex-col divide-y">{data.rows.map((entity) => <EntityRow key={entity.id} entity={entity} selected={selectedIds.includes(entity.id)} onToggle={onToggle} />)}</ul> : <p className="mt-3 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">لم نجد جهات تطابق هذا النشاط ضمن النطاق.</p>}
      {data.total > pageSize ? <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span>{first.toLocaleString('en-US')}–{last.toLocaleString('en-US')} من {data.total.toLocaleString('en-US')}</span><div className="flex gap-1"><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 disabled:opacity-40"><ChevronRight className="size-3.5" />السابق</button><button type="button" disabled={!data.hasMore || data.nextOffset == null} onClick={() => data.nextOffset != null && setOffset(data.nextOffset)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 disabled:opacity-40">التالي<ChevronLeft className="size-3.5" /></button></div></div> : null}
    </section>
  )
}

function EmptySearch() {
  return <section className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Search className="size-4" />اكتب نشاطاً مثل «مقاولات تشطيب» لعرض الجهات الحية.</span></section>
}
function Loading() {
  return <section className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" />جارٍ تحميل الجهات المطابقة…</section>
}
function SignInPrompt() {
  return <section className="rounded-xl border bg-card p-4"><div className="flex gap-3"><span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><ShieldCheck className="size-4" /></span><div><h2 className="text-sm font-semibold">سجّل الدخول لعرض الجهات</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">تظل بيانات السوق العامة ظاهرة، أما أسماء الجهات ومواقعها فتحتاج جلسة حسابك.</p><Link href="/login?next=/opportunity-map" className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">تسجيل الدخول</Link></div></div></section>
}
function Notice({ tone, text }: { tone: 'warning' | 'error'; text: string }) {
  return <section className={`rounded-xl border p-4 text-sm ${tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-amber-500/30 bg-amber-50 text-amber-900'}`}>{text}</section>
}
function EntityRow({ entity, selected, onToggle }: { entity: LiveEntity; selected: boolean; onToggle?: (id: string) => void }) {
  const fit = entity.fit === 'L' ? 'مطابقة قوية' : entity.fit === 'M' ? 'مطابقة محتملة' : null
  return <li className="py-3 first:pt-0 last:pb-0"><div className="flex gap-2.5"><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Building2 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-medium">{entity.name}</p>{fit ? <span className="shrink-0 text-[11px] font-medium text-primary">{fit}</span> : null}</div><p className="mt-0.5 truncate text-xs text-muted-foreground">{entity.category}</p><div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{entity.district ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{entity.district}</span> : null}{entity.whatsapp ? <span className="inline-flex items-center gap-1 text-foreground/75"><MessageCircle className="size-3 text-primary" />إشارة واتساب</span> : null}</div>{entity.reason ? <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{entity.reason}</p> : null}</div>{onToggle ? <button type="button" onClick={() => onToggle(entity.id)} className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${selected ? 'border-primary bg-primary text-primary-foreground' : 'text-primary hover:bg-accent'}`}>{selected ? 'محددة' : 'تحديد'}</button> : null}</div></li>
}
