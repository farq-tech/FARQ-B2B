'use client'

import Link from 'next/link'
import { Building2, Loader2, MapPin, MessageCircle, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LiveBusinessSnapshot } from '@/lib/types'

export type DirectoryObjective = 'purchase' | 'marketing'

export type LiveEntity = LiveBusinessSnapshot & {
  verification: 'verified' | 'unverified' | 'unknown' | null
  roles: string[]
  specialties: string[]
  status: string | null
}

type Result = { total: number; withWhatsapp: number; hasMore?: boolean; nextOffset?: number | null; mapQuery?: string | null; rows: LiveEntity[] }
export type DirectorySummary = Pick<Result, 'total' | 'withWhatsapp'>

export type DirectoryLoadState = 'idle' | 'loading' | 'ready' | 'auth' | 'blocked' | 'error'
type State = { kind: DirectoryLoadState; data: Result | null; message?: string }

export function LiveEntityResults({ query, cityId, objective, district, onResults, onSummary, onMapQuery, onStateChange, selectedIds = [], onToggle }: { query: string; cityId: string; objective: DirectoryObjective; district?: string; onResults?: (rows: LiveEntity[]) => void; onSummary?: (summary: DirectorySummary | null) => void; onMapQuery?: (mapQuery: string | null) => void; onStateChange?: (state: DirectoryLoadState) => void; selectedIds?: string[]; onToggle?: (id: string) => void }) {
  const [state, setState] = useState<State>({ kind: 'idle', data: null })
  const [visibleCount, setVisibleCount] = useState(100)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q && !district) { setState({ kind: 'idle', data: null }); return }
    const controller = new AbortController()
    setVisibleCount(100)
    setLoadingMore(false)
    setState({ kind: 'loading', data: null })

    const load = async () => {
      const response = await fetch('/api/market/entities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q, city: cityId, objective, limit: 200, offset: 0, ...(district ? { district } : {}) }),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null) as (Result & { error?: string }) | null
      if (response.status === 401) { setState({ kind: 'auth', data: null, message: payload?.error }); return }
      if (response.status === 403) { setState({ kind: 'blocked', data: null, message: payload?.error }); return }
      if (!response.ok || !payload) { setState({ kind: 'error', data: null, message: payload?.error || 'تعذر تحميل الجهات.' }); return }
      setState({ kind: 'ready', data: { ...payload, withWhatsapp: Number.isFinite(payload.withWhatsapp) ? payload.withWhatsapp : payload.rows.filter((entity) => entity.whatsapp).length } })
    }
    load().catch((error) => { if (!controller.signal.aborted) setState({ kind: 'error', data: null, message: error instanceof Error && error.name === 'AbortError' ? undefined : 'تعذر الاتصال بخدمة الدليل.' }) })
    return () => controller.abort()
  }, [query, cityId, objective, district])

  useEffect(() => { onResults?.(state.data?.rows ?? []) }, [onResults, state.data])
  useEffect(() => { onSummary?.(state.data ? { total: state.data.total, withWhatsapp: state.data.withWhatsapp } : null) }, [onSummary, state.data])
  useEffect(() => { onMapQuery?.(state.data?.mapQuery ?? null) }, [onMapQuery, state.data])
  useEffect(() => { onStateChange?.(state.kind) }, [onStateChange, state.kind])

  async function loadMore() {
    const data = state.data
    const offset = data?.nextOffset
    if (!data?.hasMore || typeof offset !== 'number' || loadingMore) return
    setLoadingMore(true)
    try {
      const response = await fetch('/api/market/entities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query.trim(), city: cityId, objective, limit: 200, offset, ...(district ? { district } : {}) }),
      })
      const payload = await response.json().catch(() => null) as (Result & { error?: string }) | null
      if (!response.ok || !payload) throw new Error(payload?.error || 'تعذر تحميل الدفعة التالية.')
      setState((current) => {
        if (!current.data) return current
        const seen = new Set(current.data.rows.map((entity) => entity.id))
        const rows = [...current.data.rows, ...payload.rows.filter((entity) => !seen.has(entity.id))]
        return { kind: 'ready', data: { ...payload, total: payload.total, withWhatsapp: rows.filter((entity) => entity.whatsapp).length, rows } }
      })
    } catch (error) {
      setState((current) => current.data ? { ...current, message: error instanceof Error ? error.message : 'تعذر تحميل الدفعة التالية.' } : current)
    } finally { setLoadingMore(false) }
  }

  if (state.kind === 'idle') return <EmptySearch />
  if (state.kind === 'loading' && !state.data) return <Loading />
  if (state.kind === 'auth') return <SignInPrompt district={district} />
  if (state.kind === 'blocked') return <Notice tone="warning" text={state.message || 'لا يملك هذا الحساب صلاحية دليل الجهات.'} />
  if (state.kind === 'error') return <Notice tone="error" text={state.message || 'تعذر تحميل الجهات.'} />
  const data = state.data
  if (!data) return null
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="الجهات المطابقة">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">{district && !query.trim() ? 'جهات الحي' : 'الجهات المطابقة'}</h2><p className="mt-1 text-xs text-muted-foreground">{district ? `نتائج حية داخل ${district}؛ لا نعرض أرقام الاتصال في هذه المرحلة.` : 'نتائج حية للاطلاع؛ لا نعرض أرقام الاتصال في هذه المرحلة.'}</p></div>
        <span className="rounded-full bg-accent px-2 py-1 text-xs font-medium text-accent-foreground tabular-nums">{data.total.toLocaleString('en-US')}</span>
      </div>
      {state.message ? <p className="mt-2 text-xs text-destructive">{state.message}</p> : null}
      {data.rows.length ? <>
        <ul className="mt-3 flex flex-col divide-y">{data.rows.slice(0, visibleCount).map((entity) => <EntityRow key={entity.id} entity={entity} selected={selectedIds.includes(entity.id)} onToggle={onToggle} />)}</ul>
        {visibleCount < data.rows.length ? <button type="button" className="mt-3 w-full rounded-md border px-3 py-2 text-sm font-medium text-primary hover:bg-accent" onClick={() => setVisibleCount((count) => Math.min(data.rows.length, count + 100))}>عرض 100 جهة إضافية</button> : null}
        {data.hasMore ? <button type="button" className="mt-2 w-full rounded-md border px-3 py-2 text-sm font-medium text-primary hover:bg-accent disabled:opacity-60" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'جارٍ تحميل جهات إضافية…' : 'تحميل 200 جهة إضافية'}</button> : null}
      </> : <p className="mt-3 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">لم نجد جهات تطابق هذا النشاط ضمن النطاق.</p>}
    </section>
  )
}

