import { useEffect, useRef, useState } from 'react'
import LiveBackgroundCanvas from './LiveBackgroundCanvas'
import type { LiveEngine, Tone } from './engine'

/*
 * Dev-only preview: /live-bg shows the three tones; /live-bg?tone=deep&full=1 fills the window with one
 * tone (used for the QA recordings); &layout=cards swaps the hero for a list-screen-like layout (title, cards, table). Each stage reports its draw time per frame (avg · p95 · max).
 */
const TONES: Array<[Tone, string]> = [['light', 'فاتح'], ['deep', 'غامق'], ['accent', 'نعناعي']]

function Stage({ tone, full, reduced }: { tone: Tone; full: boolean; reduced: boolean | undefined }) {
  const cards = new URLSearchParams(window.location.search).get('layout') === 'cards'
  const engine = useRef<LiveEngine | null>(null)
  const [stat, setStat] = useState('')
  const [scope, setScope] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = engine.current?.stats()
      if (s && s.frames) setStat(`${s.frames} إطار · متوسط ${s.avg.toFixed(2)}ms · p95 ${s.p95.toFixed(2)}ms · p99 ${s.p99.toFixed(2)}ms · أعلى ${s.max.toFixed(2)}ms · جولات ${s.rounds} (أحمد: بعيد ${s.far} · أقرب ${s.near} · قعد ${s.none})`)
    }, 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <section ref={setScope} className="flex flex-col gap-2">
      {!full && <p className="text-[13px] text-ink-2">{TONES.find((t) => t[0] === tone)?.[1]} — <span dir="ltr" data-stat>{stat}</span></p>}
      <div data-tone={tone === 'light' ? undefined : tone} className={full ? 'relative h-screen w-full overflow-hidden' : 'relative aspect-[390/600] w-full overflow-hidden rounded-[20px] border border-line sm:aspect-[1440/800]'}>
        {scope && <LiveBackgroundCanvas scope={scope} tone={tone} fixed={false} reducedMotion={reduced} onEngine={(e) => { engine.current = e; (window as unknown as { __liveBg?: Record<string, unknown> }).__liveBg = { ...(window as unknown as { __liveBg?: Record<string, unknown> }).__liveBg, [tone]: e } }} />}
        {cards ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-end gap-6 p-8">
            <h1 className="font-display text-[32px] leading-[48px] font-bold text-ink">طلبات التسعير</h1>
            <div className="flex w-full flex-wrap justify-end gap-4">{[1, 2, 3].map((i) => <div key={i} className="h-[88px] w-[220px] rounded-[16px] border border-line bg-surface" />)}</div>
            <div className="h-[320px] w-full max-w-[1000px] rounded-[24px] border border-line bg-surface" />
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[14px] p-6 text-center">
            <h1 className="font-display text-[clamp(24px,4.2vw,48px)] leading-tight font-bold text-ink">وش تبي نسعّر لك اليوم؟</h1>
            <div className="w-[min(520px,100%)] rounded-[14px] border border-line bg-surface px-[18px] py-[14px] text-right text-[16px] shadow-md" style={{ color: 'var(--color-text-tertiary)' }}>اكتب اللي تبيه… مثال: 500 حبة بلك أسمنتي</div>
          </div>
        )}
        {full && <p className="absolute bottom-2 left-3 text-[12px] text-ink-2 opacity-70" dir="ltr" data-stat>{stat}</p>}
      </div>
    </section>
  )
}

export default function DevPage() {
  const q = new URLSearchParams(window.location.search)
  const only = q.get('tone') as Tone | null
  const full = q.get('full') === '1'
  // undefined = follow the OS setting (prefers-reduced-motion); true = forced on from the toggle or ?reduced=1
  const [reduced, setReduced] = useState<boolean | undefined>(q.get('reduced') === '1' ? true : undefined)
  const tones = TONES.filter(([t]) => !only || t === only)
  return (
    <div className="fixed inset-0 z-[1000] overflow-auto bg-canvas" dir="rtl">
      <div className={full ? '' : 'mx-auto flex max-w-[1180px] flex-col gap-6 px-4 py-5'}>
        {!full && (
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[20px] font-bold">الخلفية الحية — صفحة تطوير</h2>
            <button type="button" className="rounded-[10px] border border-line bg-surface px-3 py-1.5 text-[14px]" aria-pressed={!!reduced} onClick={() => setReduced((r) => (r ? undefined : true))}>
              {reduced ? 'تقليل الحركة: مفعّل' : 'تقليل الحركة: مطفأ'}
            </button>
          </header>
        )}
        {tones.map(([t]) => <Stage key={t} tone={t} full={full} reduced={reduced} />)}
      </div>
    </div>
  )
}
