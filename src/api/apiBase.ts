/**
 * Where this browser reaches the Farq Express API.
 *
 * One definition, imported by every client module. It used to be copied into
 * `constructionClient.ts` and `constructionSuppliers.ts`, which is how the two
 * files drifted into sending different auth headers for the same API.
 */

/** `/_api` in dev (Vite proxy → Farq Express); an absolute origin in production. */
export function apiBase(): string {
  // `import.meta.env` is absent under plain Node (vitest `environment: 'node'`),
  // so read it defensively rather than letting a test crash on the module load.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  const raw = String(env?.VITE_API_BASE_URL || '/_api').trim()
  return raw.replace(/\/$/, '') || '/_api'
}

/** True in any `vite build` output; false under `vite dev` and in tests. */
export function isProductionBuild(): boolean {
  const env = (import.meta as { env?: Record<string, unknown> }).env
  return env?.PROD === true
}

/**
 * What to tell someone when the API could not be reached.
 *
 * The local answer and the deployed answer are different facts. `VITE_API_PROXY_TARGET`
 * is a dev-server setting that does not exist in a built site, so printing that
 * advice on a real domain sends the reader to look for something that isn't there.
 * On a deployed build the honest first suspect is the session: without one the
 * app sends `x-construction-demo-user`, which the API's CORS does not allow, so
 * the request never leaves the browser.
 */
export function apiUnreachableAdvice(): string {
  return isProductionBuild()
    ? 'إن لم تكن مسجّل الدخول فسجّل الدخول ثم أعد المحاولة؛ وإن كنت مسجّلًا فالـ API لا يستجيب حاليًا.'
    : 'شغّل Farq API محليًا واضبط VITE_API_PROXY_TARGET عليه، ثم أعد المحاولة.'
}

/**
 * A build-time bearer token for the whole deployment.
 *
 * This is NOT a session: one token is baked into the bundle and every visitor
 * shares it, which is the opposite of "a separate session per account". It
 * stays for local diagnosis against a remote API and is refused in production
 * builds so it can never become the shipped auth path.
 */
export function buildTimeAccessToken(): string {
  const env = (import.meta as { env?: Record<string, unknown> }).env
  if (env?.PROD === true) return ''
  return String(env?.VITE_FARQ_ACCESS_TOKEN || '').trim()
}
