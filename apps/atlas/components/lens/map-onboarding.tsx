'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, Info, MousePointerClick, X } from 'lucide-react'
import { setMapTourShowing } from '@/components/shared/whats-new'
import { trackOnboardingStep } from '@/lib/commercial-metrics'
import { LENSES, type LensId } from './lenses'

/**
 * The first visit to the map (skills: product-adoption, interactive-onboarding, onboarding-state-machine): one question
 * about the visitor's goal at the top of the map's panel, then two one-line hints on the real map that advance when the visitor does the thing, not on «التالي»:
 * pick a district, then open how one of its figures was worked out. A step already done is skipped. The state lives in
 * this browser only; the «؟» button runs it again.
 */
type CoachState = 'not_started' | 'goal' | 'waiting_pick' | 'waiting_explain' | 'completed' | 'skipped'

const KEY = 'atlas.onboarding.map'
const GOALS: Record<LensId, string> = {
  shops: 'أفتح محلاً أو أوسّع نشاطي',
  marketers: 'أوصل لجمهوري بحملة',
  distributors: 'أوزّع وأغطي مناطق',
  analysts: 'أفهم السوق والأحياء',
  property: 'أدوّر عقاراً مناسباً',
}
const EXPLAINED = '[aria-label="لوحة الخريطة"] [data-explained]'

function read(): CoachState {
  try { return (localStorage.getItem(KEY) as CoachState | null) ?? 'not_started' } catch { return 'completed' }
}
function write(state: CoachState) {
  try { localStorage.setItem(KEY, state) } catch { /* private window: the tour simply shows again next time */ }
}

