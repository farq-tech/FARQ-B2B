'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Where an entry pushed for an open window says which window it is. */
const KEY = 'atlasModal'

/**
 * A window (a review, a send confirmation) that the browser's Back closes, as a phone's Back is expected to: opening
 * it pushes one history entry, Back closes it, and closing it any other way steps back over that entry so the page is
 * not left with an empty one. `name` tells this window's entry from another's.
 */
export function useBackClose(name: string): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(false)
  const pushed = useRef(false)
  useEffect(() => {
    const onPop = () => {
      // Back landed on the page under the window: the window closes
      if (pushed.current && (window.history.state as Record<string, unknown> | null)?.[KEY] !== name) {
        pushed.current = false
        setOpenState(false)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [name])
  // leaving the page with the window open drops nothing: its entry stays behind it, harmless
  const setOpen = useCallback((next: boolean) => {
    if (next) {
      if (!pushed.current) {
        window.history.pushState({ [KEY]: name }, '', window.location.href)
        pushed.current = true
      }
      setOpenState(true)
      return
    }
    setOpenState(false)
    if (pushed.current && (window.history.state as Record<string, unknown> | null)?.[KEY] === name) {
      pushed.current = false
      window.history.back()
    }
  }, [name])
  return [open, setOpen]
}
