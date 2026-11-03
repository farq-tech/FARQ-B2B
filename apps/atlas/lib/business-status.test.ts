import assert from 'node:assert/strict'
import test from 'node:test'
import { openNow, statusLabel, todayHours } from './business-status.ts'

// Asia/Riyadh is a fixed UTC+3 offset, so an instant written with +03:00 is that exact Riyadh wall-clock time.
// 2026-11-02 is a Monday; these instants pin a known weekday + local time for the pure open_now port.
const mon = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00+03:00`)

test('open during a normal interval reports the closing time', () => {
  const week = JSON.stringify({ mon: [['09:00', '17:00']] })
  assert.deepEqual(openNow(week, mon('10:00')), { open: true, until: '17:00', opensAt: null })
})

test('closed before opening reports today\'s next opening', () => {
  const week = JSON.stringify({ mon: [['09:00', '17:00']] })
  assert.deepEqual(openNow(week, mon('08:00')), { open: false, until: null, opensAt: '09:00' })
})

test('midnight-crossing interval that starts today stays open past midnight', () => {
  const week = JSON.stringify({ mon: [['20:00', '02:00']] })
  assert.deepEqual(openNow(week, mon('23:00')), { open: true, until: '02:00', opensAt: null })
})

test('spillover from yesterday\'s overnight interval into the early hours', () => {
  const week = JSON.stringify({ sun: [['20:00', '02:00']], mon: [] })
  assert.deepEqual(openNow(week, mon('01:00')), { open: true, until: '02:00', opensAt: null })
})

test('split shifts: open in the morning shift, closed in the midday break', () => {
  const week = JSON.stringify({ mon: [['09:00', '13:00'], ['16:00', '22:00']] })
  assert.deepEqual(openNow(week, mon('10:00')), { open: true, until: '13:00', opensAt: null })
  assert.deepEqual(openNow(week, mon('14:00')), { open: false, until: null, opensAt: '16:00' })
})

test('open 24 hours reports a 24:00 close', () => {
  const week = JSON.stringify({ mon: [['00:00', '24:00']] })
  assert.deepEqual(openNow(week, mon('03:00')), { open: true, until: '24:00', opensAt: null })
})

test('closed all day today scans forward to the next day that opens', () => {
  const week = JSON.stringify({ mon: [], tue: [['09:00', '17:00']] })
  assert.deepEqual(openNow(week, mon('10:00')), { open: false, until: null, opensAt: '09:00' })
})

test('an object schedule is accepted as well as a JSON string', () => {
  assert.deepEqual(openNow({ mon: [['09:00', '17:00']] }, mon('10:00')), { open: true, until: '17:00', opensAt: null })
})

test('no usable schedule returns null so the UI can show «غير متاح»', () => {
  assert.equal(openNow('', mon('10:00')), null)
  assert.equal(openNow('{}', mon('10:00')), null)
  assert.equal(openNow('not json', mon('10:00')), null)
  assert.equal(openNow(null, mon('10:00')), null)
  assert.equal(openNow(undefined, mon('10:00')), null)
})

test('status vocabulary maps to Arabic; unknown stays null', () => {
  assert.equal(statusLabel('open'), 'مفتوح')
  assert.equal(statusLabel('closed_temporary'), 'مغلق مؤقتاً')
  assert.equal(statusLabel('closed_permanent'), 'مغلق نهائياً')
  assert.equal(statusLabel('inactive'), 'غير نشط')
  assert.equal(statusLabel('unknown_empty'), null)
  assert.equal(statusLabel('unknown_invalid'), null)
  assert.equal(statusLabel(undefined), null)
  assert.equal(statusLabel('garbage'), null)
})

test('today\'s hours expose the local day label and its intervals', () => {
  const week = JSON.stringify({ mon: [['09:00', '13:00'], ['16:00', '22:00']], tue: [] })
  assert.deepEqual(todayHours(week, mon('10:00')), { day: 'الاثنين', intervals: [['09:00', '13:00'], ['16:00', '22:00']] })
  assert.deepEqual(todayHours(JSON.stringify({ mon: [] }), mon('10:00')), { day: 'الاثنين', intervals: [] })
  assert.equal(todayHours('', mon('10:00')), null)
})
