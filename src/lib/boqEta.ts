// Copied from فرق بناء (read-only source): farqconstraction/src/lib/boqEta.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/**
 * Expected time-to-finish for reading one booklet.
 *
 * Every number that leaves this module traces back to a measurement: pages or
 * lines per second observed inside the *current* run, or the duration of
 * previous reads on this device. There is deliberately no constant to fall back
 * on — booklets here span 45 lines to 10,219, and a 200-line read moved from 84s
 * to 22s after optimisation, so any hardcoded number is wrong by an order of
 * magnitude within a week.
 *
 * The screen this feeds already shipped one lie: a timer-driven bar that froze at
 * 69% two seconds into every upload. A countdown that reaches zero and keeps
 * spinning is the same lie with a sharper face, so three rules are enforced here
 * rather than left to the view:
 *   1. No measurement → `remainingMs` is null. The UI must say "we don't know yet".
 *   2. Once a published estimate elapses, the phase latches `overdue`; we never
 *      publish another finish time for it and never stop counting elapsed.
 *   3. Legs that are a single opaque HTTP request are marked `opaque`. Their
 *      progress is unknown, so no fraction is invented for them.
 */

/** One unit of real work, in execution order. */
export type BoqEtaLeg =
  | 'hash'
  | 'extract'
  /** Column-aware table read: groups rows, merges wrapped cells, names columns. */
  | 'table'
  | 'api-parse'
  | 'resolve'
  | 'match-remote'
  | 'match-catalog'
  | 'match-pools'
  | 'match-rank'

/** What the owner is waiting on, coarse enough to name on screen. */
export type BoqEtaPhase = 'local-read' | 'server-read' | 'analyze' | 'match'

export type BoqEtaUnit = 'page' | 'pool' | 'line'

const PHASE_BY_LEG: Record<BoqEtaLeg, BoqEtaPhase> = {
  hash: 'local-read',
  extract: 'local-read',
  table: 'local-read',
  'api-parse': 'server-read',
  resolve: 'analyze',
  'match-remote': 'match',
  'match-catalog': 'match',
  'match-pools': 'match',
  'match-rank': 'match',
}

const PHASE_ORDER: BoqEtaPhase[] = ['local-read', 'server-read', 'analyze', 'match']

export type BoqWorkEvent =
  | {
      kind: 'start'
      leg: BoqEtaLeg
      /** Units this leg will report, when it reports any. */
      unit?: BoqEtaUnit
      total?: number
      /** Hard stop already enforced on this leg by the caller. */
      capMs?: number
      /** A single request/response with no internal progress to read. */
      opaque?: boolean
      /** Known booklet line count, once parsing has produced it. */
      lines?: number
    }
  | { kind: 'tick'; leg: BoqEtaLeg; done: number; total?: number }
  | { kind: 'end'; leg: BoqEtaLeg }

export type BoqWorkProgress = (event: BoqWorkEvent) => void

/* -------------------------------------------------------------------------- */
/* Calibration: measured durations of previous reads on this device            */
/* -------------------------------------------------------------------------- */

export type BoqSizedSample = { size: number; ms: number; at: number }

export type BoqCalibration = {
  version: 1
  /** size = pages extracted locally. */
  localRead: BoqSizedSample[]
  /** size = pages; measures the bounded wait on the Farq parse-pdf request. */
  serverRead: BoqSizedSample[]
  /** size = booklet lines; the whole supplier-matching stage. */
  match: BoqSizedSample[]
}

/**
 * Bumped to v2 because the matcher it was calibrated against no longer exists:
 * `boq/match` went from 69 rows to 30 and is skipped outright when the upload
 * resolves every line (2424ms → 1597ms, 0.79MB → 0.19MB). Samples taken before
 * that describe a slower engine, and eight of them would have kept the first
 * estimate of every run long for eight runs. Discarding them costs the honest
 * «لم نقِس ما يكفي بعد» on one run and buys a correct number afterwards.
 *
 * Still keyed on booklet lines, not on lines left unresolved: the cost now
 * tracks the latter, but it is unknowable until matching has already run, and a
 * predictor cannot key on what it cannot see yet. The in-run rate corrects it.
 */
