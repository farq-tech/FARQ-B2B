/**
 * Read-only mode for the testing deployment.
 *
 * This build reads the real API with a real session, but must never dispatch
 * to a real supplier: the invite `send` route hands the message straight to
 * Resend, the inbox `reply` and outbox `retry` routes do the same, and the
 * supplier rows behind them are real contacts that have already received 188
 * real messages from this system. Nothing in the UI asked for a confirmation
 * before any of that.
 *
 * The refusal lives at the single network choke point rather than on the
 * buttons, so a stale component, a keyboard path, or a console call cannot
 * reach the network either.
 */

/**
 * Whether this bundle was built with writes disabled.
 *
 * `import.meta.env` is the browser answer and the only one that matters in a
 * shipped build. It is absent under plain Node (vitest runs `environment:
 * 'node'`), so fall back to `process.env` — that is what makes the guard
 * assertable in the test suite instead of only in a browser.
 */
export function isReadOnlyBuild(): boolean {
  const viteEnv = (import.meta as { env?: Record<string, unknown> }).env
  const raw = viteEnv?.VITE_READ_ONLY
    ?? (typeof process !== 'undefined' ? process.env?.VITE_READ_ONLY : undefined)
  return String(raw ?? '').trim() === '1'
}

/**
 * POSTs that only search.
 *
 * Matching and server-side PDF parsing read the catalogue and return
 * suggestions; they write nothing. They are POSTs only because their query is
 * too big for a URL. Keeping them open is what lets the journey — upload,
 * read the items, suggest suppliers — run against real data instead of
 * fixtures. Matched on the path, so a query string cannot smuggle anything in.
 */
const READ_ONLY_POST_PATHS = [
  '/api/construction/suppliers/match',
  '/api/construction/boq/match',
  '/api/construction/boq/parse-pdf',
]

/** Error code the UI shows when a write is refused before it leaves the browser. */
export const CONSTRUCTION_READ_ONLY = 'CONSTRUCTION_READ_ONLY'

/** Arabic, because every other refusal this app renders is in Arabic. */
export const READ_ONLY_MESSAGE =
  'هذه نسخة للتجربة فقط: الإرسال الحقيقي للموردين معطّل. لن يصل أي بريد أو طلب إلى مورد من هذا الرابط.'

/**
 * True when this call would change something on the server.
 *
 * Anything that is not a plain read, and not one of the search POSTs above,
 * counts as a write — including routes added after this was written, which is
 * the point of denying by default.
 */
export function isBlockedWrite(path: string, method: string | undefined): boolean {
  if (!isReadOnlyBuild()) return false
  const verb = String(method || 'GET').toUpperCase()
  if (verb === 'GET' || verb === 'HEAD') return false
  if (verb === 'POST' && READ_ONLY_POST_PATHS.some((p) => path.split('?')[0] === p)) {
    return false
  }
  return true
}