function EmptySearch() {
  return <section className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Search className="size-4" />اكتب نشاطاً مثل «مقاولات تشطيب» لعرض الجهات الحية.</span></section>
}
function Loading() {
  return <section className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" />جارٍ تحميل الجهات المطابقة…</section>
}
function SignInPrompt({ district }: { district?: string }) {
  const next = district ? `/opportunity-map?goal=explore&district=${encodeURIComponent(district)}` : '/opportunity-map'
  return <section className="rounded-xl border bg-card p-4"><div className="flex gap-3"><span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><ShieldCheck className="size-4" /></span><div><h2 className="text-sm font-semibold">سجّل الدخول لعرض الجهات</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">تظل بيانات السوق العامة ظاهرة، أما أسماء الجهات ومواقعها فتحتاج جلسة حسابك.</p><Link href={`/login?next=${encodeURIComponent(next)}`} className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">تسجيل الدخول</Link></div></div></section>
}
function Notice({ tone, text }: { tone: 'warning' | 'error'; text: string }) {
  return <section className={`rounded-xl border p-4 text-sm ${tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-amber-500/30 bg-amber-50 text-amber-900'}`}>{text}</section>
}
function EntityRow({ entity, selected, onToggle }: { entity: LiveEntity; selected: boolean; onToggle?: (id: string) => void }) {
  const fit = entity.fit === 'L' ? 'مطابقة قوية' : entity.fit === 'M' ? 'مطابقة محتملة' : null
  return <li className="py-3 first:pt-0 last:pb-0"><div className="flex gap-2.5"><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Building2 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-medium">{entity.name}</p>{fit ? <span className="shrink-0 text-[11px] font-medium text-primary">{fit}</span> : null}</div><p className="mt-0.5 truncate text-xs text-muted-foreground">{entity.category}</p><div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{entity.district ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{entity.district}</span> : null}{entity.whatsapp ? <span className="inline-flex items-center gap-1 text-foreground/75"><MessageCircle className="size-3 text-primary" />إشارة واتساب</span> : null}</div>{entity.reason ? <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{entity.reason}</p> : null}</div>{onToggle ? <button type="button" onClick={() => onToggle(entity.id)} className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${selected ? 'border-primary bg-primary text-primary-foreground' : 'text-primary hover:bg-accent'}`}>{selected ? 'محددة' : 'تحديد'}</button> : null}</div></li>
}
