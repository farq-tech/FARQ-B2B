import assert from 'node:assert/strict'
import test from 'node:test'
import { audienceDataStatus, audienceShadeIndex, audienceSummaryHeading, completeAudienceTotal, districtBusinessCount, incomeCoverageStatus, isAudienceResponse, meetsIncomeThreshold } from './audience.ts'

test('audience summary names the displayed metric after switching targeting modes', () => {
  assert.equal(audienceSummaryHeading('people', true, 8000, 'المدينة'), 'سكان الشريحة في الأحياء المطابقة ضمن المدينة')
  assert.equal(audienceSummaryHeading('people', false, 8000, 'المدينة'), 'سكان الأحياء المطابقة ضمن المدينة')
  assert.equal(audienceSummaryHeading('businesses', true, 8000, 'المدينة'), 'عدد المنشآت في المدينة',
    'remembered person filters must never relabel a business count as residents')
  assert.equal(audienceSummaryHeading('businesses', false, 0, 'الأحياء المحددة'), 'عدد المنشآت في الأحياء المحددة')
})

test('a selected audience segment waits while its share source is loading', () => {
  assert.equal(audienceDataStatus('people', true, 'loading'), 'loading')
})

test('a selected audience segment surfaces unavailable and failed shares as final states', () => {
  assert.equal(audienceDataStatus('people', true, 'unavailable'), 'unavailable')
  assert.equal(audienceDataStatus('people', true, 'error'), 'error')
})

test('audience-share data is not required for all residents or business targeting', () => {
  assert.equal(audienceDataStatus('people', false, 'loading'), 'ready')
  assert.equal(audienceDataStatus('businesses', true, 'error'), 'ready')
})

test('scoped audience totals are unavailable when any selected district lacks a valid figure', () => {
  assert.equal(completeAudienceTotal([10, 20, 30]), 60)
  assert.equal(completeAudienceTotal([10, null, 30]), null)
  assert.equal(completeAudienceTotal([10, Infinity]), null)
  assert.equal(completeAudienceTotal([10, -1]), null)
  assert.equal(completeAudienceTotal([]), null)
})

test('measured zero audience gets the lowest data shade and invalid values remain unshaded', () => {
  assert.deepEqual([0, 19, 20, 39, 40, 59, 60, 79, 80, 99, 100].map(audienceShadeIndex), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4])
  assert.equal(audienceShadeIndex(NaN), null)
  assert.equal(audienceShadeIndex(-1), null)
  assert.equal(audienceShadeIndex(101), null)
})

test('income threshold distinguishes eligible, excluded, and unmeasured districts', () => {
  assert.equal(meetsIncomeThreshold(null, 0), true, 'income is irrelevant when no minimum is selected')
  assert.equal(meetsIncomeThreshold(0, 8000), false)
  assert.equal(meetsIncomeThreshold(7999, 8000), false)
  assert.equal(meetsIncomeThreshold(8000, 8000), true)
  assert.equal(meetsIncomeThreshold(null, 8000), null)
  assert.equal(meetsIncomeThreshold(-1, 8000), null)
})

test('income coverage distinguishes loading, unavailable, partial, and complete measurements', () => {
  assert.equal(incomeCoverageStatus('loading', 0, 12), 'loading')
  assert.equal(incomeCoverageStatus('error', 12, 12), 'error')
  assert.equal(incomeCoverageStatus('ready', 0, 12), 'unavailable')
  assert.equal(incomeCoverageStatus('ready', 8, 12), 'partial')
  assert.equal(incomeCoverageStatus('ready', 12, 12), 'complete')
  assert.equal(incomeCoverageStatus('ready', 13, 12), 'unavailable', 'invalid coverage must not be presented as complete')
})

test('an omitted district count is zero only when the city aggregate confirms zero', () => {
  assert.equal(districtBusinessCount(0, undefined), 0)
  assert.equal(districtBusinessCount(0, null), 0)
  assert.equal(districtBusinessCount(0, 3), 3)
  assert.equal(districtBusinessCount(12, undefined), null)
  assert.equal(districtBusinessCount(null, undefined), null)
  for (const invalid of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(districtBusinessCount(0, invalid), null, 'an invalid explicit count must not fall back to the city zero')
  }
})

test('measured audience response validates city, unique districts, shares, and server-computed sizes', () => {
  const valid = { city: 'Riyadh', available: true, districts: [{ district_ar: 'الربيع', male_pct: 52, saudi_pct: null, men: 520, women: 480, saudi: null, non_saudi: null }] }
  assert.equal(isAudienceResponse(valid, 'Riyadh'), true)
  assert.equal(isAudienceResponse(valid, 'Jeddah'), false, 'a response for another city cannot color the current map')
  assert.equal(isAudienceResponse({ ...valid, districts: [...valid.districts, valid.districts[0]] }, 'Riyadh'), false)
  assert.equal(isAudienceResponse({ ...valid, districts: [{ ...valid.districts[0], male_pct: 101 }] }, 'Riyadh'), false)
  assert.equal(isAudienceResponse({ ...valid, districts: [{ ...valid.districts[0], men: -1 }] }, 'Riyadh'), false)
  assert.equal(isAudienceResponse({ ...valid, districts: [{ ...valid.districts[0], male_pct: null }] }, 'Riyadh'), false,
    'segment sizes cannot be available when their measured share is missing')
  assert.equal(isAudienceResponse({ ...valid, districts: [{ ...valid.districts[0], women: null }] }, 'Riyadh'), false,
    'both sex sizes are derived from the same population and share')
  assert.equal(isAudienceResponse({ ...valid, districts: [{ ...valid.districts[0], men: 300, women: 700 }] }, 'Riyadh'), false,
    'sizes that contradict the measured male share cannot color or rank districts')
  assert.equal(isAudienceResponse({ ...valid, districts: [{ ...valid.districts[0], men: 0, women: 0 }] }, 'Riyadh'), true,
    'a zero-population district can have two valid zero segment sizes')
  assert.equal(isAudienceResponse({ ...valid, districts: [{ ...valid.districts[0], men: null, women: null }] }, 'Riyadh'), true,
    'both sizes may be unavailable when population is unavailable despite a measured share')
  assert.equal(isAudienceResponse({ city: 'Riyadh', available: true, districts: [] }, 'Riyadh'), true)
  assert.equal(isAudienceResponse({ city: 'Riyadh', available: false }, 'Riyadh'), true)
})

test('audience identity uses canonical district IDs and rejects ambiguous ID responses', () => {
  const district = { district_ar: 'الندى', male_pct: 52, saudi_pct: 60, men: 52, women: 48, saudi: 60, non_saudi: 40 }
  const identified = { city: 'Riyadh', available: true, districts: [
    { ...district, district_id: 'district-a' },
    { ...district, district_id: 'district-b' },
    { ...district, district_ar: 'حي غير محسوم', district_id: null, men: null, women: null, saudi: null, non_saudi: null },
  ] }
  assert.equal(isAudienceResponse(identified, 'Riyadh'), true,
    'duplicate display names are safe when canonical identities differ')
  assert.equal(isAudienceResponse({ ...identified, districts: [identified.districts[0], { ...identified.districts[1], district_id: 'district-a' }] }, 'Riyadh'), false,
    'a repeated canonical identity must not silently replace another measured row')
  assert.equal(isAudienceResponse({ ...identified, districts: [identified.districts[0], district] }, 'Riyadh'), false,
    'a response cannot mix ID-based and legacy name-based joins')
})
