import assert from 'node:assert/strict'
import test from 'node:test'
import { counted } from './insights-api.ts'

test('a count takes the noun form Arabic agreement asks for', () => {
  assert.equal(counted(1, 'district'), 'حي واحد')
  assert.equal(counted(2, 'branch'), 'فرعان')
  assert.equal(counted(3, 'branch'), '3 فروع')
  assert.equal(counted(10, 'district'), '10 أحياء')
  assert.equal(counted(11, 'district'), '11 حياً')
  assert.equal(counted(99, 'branch'), '99 فرعاً')
  assert.equal(counted(100, 'district'), '100 حي')
  assert.equal(counted(102, 'business'), '102 منشأة')
  assert.equal(counted(105, 'business'), '105 منشأة')
  assert.equal(counted(407, 'branch'), '407 فرع')
  assert.equal(counted(523, 'branch'), '523 فرعاً')
  assert.equal(counted(1_000, 'business'), '1,000 منشأة')
  assert.equal(counted(0, 'district'), '0 حي')
})
