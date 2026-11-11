'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { CircleHelp, Info, MousePointerClick, Target, X } from 'lucide-react'
import { setMapTourShowing } from '@/components/shared/whats-new'
import { trackOnboardingStep } from '@/lib/commercial-metrics'
import { LENS_GOALS, LENSES, type LensId } from './lenses'

/**
 * The first visit to the map (skills: product-adoption, interactive-onboarding, onboarding-state-machine): one line of
 * goal chips pinned to the top of the map (never over the panel or its open step, and it never raises a phone's sheet),
 * asked on the first visit only, then two one-line hints on the real map that advance when the visitor does the thing, not on «التالي»:
 * pick a district, then open how one of its figures was worked out. A step already done is skipped. The state lives in
 * this browser only; the «؟» button runs it again.
 */
type CoachState = 'not_started' | 'goal' | 'waiting_pick' | 'waiting_explain' | 'completed' | 'skipped'

const KEY = 'atlas.onboarding.map'
// set once the goal row has been shown: a visitor who left without picking or closing it is not asked again
const ASKED_KEY = 'atlas.onboarding.map.asked'
const EXPLAINED = '[aria-label="لوحة الخريطة"] [data-explained]'

function read(): CoachState {
  try { return (localStorage.getItem(KEY) as CoachState | null) ?? 'not_started' } catch { return 'completed' }
}
function asked(): boolean {
  try { return localStorage.getItem(ASKED_KEY) != null } catch { return true }
}
function markAsked() {
  try { localStorage.setItem(ASKED_KEY, '1') } catch { /* private window: the row may show again next time */ }
}
function write(state: CoachState) {
  try { localStorage.setItem(KEY, state) } catch { /* private window: the tour simply shows again next time */ }
}

export function MapOnboarding({ lens, onLens, picked, paused = false, onShowMe, showMeName = null, firstAsk = null, onFirstAsk }: {
  lens: LensId
  onLens: (lens: LensId) => void
  picked: boolean
  /** Picks the district the open step ranks first, so a first visit reaches an answer in one tap; absent when none. */
  onShowMe?: (() => void) | null
  /** The name of the district «أرني» opens, so the offer says where it goes («أو اعرض طويق») instead of «الأعلى» in what. */
  showMeName?: string | null
  /** What the open step needs before a district means anything (its activity, «اختر نشاطك…»): the pick hint says this
   * first, so the tour and the panel never ask for two different things; once it is done the hint asks for the pick. */
  firstAsk?: string | null
  /** Opens the step's first control for `firstAsk` (a phone's peeking sheet hides it). */
  onFirstAsk?: () => void
  /** The map failed to open: the tour keeps its place and shows nothing over the failure notice. */
  paused?: boolean
}) {
  // null until mounted, so the server render and a returning visitor never flash the tour
  const [state, setState] = useState<CoachState | null>(null)
  // the hint's «×» hides it for this visit only; «تخطَّ الجولة» ends the tour for good
  const [hidden, setHidden] = useState(false)
  useEffect(() => { setHidden(false) }, [state])
  // «ما الجديد» waits while the tour has something on screen, so the two never cover each other
  // a map that failed to open holds the whole tour back: its notice takes the top of the map, where the row would sit
  const showing = !paused && (state === 'goal' || ((state === 'waiting_pick' || state === 'waiting_explain') && !hidden))
  useEffect(() => { setMapTourShowing(showing) }, [showing])
  useEffect(() => () => setMapTourShowing(false), [])
  // counted as asked only once the row is actually on screen
  useEffect(() => { if (state === 'goal' && !paused) markAsked() }, [state, paused])
  const go = (next: CoachState, via?: 'explain' | 'button') => {
    if (next === 'completed') trackOnboardingStep('completed', { via })
    if (next === 'skipped') trackOnboardingStep('skipped', { at: state ?? undefined })
    setState(next)
    if (next === 'completed' || next === 'skipped') write(next)
  }

  useEffect(() => {
    const saved = read()
    // a link that already names a goal (?lens= / ?goal=) has answered the first question, and so has an earlier visit
    // that was shown it
    const query = new URLSearchParams(window.location.search)
    const first = saved === 'not_started' ? (query.get('lens') || query.get('goal') || asked() ? 'waiting_pick' : 'goal') : saved
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
  if (paused) return help

  const skip = <button onClick={() => go('skipped')} className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">تخطَّ الجولة</button>
  // the two hints on the map are one small line pinned to its top, under the phone's floating filters: they never sit
  // over the middle of the map, where the visitor taps a district, nor over the colour key in its bottom corner
  const hint = (icon: ReactNode, text: ReactNode, action?: ReactNode) => hidden ? help : (
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
    // one line of chips at the top of the map, under the phone's floating filters (clear of the map's «؟» and link buttons from lg):
    // the panel and its open step stay as they are, and the row scrolls sideways when the goals do not fit
    return (
      <>
        {help}
        <div className="pointer-events-none absolute inset-x-3 top-[7.5rem] z-[15] flex justify-center lg:start-3 lg:end-52 lg:top-3">
          <section aria-label="اختر هدفك" className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border bg-card/95 py-1 ps-3 pe-1 text-sm shadow-md backdrop-blur animate-in fade-in slide-in-from-top-1 duration-300">
            <Target className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="shrink-0 font-semibold">هدفك:</span>
            {/* relative: the chips' screen-reader words are clipped with the row, so they never widen a phone's page */}
            <ul className="relative flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]">
              {LENSES.map((item) => (
                <li key={item.id} className="shrink-0">
                  <button onClick={() => {
                    trackOnboardingStep('goal_picked', { lens: item.id })
                    // a district picked before the goal still counts as the pick step
                    if (picked) trackOnboardingStep('district_picked')
                    onLens(item.id)
                    setState(picked ? 'waiting_explain' : 'waiting_pick')
                  }}
                    title={item.label}
                    className="min-h-8 rounded-full border bg-card px-3 py-1 font-medium whitespace-nowrap transition-colors outline-none hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/60 data-[current=true]:border-primary data-[current=true]:text-primary"
                    data-current={item.id === lens}>
                    {LENS_GOALS[item.id]}<span className="sr-only"> ({item.label})</span>
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => go('skipped')} aria-label="إخفاء الأهداف" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
          </section>
        </div>
      </>
    )
  }

  if (state === 'waiting_pick') {
    if (firstAsk) return hint(<MousePointerClick className="size-4 shrink-0 text-primary" aria-hidden />, firstAsk,
      onFirstAsk && <button onClick={onFirstAsk} className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline lg:hidden">ابدأ</button>)
    return hint(<MousePointerClick className="size-4 shrink-0 text-primary" aria-hidden />, onShowMe ? <><span className="lg:hidden">اضغط حياً</span><span className="max-lg:hidden">اضغط حياً على الخريطة</span></> : 'اختر حياً: اضغطه على الخريطة',
      onShowMe && <button onClick={() => { trackOnboardingStep('show_me'); onShowMe() }} className="max-w-[9rem] shrink-0 truncate text-sm font-semibold text-primary underline-offset-4 hover:underline">{showMeName ? `أو اعرض ${showMeName}` : 'أو أرني الأعلى'}</button>)
  }

  // waiting_explain: the pick is done, so the line now points at the «i» beside a figure in the panel
  return hint(<Info className="size-4 shrink-0 text-primary" aria-hidden />, 'اضغط «i» لترى كيف حُسب الرقم',
    <button onClick={() => go('completed', 'button')} className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline">فهمت</button>)
}
