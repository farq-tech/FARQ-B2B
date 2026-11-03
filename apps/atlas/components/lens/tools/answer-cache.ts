/**
 * The answers worth keeping for the visit: a slow step's answer (the gaps of an activity in a city, its competitors,
 * its streets) is kept under the question it answers (`${namespace}|${city}|${activity}`), so leaving the step and
 * coming back, or another step asking the same, shows it at once instead of a second half-minute wait. Held in memory
 * for the page, and in this tab's sessionStorage when it fits, so a reload keeps it too. Nothing leaves the browser;
 * a closed tab forgets it. Kept apart from React so it is tested (answer-cache.test.ts).
 *
 * An answer lasts `ttl` (30 minutes), and all of them go when the data version changes (`setVersion`: the directory's
 * own counts per city, as the city list reports them, so a new snapshot is never read through an old answer).
 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { key?: (index: number) => string | null; readonly length?: number }
type Entry = { value: unknown; at: number; version: string }

const PREFIX = 'atlas.answer|'
const VERSION_KEY = 'atlas.answer.version'
/** An answer larger than this stays in memory only (sessionStorage holds a few MB for the whole tab). */
const MAX_STORED = 200_000
/** At most this many answers in memory; the oldest goes first. */
const MAX_HELD = 40
export const ANSWER_TTL = 30 * 60 * 1000
/** Bumped when an answer's shape changes in the code, so an answer kept by an older page is never read by a newer one. */
const SHAPE = '1'

export function createAnswerCache(storage: () => Store | null, { now = Date.now, ttl = ANSWER_TTL }: { now?: () => number; ttl?: number } = {}) {
  const held = new Map<string, Entry>()
  let version: string | null = null
  const current = () => {
    if (version == null) { try { version = storage()?.getItem(VERSION_KEY) ?? '' } catch { version = '' } }
    return `${SHAPE}|${version}`
  }
  const keep = (key: string, entry: Entry) => {
    held.delete(key)
    held.set(key, entry)
    while (held.size > MAX_HELD) held.delete(held.keys().next().value as string)
  }
  const fresh = (entry: Entry | undefined) => entry != null && entry.version === current() && now() - entry.at < ttl
  const drop = (key: string) => {
    held.delete(key)
    try { storage()?.removeItem(PREFIX + key) } catch { /* blocked storage */ }
  }
  return {
    get<T>(key: string): T | undefined {
      let entry = held.get(key)
      if (!entry) {
        try {
          const text = storage()?.getItem(PREFIX + key)
          entry = text == null ? undefined : JSON.parse(text) as Entry
        } catch { entry = undefined }
      }
      if (!entry) return undefined
      if (!fresh(entry)) { drop(key); return undefined }
      keep(key, entry)
      return entry.value as T
    },
    set(key: string, value: unknown) {
      const entry: Entry = { value, at: now(), version: current() }
      keep(key, entry)
      try {
        const text = JSON.stringify(entry)
        if (text.length <= MAX_STORED) storage()?.setItem(PREFIX + key, text)
      } catch { /* full or blocked storage: memory only */ }
    },
    /** Forget one answer («أعد المحاولة» asks afresh). */
    drop,
    /** The data the answers were worked out from: a new version forgets every kept answer. */
    setVersion(next: string) {
      if (current() === `${SHAPE}|${next}`) return
      version = next
      held.clear()
      try {
        const store = storage()
        store?.setItem(VERSION_KEY, next)
        const keys: string[] = []
        for (let index = 0; store?.key && index < (store.length ?? 0); index++) { const key = store.key(index); if (key?.startsWith(PREFIX)) keys.push(key) }
        for (const key of keys) store?.removeItem(key)
      } catch { /* blocked storage: the memory is cleared */ }
    },
  }
}

/** The data version from the city list: each city's districts and business count, as the service reports them. */
export function dataVersion(cities: readonly { en: string; districts?: number; n?: number }[]): string {
  return cities.map((city) => `${city.en}:${city.districts ?? ''}:${city.n ?? ''}`).sort().join(',')
}

/** The page's one cache, over this tab's sessionStorage. */
export const answerCache = createAnswerCache(() => (typeof window === 'undefined' ? null : window.sessionStorage))