export function MapOnboarding({ lens, onLens, picked, paused = false, goalSlot, onAsk, onShowMe }: {
  lens: LensId
  onLens: (lens: LensId) => void
  picked: boolean
  /** Where the goal question goes: the top of the map's panel. */
  goalSlot?: HTMLElement | null
  /** Told when the goal question opens, so a phone's sheet can rise to show it. */
  onAsk?: () => void
  /** Picks the district the open step ranks first, so a first visit reaches an answer in one tap; absent when none. */
  onShowMe?: (() => void) | null
  /** The map failed to open: the tour keeps its place and shows no hint over the failure notice (the goal question,
   * in the panel, still asks). */
  paused?: boolean
}) {
  // null until mounted, so the server render and a returning visitor never flash the tour
  const [state, setState] = useState<CoachState | null>(null)
  // the hint's «×» hides it for this visit only; «تخطَّ الجولة» ends the tour for good
  const [hidden, setHidden] = useState(false)
  useEffect(() => { setHidden(false) }, [state])
  // «ما الجديد» waits while the tour has something on screen, so the two never cover each other
  // the goal question sits in the panel, not on the map, so a map that failed to open (or a city without district
  // outlines) does not hold it back: the panel's steps and figures still work, and the goal still picks them. Only the
  // two hints, which point at the map, wait.
  const showing = state === 'goal' || (!paused && (state === 'waiting_pick' || state === 'waiting_explain') && !hidden)
  useEffect(() => { setMapTourShowing(showing) }, [showing])
  useEffect(() => () => setMapTourShowing(false), [])
  const asking = state === 'goal'
  useEffect(() => { if (asking) onAsk?.() }, [asking, onAsk])
  const go = (next: CoachState, via?: 'explain' | 'button') => {
    if (next === 'completed') trackOnboardingStep('completed', { via })
    if (next === 'skipped') trackOnboardingStep('skipped', { at: state ?? undefined })
    setState(next)
    if (next === 'completed' || next === 'skipped') write(next)
  }

  useEffect(() => {
    const saved = read()
    // a link that already names a goal (?lens= / ?goal=) has answered the first question
    const query = new URLSearchParams(window.location.search)
    const first = saved === 'not_started' ? (query.get('lens') || query.get('goal') ? 'waiting_pick' : 'goal') : saved
    if (saved === 'not_started') trackOnboardingStep('shown', { at: first })
    setState(first)
  }, [])

  // a district picked by any route (map, ranking, a tool's list) moves the tour on
  useEffect(() => {
    if (picked && state === 'waiting_pick') { trackOnboardingStep('district_picked'); setState('waiting_explain') }
  }, [picked, state])

  // the hint rings the first explained figure in the panel, and opening any of them completes the tour
  useEffect(() => {
    if (state !== 'waiting_explain') return
    let target: Element | null = null
    const mark = () => {
      const next = document.querySelector(EXPLAINED)
      if (next === target) return
      target?.classList.remove('coach-target')
      target = next
      target?.classList.add('coach-target')
    }
    mark()
    const watch = new MutationObserver(mark)
    watch.observe(document.body, { childList: true, subtree: true })
    const opened = (event: MouseEvent) => { if ((event.target as Element | null)?.closest?.('[data-explained]')) go('completed', 'explain') }
    document.addEventListener('click', opened, true)
    return () => { watch.disconnect(); target?.classList.remove('coach-target'); document.removeEventListener('click', opened, true) }
  }, [state])

  const restart = () => { trackOnboardingStep('restarted'); setState('goal') }
  const help = (
    <button onClick={restart} aria-label="جولة سريعة في الخريطة"
      className="absolute end-3 bottom-[calc(3.5rem+var(--lift,0px))] z-10 grid size-10 place-items-center rounded-full border bg-card/95 text-muted-foreground shadow-sm backdrop-blur transition-[bottom,color] duration-300 outline-none motion-reduce:transition-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 lg:top-3 lg:bottom-auto">
      <CircleHelp className="size-5" aria-hidden />
    </button>
  )

  if (state === null || state === 'completed' || state === 'skipped' || state === 'not_started') return help
  if (paused && state !== 'goal') return help

  const skip = <button onClick={() => go('skipped')} className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">تخطَّ الجولة</button>
  // the two hints on the map are one small line pinned to its top, under the phone's floating filters: they never sit
  // over the middle of the map, where the visitor taps a district, nor over the colour key in its bottom corner
  const hint = (icon: ReactNode, text: string, action?: ReactNode) => hidden ? help : (
    <>
      {help}
      <div role="status" className="pointer-events-none absolute inset-x-3 top-[7.5rem] z-[15] flex justify-center lg:top-3">
        <p className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card/95 py-1.5 ps-3 pe-1.5 text-sm shadow-md backdrop-blur animate-in fade-in slide-in-from-top-1 duration-300">
          {icon}
          <span className="min-w-0 truncate font-semibold">{text}</span>
          {action}
          {skip}
          <button onClick={() => setHidden(true)} aria-label="إخفاء التلميح" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
        </p>
      </div>
    </>
  )

  if (state === 'goal') {
    // the first question sits at the top of the panel (on a phone, the sheet opened halfway), not over the map: the
    // map stays in view, and the goal picked folds into «أنا من»
    const ask = (
      <section aria-labelledby="coach-goal" className="flex flex-col gap-2.5 rounded-2xl border border-primary/40 bg-primary/5 p-3 animate-in fade-in duration-300">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="coach-goal" className="text-base font-bold">وش تبي تحقق؟</h2>
            <p className="text-sm text-muted-foreground">اختر هدفك ونجهّز لك الخريطة وخطواتها.</p>
          </div>
          <button onClick={() => go('skipped')} aria-label="إغلاق" className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
        </div>
        <ul className="flex flex-wrap gap-2">
          {LENSES.map((item) => (
            <li key={item.id}>
              <button onClick={() => {
                trackOnboardingStep('goal_picked', { lens: item.id })
                // a district picked before the goal still counts as the pick step
                if (picked) trackOnboardingStep('district_picked')
                onLens(item.id)
                setState(picked ? 'waiting_explain' : 'waiting_pick')
              }}
                className="flex flex-col items-start rounded-xl border bg-card px-3 py-1.5 text-start transition-colors outline-none hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/60 data-[current=true]:border-primary"
                data-current={item.id === lens}>
                <span className="text-sm font-semibold">{GOALS[item.id]}</span>
                <span className="text-xs text-muted-foreground">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
    return <>{help}{goalSlot ? createPortal(ask, goalSlot) : null}</>
  }

  if (state === 'waiting_pick') {
    return hint(<MousePointerClick className="size-4 shrink-0 text-primary" aria-hidden />, onShowMe ? 'اضغط حياً على الخريطة' : 'اختر حياً: اضغطه على الخريطة',
      onShowMe && <button onClick={() => { trackOnboardingStep('show_me'); onShowMe() }} className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline">أو أرني الأعلى</button>)
  }

  // waiting_explain: the pick is done, so the line now points at the «i» beside a figure in the panel
  return hint(<Info className="size-4 shrink-0 text-primary" aria-hidden />, 'اضغط «i» لترى كيف حُسب الرقم',
    <button onClick={() => go('completed', 'button')} className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline">فهمت</button>)
}