const CALIBRATION_KEY = 'farq.boq.eta.v2'
/** Keep recent runs only — the API and the matcher both keep getting faster. */
const MAX_SAMPLES = 8

export function emptyCalibration(): BoqCalibration {
  return { version: 1, localRead: [], serverRead: [], match: [] }
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** Calibration lives in memory for this tab only (owner 2026-10-16: nothing is kept on the device). */
const memoryStore: Storage = (() => {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
})()

function defaultStore(): Storage | null {
  return memoryStore
}

function sanitizeSamples(value: unknown): BoqSizedSample[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (row): row is BoqSizedSample =>
        !!row &&
        typeof row === 'object' &&
        Number.isFinite((row as BoqSizedSample).size) &&
        Number.isFinite((row as BoqSizedSample).ms) &&
        (row as BoqSizedSample).size > 0 &&
        (row as BoqSizedSample).ms >= 0,
    )
    .slice(-MAX_SAMPLES)
}

export function loadBoqCalibration(store: Storage | null = defaultStore()): BoqCalibration {
  if (!store) return emptyCalibration()
  try {
    const raw = store.getItem(CALIBRATION_KEY)
    if (!raw) return emptyCalibration()
    const parsed = JSON.parse(raw) as Partial<BoqCalibration>
    return {
      version: 1,
      localRead: sanitizeSamples(parsed.localRead),
      serverRead: sanitizeSamples(parsed.serverRead),
      match: sanitizeSamples(parsed.match),
    }
  } catch {
    return emptyCalibration()
  }
}

export function saveBoqCalibration(
  calibration: BoqCalibration,
  store: Storage | null = defaultStore(),
): void {
  if (!store) return
  try {
    store.setItem(CALIBRATION_KEY, JSON.stringify(calibration))
  } catch {
    /* quota / private mode — the next run simply has no history to read */
  }
}

export type BoqEtaBasis = 'in-run' | 'history-fit' | 'history-ratio'

/**
 * Predict duration for `size` from measured samples.
 *
 * Two or more distinct sizes get a least-squares `a + b·size` fit, because the
 * cost really is one fixed part (a 6MB directory download, one match request)
 * plus a per-line part. A single sample can only be scaled — honest, but coarse,
 * so the basis is reported back so the UI can label it as such.
 */
export function predictMs(
  samples: BoqSizedSample[],
  size: number,
): { ms: number; basis: Exclude<BoqEtaBasis, 'in-run'>; samples: number } | null {
  const rows = samples.filter((s) => s.size > 0 && Number.isFinite(s.ms))
  if (!rows.length || !(size > 0)) return null

  const distinct = new Set(rows.map((s) => s.size))
  if (rows.length >= 2 && distinct.size >= 2) {
    const n = rows.length
    const sumX = rows.reduce((t, s) => t + s.size, 0)
    const sumY = rows.reduce((t, s) => t + s.ms, 0)
    const sumXY = rows.reduce((t, s) => t + s.size * s.ms, 0)
    const sumXX = rows.reduce((t, s) => t + s.size * s.size, 0)
    const denom = n * sumXX - sumX * sumX
    if (denom !== 0) {
      let b = (n * sumXY - sumX * sumY) / denom
      let a = (sumY - b * sumX) / n
      // A negative slope or intercept is fit noise, not physics. Refit through
      // the origin rather than promising a read that gets cheaper as it grows.
      if (b < 0 || a < 0) {
        b = sumXX > 0 ? sumXY / sumXX : 0
        a = 0
      }
      const ms = a + b * size
      if (Number.isFinite(ms) && ms >= 0) return { ms, basis: 'history-fit', samples: n }
    }
  }

  // Single measurement (or one repeated size): scale it.
  const recent = rows[rows.length - 1]!
  const ms = (recent.ms / recent.size) * size
  if (!Number.isFinite(ms) || ms < 0) return null
  return { ms, basis: 'history-ratio', samples: rows.length }
}

