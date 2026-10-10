import { useEffect, useState } from 'react'

/*
 * الشايب (Ahmad 3D, the same sheet as the living background — src/assets/live-bg/ahmad3d-run-sheet.webp:
 * 111×160 frames, 16-frame run rows in the order S SE E NE N NW W SW, then a standing row S SE SW).
 * Moods follow the visitor: idle = standing, ready = turned to the box while they type, working = running
 * while the search runs, found = facing them with the result. Calm: no jumps, no spins.
 * prefers-reduced-motion: always the still standing frame.
 */
export type ShayebMood = 'idle' | 'ready' | 'working' | 'found'

const FW = 111, FH = 160, COLS = 16, ROWS = 9
const H = 108
const STAND = 8           // standing row: 0 S · 1 SE · 2 SW

let sheetUrl: string | null = null
async function loadSheet() {
  if (sheetUrl) return sheetUrl
  const m = await import('../../../assets/live-bg/ahmad3d-run-sheet.webp?no-inline')
  sheetUrl = m.default as string
  return sheetUrl
}

const RUN_ROW = { S: 0, SE: 1, E: 2, NE: 3, N: 4, NW: 5, W: 6, SW: 7 } as const
export type ShayebDir = keyof typeof RUN_ROW

export default function Shayeb({ mood, dir = 'W', height = H }: { mood: ShayebMood; dir?: ShayebDir; height?: number }) {
  const [url, setUrl] = useState<string | null>(sheetUrl)
  const [frame, setFrame] = useState(0)
  const [reduce] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  // the sheet is large: fetch it after the page has painted
  useEffect(() => {
    if (url) return
    const go = () => void loadSheet().then(setUrl)
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(go); else window.setTimeout(go, 600)
  }, [url])

  // run cycle only while working
  useEffect(() => {
    if (mood !== 'working' || reduce) return
    let raf = 0, last = performance.now(), acc = 0
    const tick = (t: number) => {
      acc += t - last; last = t
      if (acc > 1000 / 14) { setFrame((f) => (f + 1) % COLS); acc = 0 }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mood])

  const working = mood === 'working' && !reduce
  const row = working ? RUN_ROW[dir] : STAND
  const col = working ? frame : mood === 'ready' ? (dir === 'E' || dir === 'SE' ? 1 : 2) : 0
  const k = height / FH
  return (
    <div aria-hidden="true" className={mood === 'idle' && !reduce ? 'shayeb-breathe shrink-0' : 'shrink-0'}
      style={{
        width: Math.round(FW * k), height,
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: `${FW * COLS * k}px ${FH * ROWS * k}px`,
        backgroundPosition: `-${col * FW * k}px -${row * FH * k}px`,
        backgroundRepeat: 'no-repeat',
        transition: 'opacity .3s',
        opacity: url ? 1 : 0,
      }} />
  )
}
