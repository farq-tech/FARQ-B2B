import assert from 'node:assert/strict'
import test from 'node:test'
import { requestWithDeadline } from './optional-source.ts'

test('a city request aborts at its deadline', async () => {
  const parent = new AbortController()
  let requestSignal: AbortSignal | undefined
  const request = requestWithDeadline((signal) => {
    requestSignal = signal
    return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }, parent.signal, 10)

  await assert.rejects(request, { name: 'TimeoutError' })
  assert.equal(requestSignal?.aborted, true)
})

test('changing cities cancels an outstanding request immediately', async () => {
  const parent = new AbortController()
  let requestStarted = false
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const request = requestWithDeadline((signal) => {
    requestStarted = true
    markStarted()
    return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }, parent.signal, 10_000)

  await started
  parent.abort(new DOMException('City changed', 'AbortError'))
  await assert.rejects(request, { name: 'AbortError' })
  assert.equal(requestStarted, true, 'the test cancels a request after it has started')
})
