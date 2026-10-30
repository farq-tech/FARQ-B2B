'use client'

import { useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import { RELEASE } from '@/lib/release'

const KEY = 'atlas.whats-new'
// set once a visitor has been through the map's first-visit tour (map-onboarding.tsx)
const ONBOARDING_KEY = 'atlas.onboarding.map'

/**
 * One line on what changed in this release, until the visitor closes it; it stays closed until the next release.
 * A first visit has nothing to compare with, and the map's goal question is already open, so the release counts as
 * seen without the bar.
 */
export function WhatsNew() {
  // hidden until mounted, so the server render and a visitor who closed it never flash the bar
  const [open, setOpen] = useState(false)
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
    <aside aria-label="ما الجديد" className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-lg items-start gap-3 rounded-2xl border bg-card/95 p-3 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-300 lg:start-6 lg:end-auto lg:bottom-6 lg:mx-0">
      <Megaphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">ما الجديد · {RELEASE.name}</p>
        <p className="text-sm leading-7 text-muted-foreground">{RELEASE.note}</p>
      </div>
      <button onClick={close} aria-label="إغلاق «ما الجديد»" className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        <X className="size-4" aria-hidden />
      </button>
    </aside>
  )
}
