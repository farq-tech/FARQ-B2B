import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cx } from '../../../ui/cx'
import { Icon } from '../../../ui/Icon'
import { T } from '../kit'
import '../layers.css'
import { bucket8, type Dir8 } from '../../../live-bg/ahmad3d'
import sheetUrl from '../../../assets/live-bg/ahmad3d-run-sheet.webp?no-inline'
import whatsapp from '../../../assets/live-bg/channel-whatsapp@2x.webp?no-inline'
import haraj from '../../../assets/live-bg/channel-haraj@2x.webp?no-inline'
import call from '../../../assets/live-bg/channel-call@2x.webp?no-inline'

/*
 * The hero's interactive scene (owner, 2026-10-08): one bounded box next to the headline — never under it.
 * Head office on top, supplier cards in a grid (the cheapest in the middle, clearly marked), the saving below.
 * Curved paths (SVG, viewBox = the box's own size) run from the head office to each card's real top edge; one message
 * per channel travels down slowly enough to read, waits at the card, and its price travels back. Ahmad walks the path
 * to the cheapest supplier, stops, and brings the price home. Everything moves with transform / opacity only, inside
 * the box; prefers-reduced-motion shows the finished state, still.
 */

type Channel = 'whatsapp' | 'haraj' | 'call'
type Offer = { name: string; meta: string; price: number; channel: Channel }
const ALL: Offer[] = [
  { name: 'مؤسسة النور للكهرباء', meta: 'توصيل 350 ر.س', price: 42500, channel: 'whatsapp' },
  { name: 'مستودع الرياض للكهرباء', meta: 'متوفر · توصيل مجاني', price: 41200, channel: 'haraj' },
  { name: 'شركة الخليج للكابلات', meta: 'التوريد 7 أيام', price: 44800, channel: 'call' },
]
const CH: Record<Channel, { label: string; icon: string }> = {
  whatsapp: { label: 'واتساب · طلب سعر', icon: whatsapp },
  haraj: { label: 'حراج · طلب سعر', icon: haraj },
  call: { label: 'مكالمة · نسأل عن السعر', icon: call },
}
const fmt = (n: number) => n.toLocaleString('en-US') + ' ر.س'

// pace: a message moves ≈ 55 px/s (still readable), waits 1.2 s at the supplier; Ahmad's frame follows his distance
const MSG_SPEED = 55, WAIT = 1.2, STAGGER = 1.3, REST = 2.5 // 1.3 s apart: the previous chip is ~70 px further down its own path, so two chips never overlap
// Ahmad's sheet (docs/handoff/ahmad-3d/run_sprite.json)
const SPR = { fw: 111, fh: 160, n: 16, dirs: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as Dir8[], h: 64 }
const SCALE = SPR.h / SPR.fh, AHMAD_SPEED = 75, STRIDE = 7.2 * (SPR.h / 82)
const ANCHOR: Record<string, [number, number]> = { S: [55.3, 143.6], SE: [57.2, 143.3], E: [58, 142.5], NE: [57.2, 141.8], N: [55.2, 141.5], NW: [53.3, 141.8], W: [52.5, 142.6], SW: [53.3, 143.3], stand: [55, 143.1] }

/** Which offers to show: the real three, or (dev / QA) ?offers=0|1 for the empty and single-offer states. */
function useOffers(): Offer[] {
  return useMemo(() => {
    const q = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('offers') : null
    return q === '0' ? [] : q === '1' ? [ALL[1]] : ALL
  }, [])
}

type Geo = { w: number; h: number; hub: [number, number]; ends: Array<[number, number]>; home: [number, number] }

