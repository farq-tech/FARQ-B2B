'use client'

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { setMapSheetFull } from '@/components/shared/whats-new'
import { cn } from '@/lib/utils'

export type SheetSnap = 'peek' | 'half' | 'full'

/** The sheet's height at each stop; the map above it ends at the peek height so its attribution stays in view. */
export const PEEK = '8.5rem'
/** The peek in pixels (8.5rem at the 16px root). */
export const PEEK_PX = 136
/** The share of the screen the half sheet covers. */
export const HALF = 0.55
const HEIGHT: Record<SheetSnap, string> = { peek: PEEK, half: `${HALF * 100}%`, full: 'calc(100% - 4rem)' }
const NEXT: Record<SheetSnap, SheetSnap> = { peek: 'half', half: 'full', full: 'peek' }
const UP: Record<SheetSnap, SheetSnap> = { peek: 'half', half: 'full', full: 'full' }
const DOWN: Record<SheetSnap, SheetSnap> = { peek: 'peek', half: 'peek', full: 'half' }
/** A release faster than this (px per ms) is a flick: the sheet goes one stop on in its direction. */
const FLICK = 0.5
const NAME: Record<SheetSnap, string> = { peek: 'مصغّرة', half: 'نصف الشاشة', full: 'كاملة' }

/**
 * The map's panel. On a phone it is a bottom sheet over a full-height map (the Google Maps and Airbnb pattern): drag
 * its handle, or tap it, between a peek that shows the title and the steps, half the screen, and nearly all of it.
 * From lg up it is the same panel as a fixed column beside the map, and the snap does nothing.
 */
export function MapSheet({ snap, onSnap, title, summary, children }: {
  snap: SheetSnap
  onSnap: (next: SheetSnap) => void
  title: ReactNode
  /** The step's answer in one line under the title, so a peeking sheet already says what the map shows. */
  summary?: ReactNode
  children: ReactNode
}) {
  const sheet = useRef<HTMLElement>(null)
  // `last`/`at` are the latest pointer sample, `prevY`/`prevAt` the one before: the release speed comes from them
  const drag = useRef<{ y: number; height: number; moved: boolean; prevY: number; prevAt: number; last: number; at: number } | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  // a full sheet reaches up under the phone's filters, where «ما الجديد» sits: the bar steps aside meanwhile
  useEffect(() => { setMapSheetFull(snap === 'full') }, [snap])
  useEffect(() => () => setMapSheetFull(false), [])

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!sheet.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const now = performance.now()
    drag.current = { y: event.clientY, height: sheet.current.getBoundingClientRect().height, moved: false, prevY: event.clientY, prevAt: now, last: event.clientY, at: now }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    const rise = current.y - event.clientY
    current.prevY = current.last; current.prevAt = current.at
    current.last = event.clientY; current.at = performance.now()
    if (Math.abs(rise) > 6) current.moved = true
    if (current.moved) setDragged(Math.max(96, current.height + rise))
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    drag.current = null
    if (!current) return
    if (!current.moved) { onSnap(NEXT[snap]); return }
    // let go: a quick flick goes one stop on from where the sheet was, in its direction; otherwise the nearest stop wins
    const box = sheet.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight
    const height = current.height + (current.y - event.clientY)
    const elapsed = performance.now() - current.prevAt
    const speed = elapsed > 0 && elapsed < 120 ? (current.prevY - event.clientY) / elapsed : 0
    const stops: [SheetSnap, number][] = [['peek', PEEK_PX], ['half', box * HALF], ['full', box - 64]]
    const nearest = stops.reduce((best, stop) => (Math.abs(stop[1] - height) < Math.abs(best[1] - height) ? stop : best))[0]
    setDragged(null)
    onSnap(speed > FLICK ? UP[snap] : speed < -FLICK ? DOWN[snap] : nearest)
  }
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSnap(NEXT[snap]) }
    if (event.key === 'ArrowUp') { event.preventDefault(); onSnap(UP[snap]) }
    if (event.key === 'ArrowDown') { event.preventDefault(); onSnap(DOWN[snap]) }
    if (event.key === 'Escape' && snap !== 'peek') { event.preventDefault(); onSnap('peek') }
  }

  return (
    <aside
      ref={sheet}
      aria-label="لوحة الخريطة"
      style={{ '--sheet-h': dragged != null ? `${dragged}px` : HEIGHT[snap] } as CSSProperties}
      className={cn(
        'absolute inset-x-0 bottom-0 z-20 flex h-[var(--sheet-h)] flex-col rounded-t-3xl border-t bg-card shadow-[0_-12px_32px_-16px_rgb(23_42_30/0.35)]',
        dragged == null && 'transition-[height] duration-300 ease-out motion-reduce:transition-none',
        'lg:static lg:z-auto lg:h-auto lg:w-[400px] lg:rounded-none lg:border-t-0 lg:border-s lg:bg-transparent lg:shadow-none lg:transition-none',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`اللوحة ${NAME[snap]}، اسحبها أو اضغطها لتغيير حجمها`}
        aria-expanded={snap !== 'peek'}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => { drag.current = null; setDragged(null) }}
        onKeyDown={keys}
        className="flex shrink-0 cursor-grab touch-none flex-col items-center gap-1.5 px-4 pt-2 pb-1 outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 active:cursor-grabbing lg:hidden"
      >
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        <span className="w-full truncate text-center text-sm font-semibold">{title}</span>
        {summary && <span className="w-full truncate text-center text-sm text-muted-foreground tabular-nums">{summary}</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 pt-1 lg:pt-3">{children}</div>
    </aside>
  )
}