/* -------------------------------------------------------------------------- */
/* In-run tracker                                                             */
/* -------------------------------------------------------------------------- */

/** A rate needs at least this much evidence before it is shown as a number. */
const MIN_TICKS = 2
const MIN_LEG_MS = 600
const MIN_FRACTION = 0.04
const RATE_ALPHA = 0.3
/** Disclose an upward revision rather than sliding the goalpost quietly. */
const REVISION_RATIO = 1.2
const REVISION_MS = 3_000
/**
 * How late is late. Below a second, the countdown's own rounding is larger than
 * the miss, and announcing an overrun for rounding noise would train the owner
 * to ignore the message on the day it means something. Inside the grace the
 * estimate reads zero — "finishing now" — and never a fresh number.
 */
const OVERDUE_GRACE_MS = 1_000
const OVERDUE_GRACE_RATIO = 0.1

type LegState = {
  leg: BoqEtaLeg
  unit: BoqEtaUnit | null
  total: number | null
  capMs: number | null
  opaque: boolean
  startedAt: number
  endedAt: number | null
  done: number
  ticks: number
  lastTickAt: number
  lastTickDone: number
  /** Last moment real work was observed. A slip with no new evidence is a stall. */
  lastEvidenceAt: number
  msPerUnit: number | null
}

type PhaseState = {
  startedAt: number
  endedAt: number | null
  /** Finish time currently shown to the owner, so we can tell when we broke it. */
  publishedFinishAt: number | null
  /** When that finish time was computed, to require fresh evidence for a slip. */
  publishedAt: number | null
  /** The first promise we made, kept so an upward revision can admit it. */
  firstPromisedMs: number | null
  overdueAt: number | null
  revisedUp: boolean
  lastPublishedMs: number | null
}

export type BoqEtaView = {
  elapsedMs: number
  phase: BoqEtaPhase | null
  leg: BoqEtaLeg | null
  /** `opaque` legs are one request with no readable progress. */
  legKind: 'measured' | 'opaque' | null
  unit: BoqEtaUnit | null
  done: number | null
  total: number | null
  /** Measured units/second for the active leg — null until there is evidence. */
  ratePerSec: number | null
  /** Real fraction of the active leg. Never synthesised for opaque legs. */
  legFraction: number | null
  /** Seconds left in the current phase. Null means: not measurable yet. */
  remainingMs: number | null
  basis: BoqEtaBasis | null
  /** Number of past reads behind a history-based estimate. */
  historySamples: number
  /** Hard stop on the active leg, when the caller enforces one. */
  legCapMs: number | null
  /** True once a published estimate elapsed while the phase kept working. */
  overdue: boolean
  overdueByMs: number
  /** The first estimate this phase published, kept for the apology when broken. */
  brokenEstimateMs: number | null
  /** The first promise made in this phase, so a revision can admit what changed. */
  firstPromisedMs: number | null
  /** An earlier estimate in this phase was revised upward after slower measurement. */
  revisedUp: boolean
  /** Phases still ahead of the current one, so the UI can name what is left. */
  remainingPhases: BoqEtaPhase[]
  /** Booklet line count, once known. Matching cannot be estimated before this. */
  lines: number | null
  /** Pages the local extract reported, once the PDF opened. */
  pages: number | null
  /** Set when a phase already overran earlier in this same run. */
  overranEarlier: boolean
}

export class BoqEtaTracker {
  private readonly now: () => number
  private readonly calibration: BoqCalibration
  private readonly startedAt: number
  private legs = new Map<BoqEtaLeg, LegState>()
  private phases = new Map<BoqEtaPhase, PhaseState>()
  private activeLeg: BoqEtaLeg | null = null
  private lines: number | null = null
  private pages: number | null = null
  private overranEarlier = false
  private finishedAt: number | null = null

