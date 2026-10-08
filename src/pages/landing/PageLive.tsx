import { lazy, Suspense, useEffect, useState } from 'react'
import './layers.css'

/*
 * The landing's one living layer (owner, 2026-10-08): one network, one head office and one round for the whole page.
 * A screen-sized fixed canvas above the section backgrounds and below their content (layers.css) draws the part of
 * the page-sized world that is on screen. Requested after the hero has painted, so it never competes with LCP.
 */
const Canvas = lazy(() => import('../../live-bg/LiveBackgroundCanvas'))

export default function PageLive({ root }: { root: HTMLElement | null }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 200))
    const id = idle(() => setReady(true))
    return () => { (window.cancelIdleCallback ?? window.clearTimeout)(id as number) }
  }, [])
  if (!ready || !root) return null
  return <Suspense fallback={null}><Canvas mode="page" scope={root} /></Suspense>
}
