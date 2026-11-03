'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bookmark, BookmarkCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate, makeId } from '@/lib/format'
import { numberFormat } from '@/lib/insights-api'
import { safeMapOrigin } from '@/lib/handoff'
import { cleanName, defaultName } from '@/lib/saved-views'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { trackComparisonSaved } from '@/lib/commercial-metrics'

/**
 * «قارن حيين» kept by name inside Atlas (docs/atlas-product-foundation.md §3.4): the comparison on screen is saved
 * with the name the person gives it (its districts by default), and every saved one reopens on the map as it was,
 * worked out again from today's numbers. No figure is stored, nothing is exported; a saved comparison is shared by
 * its link inside the platform («انسخ الرابط»).
 */
export function SavedComparisons({ city, cityName, districts, here, onOpen }: {
  city: string
  cityName: string
  /** The two districts on screen, by name; fewer than two and there is nothing to save yet. */
  districts: string[]
  /** The map's address as it is now (read when saving, after the address has caught up with the picks). */
  here: () => string
  /** Opens a saved comparison's address on the map. */
  onOpen: (href: string) => void
}) {
  const { views, saveComparison } = useAppStore()
  const offered = defaultName(districts)
  const [name, setName] = useState<string | null>(null)
  const typed = name ?? offered
  const current = safeMapOrigin(here())
  const saved = current ? views.find((view) => view.href === current) ?? null : null
  const ready = districts.length === 2

  const save = () => {
    const href = safeMapOrigin(here())
    const clean = cleanName(typed) || offered
    if (!href || !clean) return
    saveComparison({ id: makeId('cmpv'), name: clean, href, city, cityName, districts, createdAt: new Date().toISOString() })
    setName(null)
    trackComparisonSaved({ city, saved: views.length + (saved ? 0 : 1) })
    toast.success(`حُفظت «${clean}»`, { description: 'تجدها هنا في «المقارنات المحفوظة»، وتُحسب من أرقام اليوم كلما فتحتها.' })
  }

  return (
    <section aria-label="المقارنات المحفوظة" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      {ready && (saved && name == null ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-primary">
          <BookmarkCheck className="size-4 shrink-0" aria-hidden />محفوظة باسم «{saved.name}»
          <button type="button" onClick={() => setName(saved.name)} className="ms-auto text-sm font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">غيّر الاسم</button>
        </p>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); save() }}>
          <label className="flex flex-col gap-1 text-sm font-semibold">احفظ هذه المقارنة باسم
            <input value={typed} onChange={(event) => setName(event.target.value)} maxLength={80}
              className="h-10 rounded-lg border bg-background px-3 text-base font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <button type="submit" disabled={!cleanName(typed)} className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <Bookmark className="size-4" aria-hidden />{saved ? 'احفظ بالاسم الجديد' : 'احفظ المقارنة'}
          </button>
        </form>
      ))}
      <SavedList current={current} onOpen={onOpen} />
    </section>
  )
}

/**
 * The saved comparisons, newest first: each opens on the map as it was (on the map itself through `onOpen`, from any
 * other page as a link to its address) and is deleted with one tap. `hideEmpty` leaves nothing where none is saved.
 */
export function SavedList({ current = null, onOpen, hideEmpty = false, heading = 'h3' }: {
  current?: string | null
  onOpen?: (href: string) => void
  hideEmpty?: boolean
  heading?: 'h2' | 'h3'
}) {
  const { views, removeComparison } = useAppStore()
  if (hideEmpty && !views.length) return null
  const Heading = heading
  return (
    <div className="flex flex-col gap-1.5">
      <Heading className="text-sm font-semibold text-muted-foreground">المقارنات المحفوظة{views.length ? ` (${numberFormat.format(views.length)})` : ''}</Heading>
      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا مقارنة محفوظة بعد. اختر حيين ثم احفظ المقارنة باسم تعرفه.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {views.map((view) => {
            const look = 'flex min-w-0 flex-1 flex-col text-start outline-none focus-visible:ring-2 focus-visible:ring-ring'
            const body = <>
              <span className="truncate font-semibold">{view.name}</span>
              <span className="truncate text-xs text-muted-foreground">{view.cityName} · {view.districts.join('، ')} · {formatDate(view.createdAt)}</span>
            </>
            return (
              <li key={view.id} className={cn('flex items-center gap-2 py-2', view.href === current && 'text-primary')}>
                {onOpen
                  ? <button type="button" onClick={() => onOpen(view.href)} aria-current={view.href === current ? 'true' : undefined} className={look}>{body}</button>
                  : <Link href={view.href} className={look}>{body}</Link>}
                <button type="button" onClick={() => removeComparison(view.id)} aria-label={`احذف «${view.name}»`}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-10">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