  constructor(opts: { now?: () => number; calibration?: BoqCalibration } = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.calibration = opts.calibration ?? loadBoqCalibration()
    this.startedAt = this.now()
  }

  note(event: BoqWorkEvent): void {
    const at = this.now()
    const phase = PHASE_BY_LEG[event.leg]

    if (event.kind === 'start') {
      // A restart (pdf.js falling back to the legacy build) discards the old
      // samples: the new engine has its own speed, so measuring resumes.
      this.legs.set(event.leg, {
        leg: event.leg,
        unit: event.unit ?? null,
        total: event.total ?? null,
        capMs: event.capMs ?? null,
        opaque: event.opaque ?? false,
        startedAt: at,
        endedAt: null,
        done: 0,
        ticks: 0,
        lastTickAt: at,
        lastTickDone: 0,
        lastEvidenceAt: at,
        msPerUnit: null,
      })
      this.activeLeg = event.leg
      if (typeof event.lines === 'number' && event.lines > 0) this.lines = event.lines
      if (!this.phases.has(phase)) {
        this.phases.set(phase, {
          startedAt: at,
          endedAt: null,
          publishedFinishAt: null,
          publishedAt: null,
          firstPromisedMs: null,
          overdueAt: null,
          revisedUp: false,
          lastPublishedMs: null,
        })
      }
      return
    }

    const leg = this.legs.get(event.leg)
    if (!leg) return

    if (event.kind === 'tick') {
      if (typeof event.total === 'number' && event.total > 0) leg.total = event.total
      const done = Math.max(leg.done, event.done)
      if (done > leg.lastTickDone) {
        const deltaMs = at - leg.lastTickAt
        const deltaUnits = done - leg.lastTickDone
        const instant = deltaMs / deltaUnits
        const overall = (at - leg.startedAt) / done
        leg.msPerUnit =
          leg.msPerUnit === null ? overall : RATE_ALPHA * instant + (1 - RATE_ALPHA) * leg.msPerUnit
        leg.lastTickAt = at
        leg.lastTickDone = done
        leg.lastEvidenceAt = at
        leg.ticks += 1
      }
      leg.done = done
      if (leg.leg === 'extract' && leg.total) this.pages = leg.total
      return
    }

    leg.endedAt = at
    if (leg.total) leg.done = leg.total
    if (leg.leg === 'extract' && leg.total) this.pages = leg.total
    if (this.activeLeg === event.leg) this.activeLeg = null
    // Close the phase only when the last leg mapped to it ends; matching has four.
    const phaseState = this.phases.get(phase)
    if (phaseState && !this.legHasSiblingRunning(phase)) phaseState.endedAt = at
  }

  /** Booklet line count, learned at the start of matching. */
  setLines(lines: number): void {
    if (lines > 0) this.lines = lines
  }

  finish(): void {
    this.finishedAt = this.now()
    this.activeLeg = null
  }

  private legHasSiblingRunning(phase: BoqEtaPhase): boolean {
    for (const leg of this.legs.values()) {
      if (PHASE_BY_LEG[leg.leg] === phase && leg.endedAt === null) return true
    }
    return false
  }

  private measuredRemainingMs(leg: LegState, at: number): number | null {
    if (leg.opaque || !leg.total || leg.msPerUnit === null) return null
    const legMs = at - leg.startedAt
    const fraction = leg.done / leg.total
    if (leg.ticks < MIN_TICKS || legMs < MIN_LEG_MS || fraction < MIN_FRACTION) return null
    return Math.max(0, (leg.total - leg.done) * leg.msPerUnit)
  }

