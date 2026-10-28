'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { numberFormat } from '@/lib/insights-api'

/**
 * The ad's photos full screen, from the one tapped: swipe sideways (or the arrows, or the keyboard) to the next, «x»
 * or Escape to close. Native scroll snapping does the swipe, so it follows the finger on every phone.
 */
export function Lightbox({ photos, start, onClose }: { photos: string[]; start: number; onClose: () => void }) {
  const strip = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(start)

  const go = (to: number) => {
    const node = strip.current
    if (!node) return
    const next = Math.max(0, Math.min(photos.length - 1, to))
    node.scrollTo({ left: next * node.clientWidth, behavior: 'smooth' })
  }

  useEffect(() => {
    const node = strip.current
    if (node) node.scrollLeft = start * node.clientWidth
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow }
  }, [start])

  useEffect(() => {
    // the strip runs left to right like the photos; in Arabic the right arrow still means «the next one»
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') go(index + 1)
      else if (event.key === 'ArrowRight') go(index - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="صور الإعلان" className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-white animate-in fade-in duration-200">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} aria-label="إغلاق الصور" className="grid size-10 place-items-center rounded-full bg-white/10 outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70">
          <X className="size-5" aria-hidden />
        </button>
        <span dir="ltr" className="text-sm tabular-nums" aria-live="polite">{numberFormat.format(index + 1)} / {numberFormat.format(photos.length)}</span>
      </div>
      <div ref={strip} dir="ltr" onScroll={(event) => setIndex(Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth))}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {photos.map((photo, i) => (
          <div key={photo} className="grid h-full w-full shrink-0 snap-center place-items-center px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt={`الصورة ${numberFormat.format(i + 1)}`} loading={Math.abs(i - start) <= 1 ? 'eager' : 'lazy'} className="max-h-full max-w-full object-contain" />
          </div>
        ))}
      </div>
      <div className="hidden justify-center gap-3 py-4 sm:flex">
        <button onClick={() => go(index - 1)} disabled={index === 0} aria-label="الصورة السابقة" className="grid size-11 place-items-center rounded-full bg-white/10 outline-none hover:bg-white/20 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-white/70">
          <ChevronRight className="size-5" aria-hidden />
        </button>
        <button onClick={() => go(index + 1)} disabled={index === photos.length - 1} aria-label="الصورة التالية" className="grid size-11 place-items-center rounded-full bg-white/10 outline-none hover:bg-white/20 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-white/70">
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  )
}
