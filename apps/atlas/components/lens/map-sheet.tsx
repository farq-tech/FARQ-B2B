'use client'

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { setMapSheetFull } from '@/components/shared/whats-new'
import { cn } from '@/lib/utils'
import { settle, type SheetSnap } from './sheet-snap'

export type { SheetSnap }

/** The sheet's height at each stop; the map above it ends at the peek height so its attribution stays in view. */
export const PEEK = '8.5rem'
/** The peek in pixels (8.5rem at the 16px root). */
export const PEEK_PX = 136
/** The share of the screen the half sheet covers. */
export const HALF = 0.55
/** The gap the full sheet leaves above it, so the map (and the way back to it) stays in sight. */
const FULL_GAP = 64
const NEXT: Record<SheetSnap, SheetSnap> = { peek: 'half', half: 'full', full: 'peek' }
const UP: Record<SheetSnap, SheetSnap> = { peek: 'half', half: 'full', full: 'full' }
const DOWN: Record<SheetSnap, SheetSnap> = { peek: 'peek', half: 'peek', full: 'half' }
const NAME: Record<SheetSnap, string> = { peek: 'مصغّرة', half: 'نصف الشاشة', full: 'كاملة' }

/**
 * The map's panel. On a phone it is a bottom sheet over a full-height map (the Google Maps and Airbnb pattern) with three
 * fixed stops: collapsed (the title and the steps), half the screen, and nearly all of it. Drag its handle, or tap it,
 * between them. The title and the steps (`header`) never scroll; only the body under them does, so scrolling never
 * pushes the steps away, and a collapsed sheet shows no half-scrolled body. From lg up it is the same panel as a fixed
 * column beside the map, and the snap does nothing.
 */
export function MapSheet({ snap, onSnap, title, summary, summaryAction, header, resetKey, panel, onPeek, children }: {
  snap: SheetSnap
  onSnap: (next: SheetSnap) => void
  title: ReactNode
  /** The step's answer in one line under the title, so a peeking sheet already says what the map shows. */
  summary?: ReactNode
  /** One control for that line (a failed step's retry), on a phone only: from lg the step's own notice has it. */
  summaryAction?: ReactNode
  /** What stays in view above the scrolling body at every stop, such as the journey's steps. */
  header?: ReactNode
  /** The body returns to its top when this changes (another step opened). */
  resetKey?: string
  /** The body as the tab panel of the header's open tab (its id, and the tab that names it). */
  panel?: { id: string; labelledBy: string } | null
  /** Told the collapsed stop's height as it measures (larger text or a wrapped title makes it taller than PEEK), so
   * the map can end above it instead of under it. */
  onPeek?: (px: number) => void
  children: ReactNode
}) {
  const sheet = useRef<HTMLElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  // `last`/`at` are the latest pointer sample, `prevY`/`prevAt` the one before: the release speed comes from them
  const drag = useRef<{ y: number; height: number; moved: boolean; prevY: number; prevAt: number; last: number; at: number } | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  // the collapsed stop fits the handle, the title and the steps as they measure (never less than PEEK)
  const [topHeight, setTopHeight] = useState(PEEK_PX)
  useEffect(() => {
    const el = top.current
    if (!el) return
    const watch = new ResizeObserver(() => setTopHeight(Math.ceil(el.getBoundingClientRect().height)))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const peek = Math.max(PEEK_PX, topHeight)
  const reportPeek = useRef(onPeek)
  reportPeek.current = onPeek
  useEffect(() => { reportPeek.current?.(peek) }, [peek])
  const heights: Record<SheetSnap, string> = { peek: `${peek}px`, half: `max(${peek}px, ${HALF * 100}%)`, full: `calc(100% - ${FULL_GAP}px)` }
  // a collapsed sheet starts its body from the top, and so does a newly opened step
  useEffect(() => { if (snap === 'peek' && body.current) body.current.scrollTop = 0 }, [snap])
  useEffect(() => { if (body.current) body.current.scrollTop = 0 }, [resetKey])
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
    // let go: a quick flick goes to the next stop past where the finger left the sheet, in its direction; otherwise
    // the nearest stop wins
    const box = sheet.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight
    const height = current.height + (current.y - event.clientY)
    const elapsed = performance.now() - current.prevAt
    const speed = elapsed > 0 && elapsed < 120 ? (current.prevY - event.clientY) / elapsed : 0
    setDragged(null)
    onSnap(settle(height, speed, { peek, half: Math.max(peek, box * HALF), full: box - FULL_GAP }))
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
      style={{ '--sheet-h': dragged != null ? `${dragged}px` : heights[snap] } as CSSProperties}
      className={cn(
        'absolute inset-x-0 bottom-0 z-20 flex h-[var(--sheet-h)] flex-col overflow-hidden rounded-t-3xl border-t bg-card shadow-[0_-12px_32px_-16px_rgb(23_42_30/0.35)]',
        dragged == null && 'transition-[height] duration-300 ease-out motion-reduce:transition-none',
        'lg:static lg:z-auto lg:h-auto lg:w-[400px] lg:overflow-visible lg:rounded-none lg:border-t-0 lg:border-s lg:bg-transparent lg:shadow-none lg:transition-none',
      )}
    >
      <div ref={top} className="flex shrink-0 flex-col pb-2 lg:pb-0">
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
          className="flex shrink-0 cursor-grab touch-none flex-col items-center gap-1 px-4 pt-2 pb-1.5 outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 active:cursor-grabbing lg:hidden"
        >
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
          <span className="w-full truncate text-center text-sm font-semibold">{title}</span>
          {summary && <span className="w-full truncate text-center text-sm text-muted-foreground tabular-nums">{summary}</span>}
        </div>
        {/* the line's one action (a failed step's «أعد المحاولة»), outside the handle so it is a control of its own */}
        {summaryAction && <div className="-mt-1 flex justify-center pb-1.5 lg:hidden">{summaryAction}</div>}
        {header && <div className="px-3 lg:pt-3">{header}</div>}
      </div>
      {/* collapsed, the body has no room and is hidden (and out of the tab order) rather than half-scrolled into view */}
      <div ref={body} data-sheet-body {...(panel ? { id: panel.id, role: 'tabpanel', 'aria-labelledby': panel.labelledBy } : {})}
        className={cn('flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 pt-1 lg:pt-3', snap === 'peek' && dragged == null && 'max-lg:invisible')}>
        {children}
      </div>
    </aside>
  )
}