  /** History prediction for a phase, minus what it has already spent. */
  private historyRemainingMs(
    phase: BoqEtaPhase,
    at: number,
  ): { ms: number; basis: Exclude<BoqEtaBasis, 'in-run'>; samples: number } | null {
    const state = this.phases.get(phase)
    if (!state) return null
    const spent = at - state.startedAt
    if (phase === 'match') {
      if (!this.lines) return null
      const predicted = predictMs(this.calibration.match, this.lines)
      if (!predicted) return null
      return { ms: Math.max(0, predicted.ms - spent), basis: predicted.basis, samples: predicted.samples }
    }
    if (phase === 'server-read') {
      if (!this.pages) return null
      const predicted = predictMs(this.calibration.serverRead, this.pages)
      if (!predicted) return null
      return { ms: Math.max(0, predicted.ms - spent), basis: predicted.basis, samples: predicted.samples }
    }
    if (phase === 'local-read') {
      if (!this.pages) return null
      const predicted = predictMs(this.calibration.localRead, this.pages)
      if (!predicted) return null
      return { ms: Math.max(0, predicted.ms - spent), basis: predicted.basis, samples: predicted.samples }
    }
    return null
  }

  view(nowMs?: number): BoqEtaView {
    const at = nowMs ?? this.now()
    const elapsedMs = (this.finishedAt ?? at) - this.startedAt
    const legState = this.activeLeg ? this.legs.get(this.activeLeg) ?? null : null
    const phase = legState ? PHASE_BY_LEG[legState.leg] : null
    const phaseState = phase ? this.phases.get(phase) ?? null : null

    const base: BoqEtaView = {
      elapsedMs,
      phase,
      leg: legState?.leg ?? null,
      legKind: legState ? (legState.opaque ? 'opaque' : 'measured') : null,
      unit: legState?.unit ?? null,
      done: legState && !legState.opaque ? legState.done : null,
      total: legState && !legState.opaque ? legState.total : null,
      ratePerSec: null,
      legFraction: null,
      remainingMs: null,
      basis: null,
      historySamples: 0,
      legCapMs: legState?.capMs ?? null,
      overdue: false,
      overdueByMs: 0,
      brokenEstimateMs: phaseState?.firstPromisedMs ?? null,
      firstPromisedMs: phaseState?.firstPromisedMs ?? null,
      revisedUp: phaseState?.revisedUp ?? false,
      remainingPhases: phase
        ? PHASE_ORDER.slice(PHASE_ORDER.indexOf(phase) + 1).filter((p) => !this.phases.get(p)?.endedAt)
        : [],
      lines: this.lines,
      pages: this.pages,
      overranEarlier: this.overranEarlier,
    }

    if (!legState || !phaseState || this.finishedAt !== null) return base

    if (!legState.opaque && legState.total) {
      base.legFraction = Math.min(1, legState.done / legState.total)
      if (legState.msPerUnit) base.ratePerSec = 1000 / legState.msPerUnit
    }

    // Already broke a promise in this phase: keep counting elapsed, publish nothing new.
    if (phaseState.overdueAt !== null) {
      base.overdue = true
      base.overdueByMs = at - phaseState.overdueAt
      return base
    }

    const inRun = this.measuredRemainingMs(legState, at)
    const history = this.historyRemainingMs(PHASE_BY_LEG[legState.leg], at)

    // Take the longer of the two rather than the prettier one.
    let remainingMs: number | null = null
    let basis: BoqEtaBasis | null = null
    let samples = 0
    if (inRun !== null && history !== null) {
      if (history.ms > inRun) {
        remainingMs = history.ms
        basis = history.basis
        samples = history.samples
      } else {
        remainingMs = inRun
        basis = 'in-run'
      }
    } else if (inRun !== null) {
      remainingMs = inRun
      basis = 'in-run'
    } else if (history !== null) {
      remainingMs = history.ms
      basis = history.basis
      samples = history.samples
    }

    if (remainingMs === null) return base

    const finishAt = at + remainingMs
    if (phaseState.publishedFinishAt === null) {
      phaseState.publishedFinishAt = finishAt
      phaseState.publishedAt = at
      phaseState.firstPromisedMs = remainingMs
    } else if (finishAt <= phaseState.publishedFinishAt) {
      // Good news is always accepted: the work is going faster than promised.
      phaseState.publishedFinishAt = finishAt
      phaseState.publishedAt = at
    } else {
      // A later finish is only allowed when new work was actually measured since
      // the last promise. Without that, the "slip" is nothing but the clock
      // moving, and accepting it is how a countdown never reaches zero — the
      // exact dishonesty that froze this screen at 69% before.
      const freshEvidence = legState.lastEvidenceAt > (phaseState.publishedAt ?? 0)
      if (freshEvidence) {
        const slipped = finishAt - phaseState.publishedFinishAt
        const previousRemaining = Math.max(0, phaseState.publishedFinishAt - at)
        if (slipped > REVISION_MS && remainingMs > previousRemaining * REVISION_RATIO) {
          phaseState.revisedUp = true
        }
        phaseState.publishedFinishAt = finishAt
        phaseState.publishedAt = at
      }
    }
    phaseState.lastPublishedMs = Math.max(0, phaseState.publishedFinishAt - at)

    const grace = OVERDUE_GRACE_MS + (phaseState.firstPromisedMs ?? 0) * OVERDUE_GRACE_RATIO
    if (at >= phaseState.publishedFinishAt + grace) {
      phaseState.overdueAt = at
      this.overranEarlier = true
      base.overdue = true
      base.overdueByMs = 0
      base.brokenEstimateMs = phaseState.firstPromisedMs
      return base
    }

    base.remainingMs = Math.max(0, phaseState.publishedFinishAt - at)
    base.basis = basis
    base.historySamples = samples
    base.revisedUp = phaseState.revisedUp
    base.firstPromisedMs = phaseState.firstPromisedMs
    base.brokenEstimateMs = null
    return base
  }

