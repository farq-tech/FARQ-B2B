import { lazy, Suspense, useEffect, useState } from 'react'

// The canvas engine is its own chunk and is only requested after the page has painted once.
const Canvas = lazy(() => import('./LiveBackgroundCanvas'))

// Dev preview of all three tones: /live-bg (mounted from main.tsx, not part of the build).
export default function LiveBackground() {
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    let b = 0
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setPainted(true)) })
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
  }, [])
  if (!painted) return null
  return <Suspense fallback={null}><Canvas /></Suspense>
}
