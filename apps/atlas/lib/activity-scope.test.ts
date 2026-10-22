import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLiveActivityScope } from './activity-scope.ts'

const catalog = [
  { main_id: 'build', main_ar: 'مواد بناء وتشطيب (بيع)', streets: 1, shops: 1, subs: [] },
  { main_id: 'contract', main_ar: 'مقاولات وخدمات إنشائية', streets: 2, shops: 2, subs: [] },
]

test('contractor phrase prefers contracting over broad building-material category', () => {
  assert.equal(resolveLiveActivityScope(['مواد بناء'], [], catalog, 'شركات مقاولات')?.main_id, 'contract')
})

test('assistant restaurant category maps to the live food activity', () => {
  const food = { main_id: 'food', main_ar: 'أغذية ومشروبات', streets: 2, shops: 2, subs: [] }
  assert.equal(resolveLiveActivityScope(['معدات مطاعم'], [], [...catalog, food], 'مطاعم ومقاهي')?.main_id, 'food')
})
