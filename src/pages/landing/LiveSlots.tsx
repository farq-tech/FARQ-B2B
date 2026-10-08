import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Tone } from '../../live-bg/engine'

/*
 * Mounts the living background into every `data-live-bg="deep|accent|light"` slot of the page
 * (docs/qa/requests.md B5). Only slots near the viewport get an engine, so a long page runs one or
 * two canvases at a time; the engine itself pauses off-screen and follows prefers-reduced-motion.
 * The canvas chunk is requested after the hero has painted (lazy), so it never competes with LCP.
 */
const Canvas = lazy(() => import('../../live-bg/LiveBackgroundCanvas'))

function Slot({ el }: { el: HTMLElement }) {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const io = new IntersectionObserver((es) => setNear(es[es.length - 1].isIntersecting), { rootMargin: '200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [el])
  if (!near) return null
  const tone = (el.dataset.liveBg as Tone) || 'light'
  // obstacles: the section that holds the slot (its text and cards stay clear of the network)
  return createPortal(<Suspense fallback={null}><Canvas tone={tone} fixed={false} scope={el.parentElement ?? undefined} /></Suspense>, el)
}

export default function LiveSlots({ root }: { root: HTMLElement | null }) {
  const [slots, setSlots] = useState<HTMLElement[]>([])
  useEffect(() => {
    if (!root) return
    let raf = 0
    const scan = () => { raf = 0; const found = Array.from(root.querySelectorAll<HTMLElement>('[data-live-bg]')); setSlots((s) => (s.length === found.length && s.every((x, i) => x === found[i]) ? s : found)) }
    const queue = () => { if (!raf) raf = requestAnimationFrame(scan) }
    // after first paint; the lower sections arrive later as their own chunk → rescan on DOM changes
    const t = window.setTimeout(scan, 0)
    const mo = new MutationObserver((rs) => { if (rs.some((r) => !(r.target instanceof Element) || !r.target.closest('[data-live-bg]'))) queue() })
    mo.observe(root, { childList: true, subtree: true })
    return () => { window.clearTimeout(t); cancelAnimationFrame(raf); mo.disconnect() }
  }, [root])
  return <>{slots.map((el, i) => <Slot key={i + (el.dataset.liveBg || '')} el={el} />)}</>
}
