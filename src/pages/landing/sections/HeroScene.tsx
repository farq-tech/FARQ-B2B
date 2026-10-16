import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../../ui/cx'
import { Icon } from '../../../ui/Icon'
import { RiyalSign } from '../../../ui/Riyal'
import { T } from '../kit'
import '../layers.css'
import { bucket8, type Dir8 } from '../../../live-bg/ahmad3d'
import sheetUrl from '../../../assets/live-bg/ahmad3d-run-sheet.webp?no-inline'
import waMark from '../../../assets/live-bg/channel-whatsapp@2x.webp?no-inline'

/*
 * The hero's interactive scene (owner, 2026-10-08/09): one bounded box next to the headline — never under it.
 * Head office on top, four suppliers in a row (the cheapest clearly marked), the saving below. One request leaves for
 * every supplier AT THE SAME TIME and the tip of each dotted line IS its channel: a WhatsApp mark, a text-message
 * bubble, a ringing phone — and Ahmad walking there himself. The dotted line grows behind its tip. All the answers come
 * back together in the same channel (a WhatsApp reply, an SMS reply, a finished call, Ahmad carrying the price).
 * Paths are SVG with the box's own viewBox and end at each card's real top edge. A traveller is shown only where it
 * overlaps nothing (another traveller, Ahmad, the status line, a card), checked every frame. transform / opacity only;
 * prefers-reduced-motion shows the finished state, still.
 */

type Channel = 'whatsapp' | 'sms' | 'call' | 'ahmad'
type Offer = { name: string; meta: ReactNode; price: number; channel: Channel }
// Illustrative item prices; each supplier states delivery and VAT in its own offer, so no VAT basis is claimed here.
const fmt = (n: number) => <bdi dir="ltr" className="inline-flex items-baseline gap-[2px] whitespace-nowrap">{n.toLocaleString('en-US')}<RiyalSign /></bdi>
const ALL: Offer[] = [
  { name: 'مؤسسة النور للكهرباء', meta: <>توصيل {fmt(350)}</>, price: 42500, channel: 'whatsapp' },
  { name: 'مستودع الرياض للكهرباء', meta: 'متوفر · توصيل مجاني', price: 41200, channel: 'ahmad' },
  { name: 'مؤسسة الأفق للتجارة', meta: 'متوفر · 3 أيام', price: 43600, channel: 'sms' },
  { name: 'شركة الخليج للكابلات', meta: 'التوريد 7 أيام', price: 44800, channel: 'call' },
]

const short = (n: number) => n.toLocaleString('en-US')

// pace: everyone leaves together and arrives together (≈ 55 px/s on the longest path), waits, and comes back together
const MSG_SPEED = 55, WAIT = 1.4, LEAVE = 0.4, REST = 2.6
// Ahmad's sheet (docs/handoff/ahmad-3d/run_sprite.json)
const SPR = { fw: 111, fh: 160, n: 16, dirs: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as Dir8[], h: 64 }
const SCALE = SPR.h / SPR.fh, STRIDE = 7.2 * (SPR.h / 82)
const ANCHOR: Record<string, [number, number]> = { S: [55.3, 143.6], SE: [57.2, 143.3], E: [58, 142.5], NE: [57.2, 141.8], N: [55.2, 141.5], NW: [53.3, 141.8], W: [52.5, 142.6], SW: [53.3, 143.3], stand: [55, 143.1] }

/** Which offers to show: the real four, or (dev / QA) ?offers=0|1 for the empty and single-offer states. */
function useOffers(): Offer[] {
  return useMemo(() => {
    const q = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('offers') : null
    return q === '0' ? [] : q === '1' ? [ALL[0]] : ALL
  }, [])
}

