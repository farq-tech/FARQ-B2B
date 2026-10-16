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
  expect(parseRoute(`/requests/${id}/award`)).toEqual({ view: 'award', rfqId: id })
  expect(parseRoute(`/requests/${id}/review`)).toEqual({ view: 'rfq-detail', rfqId: id }) // 02 is a step of /new
  expect(parseRoute('/inbox')).toEqual({ view: 'inbox', rfqId: null })
  expect(parseRoute('/opportunity-map')).toEqual({ view: 'targeting', rfqId: null })
  expect(parseRoute('/opportunity-map/new')).toEqual({ view: 'targeting-new', rfqId: null })
  expect(routePath('targeting', null)).toBe('/opportunity-map')
  // old links keep working
  expect(parseRoute('/targeting')).toEqual({ view: 'targeting', rfqId: null })
  expect(parseRoute('/targeting/templates')).toEqual({ view: 'templates', rfqId: null })
  expect(parseRoute('/targeting/templates/new')).toEqual({ view: 'template-new', rfqId: null })
  expect(parseRoute('/login')).toEqual({ view: 'login', rfqId: null })
  for (const [v, r] of [['rfq-list', null], ['create-upload', null], ['rfq-detail', id], ['comparison', id], ['award', id], ['inbox', null], ['login', null], ['targeting', null], ['targeting-new', null], ['templates', null], ['template-new', null]] as const) {
    expect(parseRoute(routePath(v, r))).toEqual({ view: v, rfqId: r })
  }
})
