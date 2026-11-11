import assert from 'node:assert/strict'
import test from 'node:test'
import { allowed, clientAddress } from './access-request-server.ts'

const request = (forwarded?: string) => ({ headers: new Headers(forwarded ? { 'x-forwarded-for': forwarded } : {}) }) as never

test('the address is the one the proxy added, not one the visitor wrote', () => {
  assert.equal(clientAddress(request('1.2.3.4, 10.0.0.9')), '10.0.0.9')
  assert.equal(clientAddress(request('10.0.0.9')), '10.0.0.9')
  assert.equal(clientAddress(request()), 'unknown')
})

test('five an hour per address and per form, then refused until the hour passes', () => {
  const now = 1_000_000
  for (let i = 0; i < 5; i++) assert.equal(allowed('9.9.9.9', 'request', now + i), true)
  assert.equal(allowed('9.9.9.9', 'request', now + 10), false)
  assert.equal(allowed('9.9.9.9', 'deletion', now + 10), true, 'the deletion form has its own count')
  assert.equal(allowed('9.9.9.9', 'request', now + 60 * 60 * 1000 + 1), true)
})
