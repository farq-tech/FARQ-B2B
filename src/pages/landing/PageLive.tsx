import { useEffect, useRef, useState } from 'react'
import '../../live-bg/live-bg.css'
import './layers.css'

/*
 * The landing's one living layer (owner, 2026-10-08; reference docs/reference/landing-live-network.html):
 * one network, one head office and one round for the whole page. A screen-sized fixed canvas above the section
 * backgrounds and below their content (layers.css) draws the part of the page-sized world that is on screen.
 * The engine is its own chunk, requested in idle time after the hero has painted, so it never competes with LCP.
 */
export default function PageLive({ root }: { root: HTMLElement | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 200))
    const id = idle(() => setReady(true))
    return () => { (window.cancelIdleCallback ?? window.clearTimeout)(id as number) }
  }, [])
  useEffect(() => {
    if (!ready || !root || !canvas.current) return
    let net: { destroy(): void } | null = null, gone = false
    void import('../../live-bg/pageNetwork').then(({ PageNetwork }) => {
      if (gone || !canvas.current) return
      const n = new PageNetwork(canvas.current, root); net = n
      if (import.meta.env.DEV) ((window as unknown as { __liveBg?: Record<string, unknown> }).__liveBg ??= {}).page = n // QA hook
    })
    return () => { gone = true; net?.destroy() }
  }, [ready, root])
  return (
    <div className="live-bg live-bg--page" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  )
}