  /**
   * Measured durations of this run, for the next run to estimate from. Only
   * phases that actually completed are reported — a failed read teaches nothing
   * about how long a successful one takes.
   */
  samples(): { localRead?: BoqSizedSample; serverRead?: BoqSizedSample; match?: BoqSizedSample } {
    const at = this.now()
    const out: { localRead?: BoqSizedSample; serverRead?: BoqSizedSample; match?: BoqSizedSample } = {}
    const phaseMs = (phase: BoqEtaPhase): number | null => {
      const state = this.phases.get(phase)
      if (!state || state.endedAt === null) return null
      return state.endedAt - state.startedAt
    }
    const localRead = phaseMs('local-read')
    if (localRead !== null && this.pages) out.localRead = { size: this.pages, ms: localRead, at }
    const serverRead = phaseMs('server-read')
    if (serverRead !== null && this.pages) out.serverRead = { size: this.pages, ms: serverRead, at }
    const match = phaseMs('match')
    if (match !== null && this.lines) out.match = { size: this.lines, ms: match, at }
    return out
  }
}

/** Fold this run's measurements into stored calibration for the next read. */
export function recordBoqRun(
  tracker: BoqEtaTracker,
  store: Storage | null = defaultStore(),
): BoqCalibration {
  const calibration = loadBoqCalibration(store)
  const samples = tracker.samples()
  if (samples.localRead) calibration.localRead = [...calibration.localRead, samples.localRead].slice(-MAX_SAMPLES)
  if (samples.serverRead) calibration.serverRead = [...calibration.serverRead, samples.serverRead].slice(-MAX_SAMPLES)
  if (samples.match) calibration.match = [...calibration.match, samples.match].slice(-MAX_SAMPLES)
  saveBoqCalibration(calibration, store)
  return calibration
}

export function hasAnyCalibration(calibration: BoqCalibration): boolean {
  return (
    calibration.localRead.length > 0 ||
    calibration.serverRead.length > 0 ||
    calibration.match.length > 0
  )
}
