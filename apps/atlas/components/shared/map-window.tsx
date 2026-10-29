'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { GripHorizontal, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// the smallest a window can be pulled to, and below which it folds into a tab when let go
const MIN_W = 160, MIN_H = 120, FOLD_W = 240, FOLD_H = 200

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * A card over the map that behaves like a Mac window: dragged by its top bar anywhere within the map, resized from its
 * bottom-left corner (its end in Arabic), red closes it, yellow (or pulling it smaller than a readable card) folds it
 * into a tab at the foot of the map, and the tab opens it again at the size it had. Position and size stay as they
 * were put while the window stays mounted, so the next item opens where the last one was.
 */
export function MapWindow({ label, onClose, tab, children, className }: {
  label: string
  onClose: () => void
  /** What the folded tab shows: a thumbnail and one or two short lines. */
  tab: ReactNode
  children: ReactNode
  className?: string
}) {
  const card = useRef<HTMLElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [folded, setFolded] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; min: [number, number]; max: [number, number] } | null>(null)
  const grow = useRef<{ x: number; y: number; w: number; h: number; ox: number; oy: number; maxW: number; maxH: number } | null>(null)

  const bounds = (ox: number, oy: number) => {
    const box = card.current?.getBoundingClientRect(), area = card.current?.parentElement?.getBoundingClientRect()
    if (!box || !area) return { min: [ox, oy] as [number, number], max: [ox, oy] as [number, number] }
    return { min: [ox + area.left - box.left, oy + area.top - box.top] as [number, number], max: [ox + area.right - box.right, oy + area.bottom - box.bottom] as [number, number] }
  }
  // a card that grows after it was moved (a taller listing, «حول العقار» opened) is pulled back inside the map, so its
  // bar and its buttons never end up past the map's edge
  const fit = () => {
    if (drag.current || grow.current) return
    setOffset((current) => {
      const { min, max } = bounds(current.x, current.y)
      const x = clamp(current.x, min[0], Math.max(min[0], max[0])), y = clamp(current.y, min[1], Math.max(min[1], max[1]))
      return x === current.x && y === current.y ? current : { x, y }
    })
  }
  useEffect(() => {
    const node = card.current
    if (!node || folded) return
    const watch = new ResizeObserver(fit)
    watch.observe(node)
    return () => watch.disconnect()
  }, [folded])

  const start = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('[data-window-button]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y, ...bounds(offset.x, offset.y) }
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    setOffset({ x: clamp(d.ox + event.clientX - d.x, d.min[0], d.max[0]), y: clamp(d.oy + event.clientY - d.y, d.min[1], d.max[1]) })
  }
  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key]
    if (!step) return
    event.preventDefault()
    const { min, max } = bounds(offset.x, offset.y)
    setOffset({ x: clamp(offset.x + step[0], min[0], max[0]), y: clamp(offset.y + step[1], min[1], max[1]) })
  }
  const startGrow = (event: PointerEvent<HTMLButtonElement>) => {
    const box = card.current?.getBoundingClientRect(), area = card.current?.parentElement?.getBoundingClientRect()
    if (!box || !area) return
    event.currentTarget.setPointerCapture(event.pointerId)
    grow.current = { x: event.clientX, y: event.clientY, w: box.width, h: box.height, ox: offset.x, oy: offset.y, maxW: area.width - 24, maxH: area.height - 24 }
  }
  const moveGrow = (event: PointerEvent<HTMLButtonElement>) => {
    const g = grow.current
    if (!g) return
    const w = clamp(g.w - (event.clientX - g.x), MIN_W, g.maxW), h = clamp(g.h + (event.clientY - g.y), MIN_H, g.maxH)
    setSize({ w, h })
    // the window is centred and pinned to the bottom: shift it so its top-right corner stays where it was
    setOffset({ x: g.ox - (w - g.w) / 2, y: g.oy + (h - g.h) })
  }
  const endGrow = () => {
    const g = grow.current
    grow.current = null
    if (!g || !size) return
    if (size.w < FOLD_W || size.h < FOLD_H) { setSize({ w: g.w, h: g.h }); setOffset({ x: g.ox, y: g.oy }); setFolded(true); return }
    // resize notices were ignored while the corner was held: fit once it is let go, after the new size is drawn
    requestAnimationFrame(fit)
  }

  if (folded) {
    // above the foot of the map, clear of the phone's list/map switch and the colour key
    return (
      <div className="absolute start-3 bottom-16 z-10 flex max-w-[75%] items-center gap-2 rounded-full border bg-card py-1 ps-1 pe-1.5 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
        <button onClick={() => setFolded(false)} aria-label={`افتح: ${label}`} className="flex min-w-0 items-center gap-2 rounded-full text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          {tab}
        </button>
        <button onClick={onClose} aria-label={`أغلق: ${label}`} className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-4" aria-hidden /></button>
      </div>
    )
  }

  return (
    <article ref={card} aria-label={label}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)`, ...(size ? { width: size.w, height: size.h, maxWidth: 'none', maxHeight: 'none' } : {}) }}
      className={cn('absolute inset-x-3 bottom-3 z-10 mx-auto max-h-[85%] max-w-sm overflow-y-auto rounded-2xl border bg-card shadow-xl', className)}>
      <div onPointerDown={start} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
        className="sticky top-0 z-[5] flex h-8 w-full cursor-grab touch-none items-center justify-center bg-card/90 backdrop-blur active:cursor-grabbing">
        {/* the Mac's window buttons, where the Mac puts them */}
        {/* each dot is the Mac's 14px, inside a 32px button so a finger finds it on a phone */}
        <div dir="ltr" className="group absolute top-1/2 left-1 flex -translate-y-1/2">
          <button data-window-button onClick={onClose} aria-label={`أغلق: ${label}`} className="grid size-8 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="grid size-3.5 place-items-center rounded-full bg-[#ff5f57] text-[#4d0000] ring-1 ring-black/10">
              <X className="size-2.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" strokeWidth={3} aria-hidden />
            </span>
          </button>
          <button data-window-button onClick={() => setFolded(true)} aria-label={`صغّر إلى تبويب: ${label}`} className="-ms-2 grid size-8 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="grid size-3.5 place-items-center rounded-full bg-[#febc2e] text-[#5a3d00] ring-1 ring-black/10">
              <Minus className="size-2.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" strokeWidth={3} aria-hidden />
            </span>
          </button>
        </div>
        <button type="button" onKeyDown={nudge} aria-label="اسحب لتحريك البطاقة فوق الخريطة" title="اسحب لتحريك البطاقة"
          className="grid h-full place-items-center px-3 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60">
          <GripHorizontal className="size-5" aria-hidden />
        </button>
      </div>
      {children}
      <button type="button" onPointerDown={startGrow} onPointerMove={moveGrow} onPointerUp={endGrow} onPointerCancel={endGrow}
        aria-label="اسحب لتكبير البطاقة أو تصغيرها" title="كبّر أو صغّر"
        className="sticky bottom-0 z-[5] -mt-8 mr-auto grid size-8 cursor-nesw-resize touch-none place-items-end justify-items-start p-1 text-muted-foreground/70 outline-none focus-visible:text-primary">
        <svg viewBox="0 0 20 20" className="size-5" aria-hidden><path d="M3 9 L11 17 M3 14 L6 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </article>
  )
}
