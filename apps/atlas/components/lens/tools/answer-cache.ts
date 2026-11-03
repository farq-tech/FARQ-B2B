/**
 * The answers worth keeping for the visit: a slow step's answer (the gaps of an activity in a city, its competitors,
 * its streets) is kept under the question it answers (`${namespace}|${city}|${activity}`), so leaving the step and
 * coming back, or another step asking the same, shows it at once instead of a second half-minute wait. Held in memory
 * for the page, and in this tab's sessionStorage when it fits, so a reload keeps it too. Nothing leaves the browser;
 * a closed tab forgets it. Kept apart from React so it is tested (answer-cache.test.ts).
 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const PREFIX = 'atlas.answer|'
/** An answer larger than this stays in memory only (sessionStorage holds a few MB for the whole tab). */
const MAX_STORED = 200_000
/** At most this many answers in memory; the oldest goes first. */
const MAX_HELD = 40

export function createAnswerCache(storage: () => Store | null) {
  const held = new Map<string, unknown>()
  const keep = (key: string, value: unknown) => {
    held.delete(key)
    held.set(key, value)
    while (held.size > MAX_HELD) held.delete(held.keys().next().value as string)
  }
  return {
    get<T>(key: string): T | undefined {
      if (held.has(key)) return held.get(key) as T
      try {
        const text = storage()?.getItem(PREFIX + key)
        if (text == null) return undefined
        const value = JSON.parse(text) as T
        keep(key, value)
        return value
      } catch { return undefined }
    },
    set(key: string, value: unknown) {
      keep(key, value)
      try {
        const text = JSON.stringify(value)
        if (text.length <= MAX_STORED) storage()?.setItem(PREFIX + key, text)
      } catch { /* full or blocked storage: memory only */ }
    },
    /** Forget one answer («أعد المحاولة» asks afresh). */
    drop(key: string) {
      held.delete(key)
      try { storage()?.removeItem(PREFIX + key) } catch { /* blocked storage */ }
    },
  }
}

/** The page's one cache, over this tab's sessionStorage. */
export const answerCache = createAnswerCache(() => (typeof window === 'undefined' ? null : window.sessionStorage))
