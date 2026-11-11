export type CityDataSource = 'population' | 'businesses' | 'income' | 'growth' | 'housing' | 'realEstate' | 'deals' | 'restaurants' | 'menuPrices' | 'demand'

/** Bound a city request and let a city change cancel it immediately. */
export function requestWithDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parentSignal.reason)
  if (parentSignal.aborted) abortFromParent()
  else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  const timeout = setTimeout(() => controller.abort(new DOMException('City data request timed out', 'TimeoutError')), timeoutMs)
  return Promise.resolve().then(() => {
    if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('City data request was cancelled', 'AbortError')
    return request(controller.signal)
  }).finally(() => {
    clearTimeout(timeout)
    parentSignal.removeEventListener('abort', abortFromParent)
  })
}