// ---------- the tip of each request line: the channel itself ----------
function Tip({ ch }: { ch: Channel }) {
  if (ch === 'whatsapp') return (
    <span className="msg-pop inline-flex size-[30px] items-center justify-center rounded-full bg-[var(--ch-wa-in)] shadow-[var(--elevation-md)]">
      <img src={waMark} alt="" width={24} height={24} className="size-6" />
    </span>
  )
  if (ch === 'sms') return (
    <span className="msg-pop relative inline-flex h-[24px] w-[34px] items-center justify-center rounded-[12px] rounded-br-[3px] shadow-[var(--elevation-md)]" style={{ background: 'var(--ch-sms-out)', color: 'var(--ch-call-ink)' }}>
      <span className="typing text-[13px] font-bold leading-[10px]"><i>.</i><i>.</i><i>.</i></span>
    </span>
  )
  if (ch === 'call') return (
    <span className="msg-pop relative inline-flex size-[30px] items-center justify-center rounded-full shadow-[var(--elevation-md)]" style={{ background: 'var(--ch-call)', color: 'var(--ch-call-ink)' }}>
      <span aria-hidden="true" className="wave absolute inset-0 rounded-full" style={{ border: '2px solid var(--ch-call)' }} />
      <span aria-hidden="true" className="wave w2 absolute inset-0 rounded-full" style={{ border: '2px solid var(--ch-call)' }} />
      <span className="ring inline-flex"><Icon name="phone" size={15} /></span>
    </span>
  )
  return null
}
/** The answer coming home, in the same channel: its mark plus the price. */
function Reply({ ch, price, mini }: { ch: Channel; price: number; mini: boolean }) {
  const p = <span className="font-display text-[12px] font-bold leading-[16px] tabular-nums" dir="ltr">{mini ? short(price) : fmt(price)}</span>
  const pill = 'msg-pop inline-flex items-center gap-[5px] whitespace-nowrap rounded-full py-[3px] pe-[9px] ps-[3px] shadow-[var(--elevation-sm)]'
  if (ch === 'whatsapp') return <span className={pill} style={{ background: 'var(--ch-wa-out)', color: 'var(--ch-wa-ink)' }}><img src={waMark} alt="" width={18} height={18} className="size-[18px]" />{p}</span>
  if (ch === 'sms') return <span className={pill} style={{ background: 'var(--ch-sms-in)', color: 'var(--ch-wa-ink)' }}><span className="inline-flex size-[18px] items-center justify-center rounded-full" style={{ background: 'var(--ch-sms-out)', color: 'var(--ch-call-ink)' }}><Icon name="message" size={11} /></span>{p}</span>
  if (ch === 'call') return <span className={pill} style={{ background: 'var(--ch-call-card)', color: 'var(--ch-call-ink)' }}><span className="inline-flex size-[18px] items-center justify-center rounded-full" style={{ background: 'var(--ch-call)' }}><Icon name="phone" size={11} /></span>{p}</span>
  return <span className="msg-pop inline-flex whitespace-nowrap rounded-full bg-[var(--live-back)] px-[8px] py-[2px] text-[var(--color-bg-surface)] shadow-[var(--elevation-sm)]">{p}</span> // Ahmad's price tag
}

type Geo = { w: number; h: number; hub: [number, number]; ends: Array<[number, number]>; home: [number, number]; col: number }

