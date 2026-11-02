'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { CircleHelp, Info, MousePointerClick, X } from 'lucide-react'
import { setMapTourShowing } from '@/components/shared/whats-new'
import { trackOnboardingStep } from '@/lib/commercial-metrics'
import { LENSES, type LensId } from './lenses'

/**
 * The first visit to the map (skills: product-adoption, interactive-onboarding, onboarding-state-machine): one question
 * about the visitor's goal, then two hints on the real map that advance when the visitor does the thing, not on «التالي»:
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
const EXPLAINED = '[aria-label="لوحة الخريطة"] [aria-label^="كيف حُسب"]'

function read(): CoachState {
  try { return (localStorage.getItem(KEY) as CoachState | null) ?? 'not_started' } catch { return 'completed' }
}
function write(state: CoachState) {
  try { localStorage.setItem(KEY, state) } catch { /* private window: the tour simply shows again next time */ }
}

export function MapOnboarding({ lens, onLens, picked, paused = false }: {
  lens: LensId
  onLens: (lens: LensId) => void
  picked: boolean
  /** The map failed to open: the tour keeps its place but shows nothing over the failure notice. */
  paused?: boolean
}) {
  // null until mounted, so the server render and a returning visitor never flash the tour
  const [state, setState] = useState<CoachState | null>(null)
  // the hint's «×» hides it for this visit only; «تخطَّ الجولة» ends the tour for good
  const [hidden, setHidden] = useState(false)
  useEffect(() => { setHidden(false) }, [state])
  // «ما الجديد» waits while the tour has something on screen, so the two never cover each other
  const showing = !paused && (state === 'goal' || ((state === 'waiting_pick' || state === 'waiting_explain') && !hidden))
  useEffect(() => { setMapTourShowing(showing) }, [showing])
  useEffect(() => () => setMapTourShowing(false), [])
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
    const opened = (event: MouseEvent) => { if ((event.target as Element | null)?.closest?.('[aria-label^="كيف حُسب"]')) go('completed', 'explain') }
    document.addEventListener('click', opened, true)
    return () => { watch.disconnect(); target?.classList.remove('coach-target'); document.removeEventListener('click', opened, true) }
  }, [state])

  const restart = () => { trackOnboardingStep('restarted'); setState('goal') }
  const help = (
    <button onClick={restart} aria-label="جولة سريعة في الخريطة"
      className="absolute end-3 bottom-14 z-10 grid size-10 place-items-center rounded-full border bg-card/95 text-muted-foreground shadow-sm backdrop-blur transition-colors outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 lg:top-3 lg:bottom-auto">
      <CircleHelp className="size-5" aria-hidden />
    </button>
  )

  if (paused || state === null || state === 'completed' || state === 'skipped' || state === 'not_started') return help

  const card = 'absolute inset-x-3 z-30 mx-auto max-w-sm rounded-2xl border bg-card p-4 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300'
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
    return (
      <div role="dialog" aria-labelledby="coach-goal" className={`${card} top-3 max-w-md`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="coach-goal" className="text-lg font-bold">وش تبي تحقق؟</h2>
            <p className="text-sm text-muted-foreground">اختر هدفك ونجهّز لك الخريطة وخطواتها.</p>
          </div>
          <button onClick={() => go('skipped')} aria-label="إغلاق" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" aria-hidden /></button>
        </div>
        <ul className="mt-3 grid gap-2">
          {LENSES.map((item) => (
            <li key={item.id}>
              <button onClick={() => {
                trackOnboardingStep('goal_picked', { lens: item.id })
                // a district picked before the goal still counts as the pick step
                if (picked) trackOnboardingStep('district_picked')
                onLens(item.id)
                setState(picked ? 'waiting_explain' : 'waiting_pick')
              }}
                className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start transition-colors outline-none hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/60 data-[current=true]:border-primary"
                data-current={item.id === lens}>
                <span className="font-semibold">{GOALS[item.id]}</span>
                <span className="text-xs text-muted-foreground">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (state === 'waiting_pick') return hint(<MousePointerClick className="size-4 shrink-0 text-primary" aria-hidden />, 'اختر حياً: اضغطه على الخريطة')

  // waiting_explain: the pick is done, so the line now points at the «i» beside a figure in the panel
  return hint(<Info className="size-4 shrink-0 text-primary" aria-hidden />, 'اضغط «i» لترى كيف حُسب الرقم',
    <button onClick={() => go('completed', 'button')} className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline">فهمت</button>)
}
