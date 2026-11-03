'use client'

import { useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import { RELEASE } from '@/lib/release'
import { cn } from '@/lib/utils'

const KEY = 'atlas.whats-new'
// set once a visitor has been through the map's first-visit tour (map-onboarding.tsx)
const ONBOARDING_KEY = 'atlas.onboarding.map'
const TOUR_EVENT = 'atlas:map-tour'

// whether the map's tour is showing a card or hint right now; the bar waits for it, so the two never stack
let tourShowing = false
/** Called by the map's tour (map-onboarding.tsx) whenever its card or hint appears or goes. */
export function setMapTourShowing(showing: boolean) {
  if (tourShowing === showing) return
  tourShowing = showing
  window.dispatchEvent(new Event(TOUR_EVENT))
}

// whether the map's phone sheet is pulled up to full height: the bar's spot under the filters is then the sheet's
// title and steps, so the bar steps aside until the sheet comes down
let sheetFull = false
/** Called by the map's sheet (map-sheet.tsx) whenever it reaches or leaves its full stop. */
export function setMapSheetFull(full: boolean) {
  if (sheetFull === full) return
  sheetFull = full
  window.dispatchEvent(new Event(TOUR_EVENT))
}

/**
 * One line on what changed in this release, until the visitor closes it; it stays closed until the next release.
 * A first visit has nothing to compare with, and the map's goal question is already open, so the release counts as
 * seen without the bar. On the map it never stacks on the tour: it waits while the tour's card or hint is showing.
 */
export function WhatsNew({ onMap = false }: {
  /** On the map a phone's bottom sheet holds the steps, so the bar sits at the map's top, under the city and lens row. */
  onMap?: boolean
}) {
  // hidden until mounted, so the server render and a visitor who closed it never flash the bar
  const [open, setOpen] = useState(false)
  // on a phone the bar is one line over the map's steps; the note opens on a tap
  const [expanded, setExpanded] = useState(false)
  // on the map the bar steps aside while the tour speaks, and comes back once it is done or dismissed
  const [tour, setTour] = useState(false)
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    const sync = () => { setTour(tourShowing); setCovered(sheetFull) }
    sync()
    window.addEventListener(TOUR_EVENT, sync)
    return () => window.removeEventListener(TOUR_EVENT, sync)
  }, [])
  useEffect(() => {
    try {
      const seen = localStorage.getItem(KEY)
      if (seen === null && localStorage.getItem(ONBOARDING_KEY) === null) localStorage.setItem(KEY, RELEASE.id)
      // release ids are dates (YYYY-MM-DD): a stored id this release or later counts as seen. Only an older one (or
      // none, for a returning visitor) opens the bar; an exact-match test reopened it for any other stored value
      else setOpen(seen == null || seen < RELEASE.id)
    } catch { setOpen(false) }
  }, [])
  if (!open || (onMap && tour)) return null
  const close = () => {
    setOpen(false)
    try { localStorage.setItem(KEY, RELEASE.id) } catch { /* private window: it shows again next visit */ }
  }
  return (
    <aside aria-label="ما الجديد" className={cn(onMap && covered && 'max-lg:hidden', 'fixed inset-x-3 z-40 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border bg-card/95 px-3 py-1 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-300 lg:mx-0 lg:items-start lg:py-3',
      // on the map's desktop it is one line in the map's top start corner (right in Arabic), which nothing else holds:
      // the copy-link and «؟» buttons sit at the top end corner, the key at the bottom, and the bar's note opens on a
      // click. It sat over the middle of the map's bottom, on the districts a visitor came to read, on every visit
      onMap ? 'top-[11.75rem] slide-in-from-top-2 lg:top-[10.25rem] lg:start-[1rem] lg:end-auto lg:items-center lg:py-1 lg:max-w-[min(28rem,calc(100vw-400px-14rem))]' : 'bottom-20 lg:start-6 lg:end-auto lg:bottom-6')}>
      <Megaphone className={cn('size-5 shrink-0 text-primary', !onMap && 'lg:mt-0.5')} aria-hidden />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setExpanded((was) => !was)} aria-expanded={expanded}
          className={cn('w-full truncate py-1.5 text-start text-sm font-bold', !onMap && 'lg:pointer-events-none lg:py-0')}>ما الجديد · {RELEASE.name}</button>
        <p className={cn('text-sm leading-7 text-muted-foreground', !onMap && 'lg:block', expanded ? 'block pb-1.5' : 'hidden')}>{RELEASE.note}</p>
      </div>
      <button onClick={close} aria-label="إغلاق «ما الجديد»" className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-4" aria-hidden />
      </button>
    </aside>
  )
}
