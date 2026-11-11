import assert from 'node:assert/strict'
import test from 'node:test'
import { showDistrictSummaryMetric } from './district-summary.ts'

test('consumer audience summaries exclude business supply and market metrics', () => {
  for (const metric of ['businesses', 'residentsPerBusiness', 'unmetSearch', 'restaurants', 'menuPrice', 'growth', 'registeredDeals', 'listingPrices', 'activities', 'unmetTerms'] as const) {
    assert.equal(showDistrictSummaryMetric(metric, 'marketers', 'people'), false, `${metric} must stay out of a resident audience summary`)
  }
})

test('consumer audience summaries retain resident and household measures, and business targeting keeps business metrics', () => {
  for (const metric of ['population', 'sex', 'nationality', 'villaShare', 'income', 'age'] as const) {
    assert.equal(showDistrictSummaryMetric(metric, 'marketers', 'people'), true, `${metric} describes residents or households`)
  }
  assert.equal(showDistrictSummaryMetric('businesses', 'marketers', 'businesses'), true)
  assert.equal(showDistrictSummaryMetric('businesses', 'shops', 'people'), true)
})
