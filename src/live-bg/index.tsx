import { lazy, Suspense, useEffect, useState } from 'react'
import type { Tone } from './engine'

// The canvas engine is its own chunk and is only requested after the page has painted once.
const Canvas = lazy(() => import('./LiveBackgroundCanvas'))
// Dev-only preview at /live-bg (all three tones). `import.meta.env.DEV` is false in `vite build`, so this branch and its chunk are dropped.
const DevPage = import.meta.env.DEV ? lazy(() => import('./DevPage')) : null

export default function LiveBackground({ tone = 'light' }: { tone?: Tone }) {
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    let b = 0
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setPainted(true)) })
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
  }, [])
  if (DevPage && window.location.pathname === '/live-bg') return <Suspense fallback={null}><DevPage /></Suspense>
  if (!painted) return null
  return <Suspense fallback={null}><Canvas tone={tone} /></Suspense>
}
