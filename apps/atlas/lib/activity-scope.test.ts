import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLiveActivityScope } from './activity-scope.ts'

const catalog = [
  { main_id: 'build', main_ar: 'مواد بناء وتشطيب (بيع)', streets: 1, shops: 1, subs: [] },
  { main_id: 'contract', main_ar: 'مقاولات وخدمات إنشائية', streets: 2, shops: 2, subs: [
    { sub_id: 'contract.general', sub_ar: 'مقاولات عامة', streets: 2, shops: 2 },
  ] },
]

test('contractor phrase prefers contracting over broad building-material category', () => {
  const scope = resolveLiveActivityScope(['مواد بناء'], [], catalog, 'شركات مقاولات')
  assert.equal(scope?.main_id, 'contract')
  assert.equal(scope?.subs[0]?.sub_id, 'contract.general')
})

test('assistant restaurant category maps to the live food activity', () => {
  const food = { main_id: 'food', main_ar: 'أغذية ومشروبات', streets: 2, shops: 2, subs: [] }
  assert.equal(resolveLiveActivityScope(['معدات مطاعم'], [], [...catalog, food], 'مطاعم ومقاهي')?.main_id, 'food')
})
