import assert from 'node:assert/strict'
import test from 'node:test'
import { counted } from '../../../lib/insights-api.ts'
import { gapsHoverLine, gapsSummary } from './gaps-summary.ts'

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

test("the pointer card says each district's part of the answer, in words", () => {
  const format = { format: (value: number) => new Intl.NumberFormat('en-US').format(value) }
  assert.equal(gapsHoverLine({ district_ar: 'ظهرة لبن', shortfall: 101.6, businesses: 227 }, 237800, 5000, counted, format), 'بنقص 102 منشأة')
  assert.equal(gapsHoverLine({ district_ar: 'الملقا', shortfall: -30, businesses: 90 }, 90000, 5000, counted, format), 'مكتفٍ: فيه 90 منشأة')
  assert.equal(gapsHoverLine({ district_ar: 'الملقا', shortfall: 0.3, businesses: 1 }, 9000, 5000, counted, format), 'مكتفٍ: فيه منشأة واحدة')
  // a district the answer leaves out says why, instead of a blank
  assert.equal(gapsHoverLine(undefined, null, 5000, counted, format), 'لا يُحسب: السكان غير متاح')
  assert.equal(gapsHoverLine(undefined, 3200, 5000, counted, format), 'لا يُحسب: أقل من 5,000 ساكن')
  assert.doesNotMatch(gapsHoverLine({ district_ar: 'x', shortfall: 12, businesses: 3 }, 1, 5000, counted, format), /[+٠-٩]/)
})

test('a shortfall under half a business is not a gap, so the line counts what the list shows', () => {
  const close = [{ district_ar: 'العليا', shortfall: 4.2 }, { district_ar: 'الملقا', shortfall: 0.4 }, { district_ar: 'النرجس', shortfall: 0.2 }]
  assert.equal(gapsSummary({ residents_per_business: 900, districts: close }, counted), 'الأعلى: العليا بنقص 4 منشآت · حي واحد فيه نقص')
  assert.equal(gapsSummary({ residents_per_business: 900, districts: close.slice(1) }, counted), 'لا نقص في أي حي')
})
