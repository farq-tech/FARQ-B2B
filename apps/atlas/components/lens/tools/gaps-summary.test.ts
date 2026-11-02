import assert from 'node:assert/strict'
import test from 'node:test'
import { counted } from '../../../lib/insights-api.ts'
import { gapsSummary } from './gaps-summary.ts'

const rows = [
  { district_ar: 'المدينة الصناعية الجديدة', shortfall: 122.4 },
  { district_ar: 'ظهرة لبن', shortfall: 102 },
  { district_ar: 'الملقا', shortfall: -30 },
]

test('the peek line names the count and the top district, with the shortfall in words', () => {
  assert.equal(gapsSummary({ residents_per_business: 723, districts: rows }, counted),
    'الأعلى: المدينة الصناعية الجديدة بنقص 122 منشأة · حيّان فيها نقص')
})

test('no signed figure and no bidi controls, so nothing can land on the wrong side', () => {
  const line = gapsSummary({ residents_per_business: 723, districts: rows }, counted) ?? ''
  assert.doesNotMatch(line, /[+⁦-⁩‎‏]/)
  assert.doesNotMatch(line, /[٠-٩]/)
})

test('no shortfall, and no rate, are said plainly', () => {
  assert.equal(gapsSummary({ residents_per_business: 723, districts: [rows[2]] }, counted), 'لا نقص في أي حي')
  assert.equal(gapsSummary({ residents_per_business: null, districts: rows }, counted), null)
  assert.equal(gapsSummary(null, counted), null)
})
