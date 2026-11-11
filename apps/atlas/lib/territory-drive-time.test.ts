import assert from 'node:assert/strict'
import test from 'node:test'
import { balanceTerritoriesByDriveTime, parseDiagonalDriveTimes, parseTerritoryCentres } from './territory-drive-time.ts'

const centres = [0, 1, 2, 3].map((id) => ({ district_ar: `حي${id}`, district_id: id, lon: 46.7 + id / 100, lat: 24.7 }))

test('territory-centre payload validates full coverage and Saudi coordinates', () => {
  assert.deepEqual(parseTerritoryCentres({ centres, total_districts: 5, unweighted_districts: 1 }), {
    centres, totalDistricts: 5, unweightedDistricts: 1,
  })
  assert.throws(() => parseTerritoryCentres({ centres: [...centres, centres[0]], total_districts: 5, unweighted_districts: 1 }))
  assert.throws(() => parseTerritoryCentres({ centres: [{ ...centres[0], lat: 90 }], total_districts: 1, unweighted_districts: 0 }))
  assert.throws(() => parseTerritoryCentres({ centres, total_districts: 6, unweighted_districts: 1 }))
})

test('road-time matrix reads only consecutive-leg diagonal and rejects unreachable legs', () => {
  assert.deepEqual(parseDiagonalDriveTimes({ sources_to_targets: [[{ time: 10 }, { time: 90 }], [{ time: 80 }, { time: 20 }]] }, 2), [10, 20])
  assert.deepEqual(parseDiagonalDriveTimes({ durations: [[10, 90], [80, 20]] }, 2), [10, 20])
  assert.throws(() => parseDiagonalDriveTimes({ sources_to_targets: [[{ time: 10 }, { time: 90 }], [{ time: 80 }, { time: null }]] }, 2))
  assert.throws(() => parseDiagonalDriveTimes({ durations: [[10]] }, 2))
})

test('drive-time balancing creates contiguous groups with a minimized maximum measured time', () => {
  const groups = balanceTerritoriesByDriveTime(centres, [8, 9, 10], 2)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map((group) => group.districts.map((district) => district.district_id)), [[0, 1], [2, 3]])
  assert.deepEqual(groups.map((group) => group.weight), [8, 10])
  assert.deepEqual(groups.flatMap((group) => group.districts), centres)
})

test('drive-time balancing rejects invalid or wholly zero road measurements', () => {
  assert.deepEqual(balanceTerritoriesByDriveTime(centres, [0, 0, 0], 3), [])
  assert.throws(() => balanceTerritoriesByDriveTime(centres, [8, -1, 10], 2))
  assert.throws(() => balanceTerritoriesByDriveTime(centres, [8], 2))
})