export default function HeroScene() {
  const offers = useOffers()
  const box = useRef<HTMLDivElement>(null)
  const hub = useRef<HTMLDivElement>(null)
  const line = useRef<HTMLParagraphElement>(null) // the status line: paths start below it, so nothing crosses its text
  const cards = useRef<Array<HTMLDivElement | null>>([])
  const paths = useRef<Array<SVGPathElement | null>>([])
  const msgs = useRef<Array<HTMLDivElement | null>>([])
  const prices = useRef<Array<HTMLDivElement | null>>([])
  const ahmad = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geo | null>(null)
  const [phase, setPhase] = useState<'send' | 'wait' | 'back' | 'done'>('send')
  const [got, setGot] = useState(0)

  // cards in the grid: the cheapest in the middle (RTL: first = right)
  const pending = offers.length === 0
  const order = useMemo(() => {
    if (offers.length === 0) return ALL // the requests still go out to the waiting suppliers
    if (offers.length < 3) return offers
    const s = [...offers].sort((a, b) => a.price - b.price)
    return [s[1], s[0], s[2]]
  }, [offers])
  const best = offers.length ? Math.min(...offers.map((o) => o.price)) : 0
  const worst = offers.length ? Math.max(...offers.map((o) => o.price)) : 0
  const bestIdx = pending ? -1 : order.findIndex((o) => o.price === best)

  // geometry from the real layout (resize: recomputed, the animation keeps its place on the path)
  useLayoutEffect(() => {
    const el = box.current; if (!el) return
    const measure = () => {
      const b = el.getBoundingClientRect(), h = hub.current!.getBoundingClientRect(), s0 = line.current!.getBoundingClientRect()
      const ends = order.map((_, i) => { const c = cards.current[i]!.getBoundingClientRect(); return [c.left + c.width / 2 - b.left, c.top - b.top] as [number, number] })
      setGeo({ w: b.width, h: b.height, hub: [h.left + h.width / 2 - b.left, s0.bottom - b.top], ends, home: [h.right - b.left + 22, h.bottom - b.top - 18] })
    }
    measure()
    const ro = new ResizeObserver(measure); ro.observe(el)
    return () => ro.disconnect()
  }, [order])

  const d = (i: number) => {
    if (!geo) return ''
    const [x0, y0] = geo.hub, [x1, y1] = geo.ends[i], k = Math.max(30, (y1 - y0) * 0.55)
    return `M${x0},${y0 + 4} C${x0},${y0 + k} ${x1},${y1 - k} ${x1},${y1 - 6}`
  }

  // the timeline: messages out (staggered), wait, prices back, Ahmad to the cheapest and back, rest, repeat
  useEffect(() => {
    if (!geo) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const P = order.map((_, i) => paths.current[i]!), L = P.map((p) => p.getTotalLength())
    const rowTop = Math.min(...geo.ends.map((e) => e[1])) - 34 // chips only above the row of cards: never over a card
    const leg = L.map((l) => Math.max(3, l / MSG_SPEED))
    const start = order.map((_, i) => i * STAGGER)
    const arrive = start.map((s, i) => s + leg[i])
    // prices head home only once every request has arrived (so a message going down never meets a price coming up)
    const lastIn = order.length ? Math.max(...arrive) : 0
    const backAt = order.map((_, i) => lastIn + WAIT + i * STAGGER), home = backAt.map((b0, i) => b0 + leg[i])
    const allHome = order.length ? Math.max(...home) : 4
    const aL = bestIdx >= 0 ? L[bestIdx] : 0, aOut = aL / AHMAD_SPEED, aStart = 0.6
    const aArrive = aStart + aOut, aBack = aArrive + WAIT + 0.6, aHome = aBack + aOut
    const T = Math.max(allHome, aHome) + REST
    const place = (el: HTMLElement | null, x: number, y: number, show: boolean) => {
      if (!el) return
      // keep the whole chip inside the box
      const w = el.offsetWidth, hh = el.offsetHeight, cx0 = Math.min(geo.w - w / 2 - 4, Math.max(w / 2 + 4, x))
      el.style.transform = `translate3d(${cx0 - w / 2}px, ${y - hh / 2}px, 0)`; el.style.opacity = show ? '1' : '0' // centred on its point of the path
    }
    if (reduced) { // the finished state, still
      order.forEach((_, i) => { place(msgs.current[i], 0, 0, false); place(prices.current[i], 0, 0, false) })
      setPhase('done'); setGot(order.length); drawAhmad(geo.home[0], geo.home[1], 'S', 0, true)
      return
    }
    let raf = 0, t0 = performance.now(), odo = 0, lastD = 0, dir: Dir8 = 'S'
    function drawAhmad(x: number, y: number, dr: Dir8, dist: number, stand: boolean) {
      const el = ahmad.current; if (!el) return
      const row = stand ? SPR.dirs.length : SPR.dirs.indexOf(dr), col = stand ? (dr === 'E' || dr === 'SE' || dr === 'NE' ? 1 : dr === 'W' || dr === 'SW' || dr === 'NW' ? 2 : 0) : ((Math.floor(dist / STRIDE) % SPR.n) + SPR.n) % SPR.n
      const a = stand ? ANCHOR.stand : ANCHOR[dr]
      el.style.backgroundPosition = `${-col * SPR.fw * SCALE}px ${-row * SPR.fh * SCALE}px`
      el.style.transform = `translate3d(${x - a[0] * SCALE}px, ${y - a[1] * SCALE}px, 0)`
    }
    const tick = (now: number) => {
      const t = ((now - t0) / 1000) % T
      let back = 0
      order.forEach((_, i) => {
        const p = P[i]
        if (t >= start[i] && t < arrive[i]) { const s1 = ((t - start[i]) / leg[i]) * L[i], q = p.getPointAtLength(s1); place(msgs.current[i], q.x, q.y, s1 > 34 && q.y < rowTop) } else place(msgs.current[i], 0, 0, false) // shown once clear of the status line
        if (!pending && t >= backAt[i] && t < home[i]) { const s2 = (1 - (t - backAt[i]) / leg[i]) * L[i], q = p.getPointAtLength(s2); place(prices.current[i], q.x, q.y, s2 > 34 && q.y < rowTop) } else place(prices.current[i], 0, 0, false) // hidden where the paths meet
        if (!pending && t >= home[i]) back++
      })
      setGot((g) => (g === back ? g : back))
      const ph = t < Math.min(...arrive, 99) ? 'send' : back === 0 ? 'wait' : t < allHome ? 'back' : 'done'
      setPhase((x) => (x === ph ? x : ph))
      // Ahmad: out to the cheapest supplier, stand, back — frames follow the distance he covers
      if (bestIdx >= 0) {
        const p = P[bestIdx]
        let dist = 0, stand = true
        if (t >= aStart && t < aArrive) { dist = ((t - aStart) / aOut) * aL; stand = false }
        else if (t >= aArrive && t < aBack) { dist = aL }
        else if (t >= aBack && t < aHome) { dist = (1 - (t - aBack) / aOut) * aL; stand = false }
        const q = p.getPointAtLength(dist)
        if (!stand) {
          const q2 = p.getPointAtLength(Math.min(aL, Math.max(0, dist + (t < aArrive ? 4 : -4))))
          const deg = (Math.atan2(q2.y - q.y, q2.x - q.x) * 180) / Math.PI, b = bucket8(deg)
          if (b !== dir && bucket8(deg - 10) === b && bucket8(deg + 10) === b) dir = b
          odo += Math.abs(dist - lastD)
        }
        lastD = dist
        const atHome = t < aStart || t >= aHome
        drawAhmad(atHome ? geo.home[0] : q.x, atHome ? geo.home[1] : q.y, dir, odo, stand) // waits beside the office icon, clear of its label
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [geo, order, bestIdx, pending])

  // reach (owner, 2026-10-08): more than 150,000 suppliers across every trade, six ways to ask for an instant price
  const status = offers.length === 0 ? 'نرسل طلبك لأكثر من 150 ألف مورد… ننتظر أول رد'
    : phase === 'send' ? 'نرسل طلبك لأكثر من 150 ألف مورد بـ6 طرق'
    : phase === 'wait' ? 'الموردين يسعّرون…'
    : phase === 'back' ? (got === 1 ? 'وصل أول سعر…' : `وصلت ${got} أسعار وتتوالى`)
    : `أرخص سعر ${fmt(best)}`

  return (
    <div ref={box} data-hero-scene aria-label="مثال: طلب واحد يروح لكل الموردين ويرجع لك بالأسعار" role="img"
      className="relative isolate flex w-full flex-col items-center gap-[var(--space-16)] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[var(--space-16)] pb-[var(--space-20)] pt-[var(--space-20)] sm:px-[var(--space-24)]">
      {/* paths: behind the cards and chips, inside the box only */}
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" viewBox={geo ? `0 0 ${geo.w} ${geo.h}` : '0 0 1 1'} preserveAspectRatio="none">
        {order.map((o, i) => (
          <path key={o.name} ref={(el) => { paths.current[i] = el }} d={d(i)} fill="none" stroke="var(--live-go)" strokeOpacity={i === bestIdx ? 0.55 : 0.35} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 6" className="hero-flow" />
        ))}
      </svg>

      {/* the head office and what is happening */}
      <div ref={hub} className="flex flex-col items-center gap-[var(--space-4)]">
        <span className="inline-flex size-11 items-center justify-center rounded-[12px] border-2 border-[var(--live-go)] bg-[var(--color-bg-surface)] text-[var(--live-go)]"><Icon name="building" size={22} /></span>
        <span className={cx(T.caption, 'text-[var(--color-text-secondary)]')}>مقر شركتك</span>
      </div>
      <p ref={line} aria-live="polite" className={cx(T.smallM, 'min-h-[30px] rounded-[var(--radius-full)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[var(--space-12)] py-[var(--space-4)] text-center text-[var(--color-text-primary)]')}>{status}</p>

      {/* room for the paths, the messages and Ahmad between the office and the suppliers */}
      <div aria-hidden="true" className="h-[96px] sm:h-[120px]" />

      {offers.length === 0 ? (
        <div className="grid w-full grid-cols-3 gap-[var(--space-8)] sm:gap-[var(--space-12)]">
          {['مورد ١', 'مورد ٢', 'مورد ٣'].map((n, i) => (
            <div key={n} ref={(el) => { cards.current[i] = el }} className="flex min-h-[112px] flex-col items-center justify-center gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] p-[var(--space-8)] text-center">
              <span className={cx(T.smallM, 'text-[var(--color-text-secondary)]')}>{n}</span>
              <span className={cx(T.caption, 'text-[var(--color-text-tertiary)]')}>بانتظار السعر…</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={cx('grid w-full items-end gap-[var(--space-8)] sm:gap-[var(--space-12)]', order.length === 1 ? 'max-w-[260px] grid-cols-1' : 'grid-cols-3')}>
          {order.map((o, i) => {
            const win = i === bestIdx && order.length > 1
            return (
              <div key={o.name} ref={(el) => { cards.current[i] = el }} data-hero-card
                className={cx('flex min-w-0 flex-col gap-[var(--space-4)] rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] p-[var(--space-8)] sm:p-[var(--space-12)]',
                  win ? 'border-2 border-[var(--color-border-success)] shadow-[var(--elevation-md)]' : 'border border-[var(--color-border-default)] opacity-90')}>
                <div className="flex items-start justify-between gap-[var(--space-4)]">
                  <span className={cx('min-w-0 font-medium text-[var(--color-text-primary)]', win ? 'text-[13px] leading-[18px] sm:text-[15px] sm:leading-[22px]' : 'text-[12px] leading-[17px] sm:text-[13px] sm:leading-[19px]')}>{o.name}</span>
                </div>
                <span className="text-[11px] leading-[16px] text-[var(--color-text-secondary)]">{o.meta}</span>
                {win ? <span className={cx(T.caption, 'self-start rounded-[var(--radius-full)] bg-[var(--color-bg-success)] px-[8px] py-[2px] text-[var(--color-text-success)]')}>الأوفر</span> : null}
                <span className={cx('font-display font-bold tabular-nums text-[var(--color-text-primary)]', win ? 'text-[17px] leading-[24px] sm:text-[22px] sm:leading-[30px]' : 'text-[14px] leading-[20px] sm:text-[17px] sm:leading-[24px]')} dir="ltr">{fmt(o.price)}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* the saving — or why there is none yet */}
      {offers.length > 1 ? (
        <div className="flex items-center gap-[var(--space-12)] rounded-[var(--radius-lg)] bg-[var(--color-bg-brand)] px-[var(--space-16)] py-[var(--space-8)] text-[var(--color-text-on-brand)]">
          <span className={T.smallM}>وش الفرق؟</span>
          <span className="font-display text-[20px] font-bold leading-[28px] tabular-nums" dir="ltr">{fmt(worst - best)}</span>
          <span className={T.caption}>أوفر من أعلى عرض بـ {(((worst - best) / worst) * 100).toFixed(1)}%</span>
        </div>
      ) : (
        <p className={cx(T.small, 'text-center text-[var(--color-text-secondary)]')}>{offers.length === 1 ? 'وصل عرض واحد — نحتاج عرضين على الأقل للمقارنة' : 'الأسعار تظهر هنا أول ما توصل'}</p>
      )}

      {/* moving messages and returning prices (transform / opacity only) */}
      {order.map((o, i) => (
        <div key={'m' + o.name} ref={(el) => { msgs.current[i] = el }} aria-hidden="true" style={{ opacity: 0 }}
          className="pointer-events-none absolute left-0 top-0 inline-flex items-center gap-[6px] whitespace-nowrap rounded-[var(--radius-full)] border border-[var(--live-go)] bg-[var(--color-bg-surface)] py-[3px] pe-[10px] ps-[4px] text-[12px] font-bold leading-[18px] text-[var(--live-go)] shadow-[var(--elevation-sm)] transition-opacity duration-300">
          <img src={CH[o.channel].icon} alt="" width={18} height={18} className="size-[18px]" />
          {CH[o.channel].label}
        </div>
      ))}
      {order.map((o, i) => (
        <div key={'p' + o.name} ref={(el) => { prices.current[i] = el }} aria-hidden="true" style={{ opacity: 0 }}
          className="pointer-events-none absolute left-0 top-0 inline-flex items-center gap-[6px] whitespace-nowrap rounded-[var(--radius-full)] bg-[var(--live-back)] py-[3px] pe-[10px] ps-[4px] text-[12px] font-bold leading-[18px] text-[var(--color-bg-surface)] tabular-nums transition-opacity duration-300">
          <img src={CH[o.channel].icon} alt="" width={18} height={18} className="size-[18px] rounded-full bg-[var(--color-bg-surface)]" />
          <span dir="ltr">{fmt(o.price)}</span>
        </div>
      ))}
      {offers.length ? (
        <div ref={ahmad} aria-hidden="true" className="pointer-events-none absolute left-0 top-0"
          style={{ width: SPR.fw * SCALE, height: SPR.fh * SCALE, backgroundImage: `url(${sheetUrl})`, backgroundSize: `${1776 * SCALE}px ${1440 * SCALE}px`, backgroundRepeat: 'no-repeat' }} />
      ) : null}
    </div>
  )
}
