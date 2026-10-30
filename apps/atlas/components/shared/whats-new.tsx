'use client'

import { useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import { RELEASE } from '@/lib/release'
import { cn } from '@/lib/utils'

const KEY = 'atlas.whats-new'
// set once a visitor has been through the map's first-visit tour (map-onboarding.tsx)
const ONBOARDING_KEY = 'atlas.onboarding.map'

/**
 * One line on what changed in this release, until the visitor closes it; it stays closed until the next release.
 * A first visit has nothing to compare with, and the map's goal question is already open, so the release counts as
 * seen without the bar.
 */
export function WhatsNew({ onMap = false }: {
  /** On the map a phone's bottom sheet holds the steps, so the bar sits at the map's top, under the city and lens row. */
  onMap?: boolean
}) {
  // hidden until mounted, so the server render and a visitor who closed it never flash the bar
  const [open, setOpen] = useState(false)
  // on a phone the bar is one line over the map's steps; the note opens on a tap
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    try {
      const seen = localStorage.getItem(KEY)
      if (seen === null && localStorage.getItem(ONBOARDING_KEY) === null) localStorage.setItem(KEY, RELEASE.id)
      else setOpen(seen !== RELEASE.id)
    } catch { setOpen(false) }
  }, [])
  if (!open) return null
  const close = () => {
    setOpen(false)
    try { localStorage.setItem(KEY, RELEASE.id) } catch { /* private window: it shows again next visit */ }
  }
  return (
    <aside aria-label="ما الجديد" className={cn('fixed inset-x-3 z-40 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border bg-card/95 px-3 py-1 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-300 lg:start-6 lg:end-auto lg:bottom-6 lg:mx-0 lg:items-start lg:py-3', onMap ? 'top-[11.75rem] slide-in-from-top-2 lg:top-auto' : 'bottom-20')}>
      <Megaphone className="size-5 shrink-0 text-primary lg:mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setExpanded((was) => !was)} aria-expanded={expanded}
          className="w-full truncate py-1.5 text-start text-sm font-bold lg:pointer-events-none lg:py-0">ما الجديد · {RELEASE.name}</button>
        <p className={cn('text-sm leading-7 text-muted-foreground lg:block', expanded ? 'block pb-1.5' : 'hidden')}>{RELEASE.note}</p>
      </div>
      <button onClick={close} aria-label="إغلاق «ما الجديد»" className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        <X className="size-4" aria-hidden />
      </button>
    </aside>
  )
}
