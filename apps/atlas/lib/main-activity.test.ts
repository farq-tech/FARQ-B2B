import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMainActivitySelection } from './insights-api.ts'

test('keeps a selected activity visible when the destination city has no records in it', () => {
  const result = resolveMainActivitySelection([{ main_id: 'food', main_ar: 'أغذية ومشروبات' }], 'health', 'الصحة')
  assert.deepEqual(result, { activity: { main_id: 'health', main_ar: 'الصحة' }, missing: true })
})

test('uses the city activity label when the selected activity is available there', () => {
  const result = resolveMainActivitySelection([{ main_id: 'food', main_ar: 'أغذية ومشروبات' }], 'food', 'اسم قديم')
  assert.deepEqual(result, { activity: { main_id: 'food', main_ar: 'أغذية ومشروبات' }, missing: false })
})

test('does not invent a label when the activity catalog is unavailable', () => {
  assert.deepEqual(resolveMainActivitySelection([], 'health'), { activity: null, missing: false })
})