export default function HeroScene() {
  const offers = useOffers()
  const pending = offers.length === 0
  const order = pending ? ALL : offers
  const best = offers.length ? Math.min(...offers.map((o) => o.price)) : 0
  const worst = offers.length ? Math.max(...offers.map((o) => o.price)) : 0
  const bestIdx = pending ? -1 : order.findIndex((o) => o.price === best)
  const aIdx = order.findIndex((o) => o.channel === 'ahmad') // Ahmad walks the path of the supplier he visits himself

  const box = useRef<HTMLDivElement>(null)
  const hub = useRef<HTMLDivElement>(null)
  const line = useRef<HTMLParagraphElement>(null)
  const cards = useRef<Array<HTMLDivElement | null>>([])
  const paths = useRef<Array<SVGPathElement | null>>([])
  const reveal = useRef<Array<SVGPathElement | null>>([])
  const tips = useRef<Array<HTMLDivElement | null>>([])
  const backs = useRef<Array<HTMLDivElement | null>>([])
  const ahmad = useRef<HTMLDivElement>(null)
  const [motionReady, setMotionReady] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () => { const im = new Image(); im.src = sheetUrl; void im.decode().then(() => { if (alive) setMotionReady(true) }).catch(() => {}) }
    const id = window.requestIdleCallback ? window.requestIdleCallback(load, { timeout: 2000 }) : window.setTimeout(load, 250)
    return () => { alive = false; (window.cancelIdleCallback ?? window.clearTimeout)(id) }
  }, [])
  const [geo, setGeo] = useState<Geo | null>(null)
  const [phase, setPhase] = useState<'send' | 'wait' | 'back' | 'done'>('send')
  const mini = (geo?.col ?? 200) < 110 // very narrow columns: the price without «ر.س»

  useLayoutEffect(() => {
    const el = box.current; if (!el) return
    const measure = () => {
      const b = el.getBoundingClientRect(), h = hub.current!.getBoundingClientRect(), s0 = line.current!.getBoundingClientRect()
      const cs = order.map((_, i) => cards.current[i]!.getBoundingClientRect())
      void s0; setGeo({ w: b.width, h: b.height, hub: [h.left + h.width / 2 - b.left, h.bottom - b.top + 2], ends: cs.map((c) => [c.left + c.width / 2 - b.left, c.top - b.top]), home: [h.left + h.width / 2 - b.left + 58, h.bottom - b.top], col: cs[0]?.width ?? 200 })
    }
    measure()
    const ro = new ResizeObserver(measure); ro.observe(el)
    return () => ro.disconnect()
  }, [order])

  // paths fan out sideways first, then drop to the card: the travellers separate right away
  const d = (i: number) => {
    if (!geo) return ''
    const [x0, y0] = i === aIdx ? geo.home : geo.hub, [x1, y1] = geo.ends[i], dy = Math.max(40, y1 - y0)
    return `M${x0},${y0 + 4} C${x0 + (x1 - x0) * 0.9},${y0 + dy * 0.18} ${x1},${y1 - dy * 0.5} ${x1},${y1 - 6}`
  }

  useEffect(() => {
    if (!geo || !motionReady) return
    const geometry = geo
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const P = order.map((_, i) => paths.current[i]!), L = P.map((p) => p.getTotalLength())
    const D = Math.max(3.5, Math.max(...L) / MSG_SPEED), DB = D * 0.85 // one journey time for everyone
    const tArr = LEAVE + D, tBack = tArr + WAIT, tHome = tBack + DB, T = tHome + REST
    // obstacles are re-read every frame (cards can shift a little once fonts load): five rects, cheap
    const obstacles = () => { const bx = box.current!.getBoundingClientRect(), rel = (r: DOMRect) => [r.left - bx.left, r.top - bx.top, r.right - bx.left, r.bottom - bx.top]; return [rel(line.current!.getBoundingClientRect()), rel(hub.current!.getBoundingClientRect()), ...order.map((_, i) => rel(cards.current[i]!.getBoundingClientRect()))] } // status line, the office and its label, the cards
    const staticObstacles = obstacles()
    const tipSizes = tips.current.map(el => [el?.offsetWidth ?? 0, el?.offsetHeight ?? 0])
    const backSizes = backs.current.map(el => [el?.offsetWidth ?? 0, el?.offsetHeight ?? 0])
    let previousPhase = ''
    const hit = (a: number[], b: number[]) => a[0] < b[2] + 3 && a[2] > b[0] - 3 && a[1] < b[3] + 3 && a[3] > b[1] - 3
    const grow = (i: number, frac: number) => { const m = reveal.current[i]; if (m) m.style.strokeDashoffset = String(L[i] * (1 - frac)) } // the dotted line behind the tip
    order.forEach((_, i) => { const m = reveal.current[i]; if (m) m.style.strokeDasharray = `${L[i]} ${L[i]}` })
    let raf = 0, odo = 0, lastD = 0, dir: Dir8 = 'S'
    let elapsed = 0, last = performance.now(), onScreen = true
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const restart = () => { cancelAnimationFrame(raf); if (!document.hidden && onScreen && !motion.matches) { last = performance.now(); raf = requestAnimationFrame(tick) } }
    const io = new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; restart() }); io.observe(box.current!)
    document.addEventListener('visibilitychange', restart)
    const onMotion = () => { if (motion.matches) { cancelAnimationFrame(raf); setPhase('done'); order.forEach((_, i) => { hide(tips.current[i]); hide(backs.current[i]); grow(i, 1) }); drawAhmad(geometry.home[0], geometry.home[1], 'S', 0, true) } else restart() }
    motion.addEventListener('change', onMotion)
    const cleanup = () => { cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener('visibilitychange', restart); motion.removeEventListener('change', onMotion) }
    const hide = (el: HTMLElement | null) => { if (el) el.style.opacity = '0' }
    function drawAhmad(x: number, y: number, dr: Dir8, dist: number, stand: boolean) {
      const el = ahmad.current; if (!el) return null
      const row = stand ? SPR.dirs.length : SPR.dirs.indexOf(dr), col = stand ? (dr === 'E' || dr === 'SE' || dr === 'NE' ? 1 : dr === 'W' || dr === 'SW' || dr === 'NW' ? 2 : 0) : ((Math.floor(dist / STRIDE) % SPR.n) + SPR.n) % SPR.n
      const a = stand ? ANCHOR.stand : ANCHOR[dr], X = x - a[0] * SCALE, Y = y - a[1] * SCALE
      el.style.backgroundPosition = `${-col * SPR.fw * SCALE}px ${-row * SPR.fh * SCALE}px`
      el.style.transform = `translate3d(${X}px, ${Y}px, 0)`
      return [X + 14, Y + 6, X + SPR.fw * SCALE - 14, Y + SPR.fh * SCALE]
    }
    if (reduced) { order.forEach((_, i) => { hide(tips.current[i]); hide(backs.current[i]); grow(i, 1) }); setPhase('done'); drawAhmad(geometry.home[0], geometry.home[1], 'S', 0, true); return cleanup }

    function tick(now: number) {
      elapsed += Math.min(0.05, (now - last) / 1000); last = now
      const t = elapsed % T
      const out = t >= LEAVE && t < tArr, back = !pending && t >= tBack && t < tHome
      const f = out ? (t - LEAVE) / D : back ? 1 - (t - tBack) / DB : 0
      const ph = t < tArr ? 'send' : t < tBack ? 'wait' : t < tHome && !pending ? 'back' : pending ? 'wait' : 'done'
      if (ph !== previousPhase) { previousPhase = ph; setPhase(ph) }
      // the lines grow with the requests and stay drawn until the round restarts
      order.forEach((_, i) => grow(i, t < LEAVE ? 0 : out ? f : 1))
      // Ahmad first (always shown), then every tip / reply that fits without touching anything
      const taken: number[][] = [...staticObstacles]
      if (aIdx >= 0) {
        const p = P[aIdx], moving = out || back, dist = (moving ? f : t >= tArr && t < tBack ? 1 : 0) * L[aIdx]
        const q = p.getPointAtLength(dist)
        if (moving) {
          const q2 = p.getPointAtLength(Math.min(L[aIdx], Math.max(0, dist + (out ? 4 : -4))))
          const deg = (Math.atan2(q2.y - q.y, q2.x - q.x) * 180) / Math.PI, b = bucket8(deg)
          if (b !== dir && bucket8(deg - 10) === b && bucket8(deg + 10) === b) dir = b
          odo += Math.abs(dist - lastD)
        }
        lastD = dist
        const atHome = !(moving || (t >= tArr && t < tBack))
        const r = drawAhmad(atHome ? geometry.home[0] : q.x, atHome ? geometry.home[1] : q.y, dir, odo, !moving)
        if (r) taken.push(r)
        const tag = backs.current[aIdx] // his price tag rides over his head on the way back
        if (tag) {
          const [w, hh] = backSizes[aIdx], right = r ? r[2] + w + 6 < geometry.w : true
          const x = r ? (right ? r[2] + 2 : r[0] - w - 2) : 0, y = r ? r[1] + 14 : 0, tr = [x, y, x + w, y + hh]
          const carrying = back || (!pending && t >= tHome) // on the way home and once he is back, the price is in his hand
          if (carrying && r) { tag.style.transform = `translate3d(${x}px, ${y}px, 0)`; tag.style.opacity = '1'; taken.push(tr) } else hide(tag)
        }
      }
      order.forEach((o, i) => {
        if (o.channel === 'ahmad') return
        const el = out ? tips.current[i] : back ? backs.current[i] : null
        hide(out ? backs.current[i] : tips.current[i])
        if (!el) { hide(tips.current[i]); hide(backs.current[i]); return }
        const q = P[i].getPointAtLength(f * L[i]), [w, hh] = out ? tipSizes[i] : backSizes[i]
        const x = Math.min(geometry.w - w - 4, Math.max(4, q.x - w / 2)), y = q.y - hh / 2, r = [x, y, x + w, y + hh]
        if (taken.some((b) => hit(r, b))) { hide(el); return }
        taken.push(r)
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`; el.style.opacity = '1'
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return cleanup
  }, [geo, order, aIdx, pending, motionReady])

  const status = pending ? 'طلبك عند الموردين المختارين… ننتظر الردود'
    : phase === 'send' ? 'طلب واحد يصل إلى الموردين المختارين'
    : phase === 'wait' ? 'الموردين يسعّرون…'
    : phase === 'back' ? 'الأسعار راجعة لك…'
    : <>أقل سعر في المثال {fmt(best)}</>

  return (
    <div ref={box} data-hero-scene aria-label="مثال: طلب واحد يروح لكل الموردين بالواتساب والرسائل والاتصال وأحمد بنفسه، ويرجع لك بالأسعار" role="img"
      className="relative isolate flex w-full flex-col items-center gap-[var(--space-16)] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[var(--space-12)] pb-[var(--space-20)] pt-[var(--space-20)] sm:px-[var(--space-20)]">
      <span className="sr-only">مثال توضيحي لأسعار البنود؛ يحدد كل مورد التوصيل والضريبة في عرضه.</span>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" viewBox={geo ? `0 0 ${geo.w} ${geo.h}` : '0 0 1 1'} preserveAspectRatio="none">
        <defs>
          {order.map((o, i) => (
            <mask key={o.name} id={`hs-reveal-${i}`} maskUnits="userSpaceOnUse">
              <path ref={(el) => { reveal.current[i] = el }} d={d(i)} fill="none" stroke="var(--color-bg-surface)" strokeWidth="8" strokeLinecap="round" />
            </mask>
          ))}
        </defs>
        {order.map((o, i) => (
          <g key={o.name}>
            {/* the whole route, faint; the request's own dotted line grows over it behind the tip */}
            <path ref={(el) => { paths.current[i] = el }} d={d(i)} fill="none" stroke="var(--live-go)" strokeOpacity="0.14" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 6" />
            <path d={d(i)} mask={`url(#hs-reveal-${i})`} fill="none" stroke="var(--live-go)" strokeOpacity={i === bestIdx ? 0.7 : 0.5} strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 6" className="hero-flow" />
          </g>
        ))}
      </svg>

      <p ref={line} aria-live="polite" className={cx(T.smallM, 'min-h-[30px] rounded-[var(--radius-full)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[var(--space-12)] py-[var(--space-4)] text-center text-[var(--color-text-primary)]')}>{status}</p>
      <div ref={hub} className="flex flex-col items-center gap-[var(--space-4)]">
        <span className="inline-flex size-11 items-center justify-center rounded-[12px] border-2 border-[var(--live-go)] bg-[var(--color-bg-surface)] text-[var(--live-go)]"><Icon name="building" size={22} /></span>
        <span className={cx(T.caption, 'text-[var(--color-text-secondary)]')}>مقر شركتك</span>
      </div>

      <div aria-hidden="true" className="h-[120px] sm:h-[140px]" />

      <div className={cx('grid w-full items-end gap-[6px] sm:gap-[var(--space-8)]', order.length === 1 ? 'max-w-[220px] grid-cols-1' : 'grid-cols-4')}>
        {order.map((o, i) => {
          const win = !pending && i === bestIdx && order.length > 1
          if (pending) return (
            <div key={o.name} ref={(el) => { cards.current[i] = el }} className="flex min-h-[96px] min-w-0 flex-col items-center justify-center gap-[2px] rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] p-[6px] text-center">
              <span className="text-[11px] font-medium leading-[16px] text-[var(--color-text-secondary)]">مورد {i + 1}</span>
              <span className="text-[10px] leading-[14px] text-[var(--color-text-tertiary)]">بانتظار السعر…</span>
            </div>
          )
          return (
            <div key={o.name} ref={(el) => { cards.current[i] = el }} data-hero-card
              className={cx('flex min-w-0 flex-col gap-[3px] rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] p-[6px] sm:p-[var(--space-8)]',
                win ? 'border-2 border-[var(--color-border-success)] shadow-[var(--elevation-md)]' : 'border border-[var(--color-border-default)] opacity-90')}>
              <span className={cx('min-w-0 font-medium text-[var(--color-text-primary)]', win ? 'text-[12px] leading-[16px] sm:text-[13px] sm:leading-[18px]' : 'text-[11px] leading-[15px] sm:text-[12px] sm:leading-[17px]')}>{o.name}</span>
              <span className="hidden text-[10px] leading-[14px] text-[var(--color-text-secondary)] sm:block">{o.meta}</span>
              {win ? <span className="self-start rounded-[var(--radius-full)] bg-[var(--color-bg-success)] px-[6px] py-[1px] text-[10px] font-medium leading-[14px] text-[var(--color-text-success)]">الأوفر</span> : null}
              <span className={cx('whitespace-nowrap font-display font-bold tabular-nums text-[var(--color-text-primary)]', win ? 'text-[13px] leading-[19px] sm:text-[18px] sm:leading-[24px]' : 'text-[11px] leading-[16px] sm:text-[15px] sm:leading-[21px]')} dir="ltr">{fmt(o.price)}</span>
            </div>
          )
        })}
      </div>

      {offers.length > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-x-[var(--space-12)] gap-y-[2px] rounded-[var(--radius-lg)] bg-[var(--color-bg-brand)] px-[var(--space-16)] py-[var(--space-8)] text-[var(--color-text-on-brand)]">
          <span className={T.smallM}>فرق سعر البنود</span>
          <span className="font-display text-[20px] font-bold leading-[28px] tabular-nums" dir="ltr">{fmt(worst - best)}</span>
          <span className={T.caption}>بين أقل وأعلى سعر في المثال: {(((worst - best) / worst) * 100).toFixed(1)}%</span>
        </div>
      ) : (
        <p className={cx(T.small, 'text-center text-[var(--color-text-secondary)]')}>{offers.length === 1 ? 'وصل عرض واحد — نحتاج عرضين على الأقل للمقارنة' : 'الأسعار تظهر هنا أول ما توصل'}</p>
      )}

      {order.map((o, i) => o.channel === 'ahmad' ? null : (
        <div key={'t' + o.name} ref={(el) => { tips.current[i] = el }} aria-hidden="true" style={{ opacity: 0 }} className="pointer-events-none absolute left-0 top-0 transition-opacity duration-200">
          <Tip ch={o.channel} />
        </div>
      ))}
      {pending ? null : order.map((o, i) => (
        <div key={'b' + o.name} ref={(el) => { backs.current[i] = el }} aria-hidden="true" style={{ opacity: 0 }} className="pointer-events-none absolute left-0 top-0 transition-opacity duration-200">
          <Reply ch={o.channel} price={o.price} mini={mini} />
        </div>
      ))}
      {aIdx >= 0 ? (
        <div ref={ahmad} aria-hidden="true" className="pointer-events-none absolute left-0 top-0"
          style={{ width: SPR.fw * SCALE, height: SPR.fh * SCALE, backgroundImage: motionReady ? `url(${sheetUrl})` : undefined, backgroundSize: `${1776 * SCALE}px ${1440 * SCALE}px`, backgroundRepeat: 'no-repeat' }} />
      ) : null}
    </div>
  )
}
