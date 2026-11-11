'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { answerCache } from './answer-cache.ts'

/**
 * A counter that names each request, so only the latest one may land: `next()` before asking, `isLatest(token)` when
 * the answer comes back. A request left behind by a new question (or an unmount) is dropped, never shown under the
 * new question's name. Kept apart from React so it is tested (tool-answers.test.ts).
 */
export function answerSequence() {
  let current = 0
  return {
    next: () => ++current,
    isLatest: (token: number) => token === current,
    /** Drop whatever is in flight, without asking anything new. */
    drop: () => { current++ },
  }
}

export type Answer<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** The answer to the current question only; null while it loads, after a failure, or with nothing asked. */
  data: T | null
  error: unknown
  /** Still loading after `slowAfter` ms: the tool says it is still working instead of leaving a skeleton unexplained. */
  slow: boolean
  /** Ask the same question again («أعد المحاولة»). */
  retry: () => void
}

type Held<T> = { key: string | null; attempt: number; status: Answer<T>['status']; data: T | null; error: unknown; slow: boolean }

/**
 * One tool request, the way every lens tool asks: keyed by a string that names what is asked (the city, the activity's
 * q or main_id, the filters), never by an object or array, so a new object for the same question asks nothing again.
 * A new key clears the previous answer at once (in the same render, so the map never paints the old answer under the
 * new question), and a late answer to an old key is dropped. `key` null asks nothing (status «idle»). `run` is read
 * when the key changes, so it may close over the current values freely.
 */
export function useAnswer<T>(key: string | null, run: () => Promise<T>, { slowAfter = 8000, cache, keep }: {
  slowAfter?: number
  /** Keep the answer for the visit under `${cache}|${key}` (answer-cache.ts): asked again, it is shown at once. Only
   * for an answer that is plain JSON and the same for everyone who asks the same key. */
  cache?: string
  /** Whether this answer is worth keeping (one with a part that failed is asked again next time); all by default. */
  keep?: (data: T) => boolean
} = {}): Answer<T> {
  const keepRef = useRef(keep)
  useEffect(() => { keepRef.current = keep })
  const cacheKey = cache && key != null ? `${cache}|${key}` : null
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })
  const sequence = useRef(answerSequence())
  // the question asked last, so a retry of the same key (and only that) skips the kept answer
  const asked = useRef<{ key: string | null; attempt: number }>({ key: null, attempt: 0 })
  const [attempt, setAttempt] = useState(0)
  const [held, setHeld] = useState<Held<T>>({ key: null, attempt: 0, status: 'idle', data: null, error: null, slow: false })

  useEffect(() => {
    const token = sequence.current.next()
    if (key == null) { setHeld({ key, attempt, status: 'idle', data: null, error: null, slow: false }); return }
    // a retry asks afresh; otherwise an answer kept for this visit is shown at once, with no request
    if (cacheKey && attempt !== asked.current.attempt && key === asked.current.key) answerCache.drop(cacheKey)
    asked.current = { key, attempt }
    const kept = cacheKey ? answerCache.get<T>(cacheKey) : undefined
    if (kept !== undefined) { setHeld({ key, attempt, status: 'ready', data: kept, error: null, slow: false }); return }
    setHeld({ key, attempt, status: 'loading', data: null, error: null, slow: false })
    const timer = setTimeout(() => { if (sequence.current.isLatest(token)) setHeld((now) => ({ ...now, slow: true })) }, slowAfter)
    // a kept question goes through the cache, so a request already on its way for it (the map's ask-ahead) is shared
    const asking = cacheKey ? answerCache.run<T>(cacheKey, () => runRef.current(), (data) => keepRef.current?.(data) ?? true) : runRef.current()
    asking.then(
      (data) => {
        if (sequence.current.isLatest(token)) setHeld({ key, attempt, status: 'ready', data, error: null, slow: false })
      },
      (error: unknown) => { if (sequence.current.isLatest(token)) setHeld({ key, attempt, status: 'error', data: null, error, slow: false }) },
    ).finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); if (sequence.current.isLatest(token)) sequence.current.drop() }
  }, [key, attempt, slowAfter, cacheKey])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  // the render right after a new key (or a retry), before the effect above has run: already the new question's state
  if (held.key !== key || held.attempt !== attempt) {
    const kept = cacheKey && attempt === held.attempt ? answerCache.get<T>(cacheKey) : undefined
    if (kept !== undefined) return { status: 'ready', data: kept, error: null, slow: false, retry }
    return { status: key == null ? 'idle' : 'loading', data: null, error: null, slow: false, retry }
  }
  return { status: held.status, data: held.data, error: held.error, slow: held.slow, retry }
}

/** True once `loading` has stayed true for `after` ms; false again as soon as it stops. */
export function useSlow(loading: boolean, after = 8000): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    if (!loading) return
    const timer = setTimeout(() => setSlow(true), after)
    return () => clearTimeout(timer)
  }, [loading, after])
  return loading && slow
}
