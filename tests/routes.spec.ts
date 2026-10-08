import { expect, test } from '@playwright/test'
import { parseRoute, routePath } from '../src/procurementContext'

test('URL ⇄ screen mapping (shareable links)', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  expect(parseRoute('/')).toEqual({ view: 'rfq-list', rfqId: null })
  expect(parseRoute('/requests')).toEqual({ view: 'rfq-list', rfqId: null })
  expect(parseRoute('/new')).toEqual({ view: 'create-upload', rfqId: null })
  expect(parseRoute(`/requests/${id}`)).toEqual({ view: 'rfq-detail', rfqId: id })
  expect(parseRoute(`/requests/${id}/compare/`)).toEqual({ view: 'comparison', rfqId: id })
  expect(parseRoute('/', `?rfq=${id}`)).toEqual({ view: 'rfq-detail', rfqId: id })
  for (const [v, r] of [['rfq-list', null], ['create-upload', null], ['rfq-detail', id], ['comparison', id]] as const) {
    expect(parseRoute(routePath(v, r))).toEqual({ view: v, rfqId: r })
  }
})
