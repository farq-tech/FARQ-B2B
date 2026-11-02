/**
 * Operating status and "open now" for one business, from the v13 enrichment columns.
 *
 * `open_now` is a faithful port of services/targeting-api/build_hours_canonical.py: the same canonical weekly schema
 * (keys "sun".."sat", each a list of ["HH:MM","HH:MM"] pairs; a closed day is [], all day is [["00:00","24:00"]], a
 * close at midnight is written "24:00"), the same handling of overnight ranges and split shifts, evaluated against the
 * current time in Asia/Riyadh (fixed UTC+3, no daylight saving). Keeping the algorithm identical to the builder means
 * the badge the owner sees matches how the release was computed.
 */

export type StatusVoted =
  | 'open'
  | 'closed_temporary'
  | 'closed_permanent'
  | 'inactive'
  | 'unknown_empty'
  | 'unknown_invalid'

export type WhatsappState = 'verified' | 'source_flag_unverified' | 'not_available'

export type HoursWeek = Record<string, [string, string][]>

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** Arabic operating-status label, or null when the status is unknown (the caller then shows «غير متاح»). */
const STATUS_LABEL: Record<StatusVoted, string | null> = {
  open: 'مفتوح',
  closed_temporary: 'مغلق مؤقتاً',
  closed_permanent: 'مغلق نهائياً',
  inactive: 'غير نشط',
  unknown_empty: null,
  unknown_invalid: null,
}

export function statusLabel(status: string | null | undefined): string | null {
  return status && status in STATUS_LABEL ? STATUS_LABEL[status as StatusVoted] : null
}

/** Minutes since midnight (0..1440) for a canonical "HH:MM" / "24:00" token, or null if unparseable. */
function toMin(token: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(token.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (minute > 59 || hour > 24 || (hour === 24 && minute > 0)) return null
  return hour * 60 + minute
}

function fmt(minutes: number): string {
  if (minutes >= 1440) return '24:00'
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** A day's [["HH:MM","HH:MM"],..] as [start, end] minute pairs; a midnight-as-"00:00" close becomes 1440. */
function intervalsMin(dayList: [string, string][] | undefined): [number, number][] {
  const out: [number, number][] = []
  for (const pair of dayList || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    const sm = toMin(String(pair[0]))
    let em = toMin(String(pair[1]))
    if (sm === null || em === null) continue
    if (em === 0) em = 1440
    out.push([sm, em])
  }
  return out
}

export function parseHoursWeek(value: unknown): HoursWeek | null {
  let week: unknown = value
  if (typeof week === 'string') {
    const text = week.trim()
    if (!text) return null
    try {
      week = JSON.parse(text)
    } catch {
      return null
    }
  }
  if (!week || typeof week !== 'object' || Array.isArray(week)) return null
  const record = week as Record<string, unknown>
  if (!DAYS.some((day) => Array.isArray(record[day]))) return null
  return record as HoursWeek
}

/** Riyadh-local day key and minutes-since-midnight for an instant (Asia/Riyadh is fixed UTC+3). */
function riyadhNow(now: Date): { key: string; cur: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const weekday = parts.find((part) => part.type === 'weekday')?.value || 'Sun'
  let hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  if (hour === 24) hour = 0 // some runtimes emit "24" at midnight under hour12:false
  return { key: weekday.toLowerCase().slice(0, 3), cur: hour * 60 + minute }
}

export interface OpenNow {
  open: boolean
  /** Closing time of the interval currently in progress, "HH:MM", when open. */
  until: string | null
  /** Clock time of the next opening, "HH:MM", when currently closed (scanning up to 7 days). */
  opensAt: string | null
}

/**
 * Is the business open at `now` (Asia/Riyadh)? Faithful port of build_hours_canonical.open_now: spillover from
 * yesterday's overnight interval, today's intervals (including an overnight shift starting today), then the next
 * opening when closed. Returns null when there is no usable weekly schedule, so the caller shows «غير متاح».
 */
export function openNow(hoursWeek: unknown, now: Date = new Date()): OpenNow | null {
  const week = parseHoursWeek(hoursWeek)
  if (!week) return null
  const { key: today, cur } = riyadhNow(now)
  const index = DAYS.indexOf(today as (typeof DAYS)[number])
  if (index < 0) return null
  const prev = DAYS[(index - 1 + 7) % 7]

  // 1) spillover from yesterday's overnight interval into today
  for (const [sm, em] of intervalsMin(week[prev])) {
    if (em <= sm && cur < em) return { open: true, until: fmt(em), opensAt: null }
  }
  // 2) today's intervals
  for (const [sm, em] of intervalsMin(week[today])) {
    if (em <= sm) {
      if (cur >= sm) return { open: true, until: fmt(em), opensAt: null }
    } else if (sm <= cur && cur < em) {
      return { open: true, until: fmt(em), opensAt: null }
    }
  }
  // 3) closed now -> next opening clock time (today first, then up to 7 days ahead)
  const todayStarts = intervalsMin(week[today]).map(([sm]) => sm).filter((sm) => sm > cur).sort((a, b) => a - b)
  if (todayStarts.length) return { open: false, until: null, opensAt: fmt(todayStarts[0]) }
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const starts = intervalsMin(week[DAYS[(index + ahead) % 7]]).map(([sm]) => sm).sort((a, b) => a - b)
    if (starts.length) return { open: false, until: null, opensAt: fmt(starts[0]) }
  }
  return { open: false, until: null, opensAt: null }
}

const DAY_LABEL_AR: Record<string, string> = {
  sun: 'الأحد', mon: 'الاثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت',
}

export interface TodayHours {
  day: string
  /** [start, end] pairs for today; empty means closed today. */
  intervals: [string, string][]
}

/** Today's (Asia/Riyadh) day label and its intervals, or null when there is no usable schedule. */
export function todayHours(hoursWeek: unknown, now: Date = new Date()): TodayHours | null {
  const week = parseHoursWeek(hoursWeek)
  if (!week) return null
  const { key } = riyadhNow(now)
  const raw = Array.isArray(week[key]) ? week[key] : []
  const intervals = raw.filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length >= 2
    && toMin(String(pair[0])) !== null && toMin(String(pair[1])) !== null)
    .map((pair) => [String(pair[0]), String(pair[1])] as [string, string])
  return { day: DAY_LABEL_AR[key] || key, intervals }
}
