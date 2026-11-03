import math
import random
import unittest

import weekly_plan


def blobs(centres, per, spread=0.004, seed=7):
    rng = random.Random(seed)
    stops = []
    for c, (lon, lat) in enumerate(centres):
        for k in range(per):
            stops.append({'id': f'{c}-{k}', 'lon': lon + rng.uniform(-spread, spread), 'lat': lat + rng.uniform(-spread, spread)})
    return stops


RIYADH = [(46.62, 24.80), (46.72, 24.80), (46.80, 24.72), (46.70, 24.62), (46.60, 24.68)]


def length(start, path, by_id):
    project = weekly_plan._projector([start] + list(by_id.values()))
    total, here = 0.0, project(start)
    for i in path:
        p = project(by_id[i]); total += math.dist(here, p); here = p
    return total


class WeeklyPlanTest(unittest.TestCase):
    def test_every_stop_once_and_days_balanced(self):
        stops = blobs(RIYADH, 13)   # 65 stops, 5 days -> 13 each
        plan = weekly_plan.plan_week(stops, days=5)
        ids = [i for day in plan['days'] for i in day['stops']]
        self.assertEqual(sorted(ids), sorted(s['id'] for s in stops))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(plan['unplanned'], [])
        counts = [day['count'] for day in plan['days']]
        self.assertEqual(len(counts), 5)
        self.assertLessEqual(max(counts) - min(counts), 1)
        self.assertEqual([day['day'] for day in plan['days']], [1, 2, 3, 4, 5])

    def test_uneven_count_differs_by_at_most_one(self):
        stops = blobs(RIYADH, 9)[:43]
        plan = weekly_plan.plan_week(stops, days=6)
        counts = [day['count'] for day in plan['days']]
        self.assertEqual(sum(counts), 43)
        self.assertLessEqual(max(counts) - min(counts), 1)

    def test_clear_clusters_become_days(self):
        stops = blobs(RIYADH, 10, spread=0.002)
        plan = weekly_plan.plan_week(stops, days=5)
        for day in plan['days']:
            self.assertEqual(len({i.split('-')[0] for i in day['stops']}), 1, day['stops'])

    def test_capacity_keeps_nearest_and_reports_the_rest(self):
        stops = blobs(RIYADH, 10)
        start = (46.62, 24.80)
        plan = weekly_plan.plan_week(stops, days=2, max_per_day=8, start=start)
        planned = [i for day in plan['days'] for i in day['stops']]
        self.assertEqual(len(planned), 16)
        self.assertTrue(all(day['count'] <= 8 for day in plan['days']))
        self.assertEqual(sorted(planned + plan['unplanned']), sorted(s['id'] for s in stops))
        project = weekly_plan._projector([(s['lon'], s['lat']) for s in stops] + [start])
        away = lambda s: math.dist(project(start), project((s['lon'], s['lat'])))
        far = max(away(s) for s in stops if s['id'] in planned)
        near_unplanned = min(away(s) for s in stops if s['id'] in plan['unplanned'])
        self.assertLessEqual(far, near_unplanned + 1e-9)

    def test_route_order_is_a_valid_short_path(self):
        stops = blobs([(46.7, 24.7)], 40, spread=0.03)
        by_id = {s['id']: (s['lon'], s['lat']) for s in stops}
        start = (46.7, 24.7)
        plan = weekly_plan.plan_week(stops, days=1, start=start)
        path = plan['days'][0]['stops']
        self.assertEqual(sorted(path), sorted(by_id))
        # 2-opt never leaves a crossing it could undo, so it beats plain id order and is no worse than nearest neighbour
        self.assertLess(length(start, path, by_id), length(start, sorted(by_id), by_id))
        project = weekly_plan._projector([start] + list(by_id.values()))
        xy = {i: project(p) for i, p in by_id.items()}
        greedy, left, here = [], set(xy), project(start)
        while left:
            nxt = min(left, key=lambda i: (math.dist(here, xy[i]), i)); greedy.append(nxt); left.remove(nxt); here = xy[nxt]
        self.assertLessEqual(length(start, path, by_id), length(start, greedy, by_id) + 1e-6)
        expected = length(start, path, by_id) * weekly_plan.DETOUR
        self.assertAlmostEqual(plan['days'][0]['meters_estimate'], expected, delta=1)

    def test_deterministic(self):
        stops = blobs(RIYADH, 11, seed=3)
        first = weekly_plan.plan_week(stops, days=4, max_per_day=12)
        second = weekly_plan.plan_week(list(reversed(stops)), days=4, max_per_day=12)
        self.assertEqual(first, second)

    def test_fewer_stops_than_days(self):
        plan = weekly_plan.plan_week(blobs([(46.7, 24.7)], 3), days=5)
        self.assertEqual([day['count'] for day in plan['days']], [1, 1, 1])

    def test_read_validates(self):
        good = {'stops': [{'id': 'a', 'lon': 46.7, 'lat': 24.7}], 'days': 5, 'max_per_day': 20, 'start': {'lon': 46.7, 'lat': 24.7}}
        stops, days, per_day, start = weekly_plan.read(good)
        self.assertEqual((days, per_day, start), (5, 20, (46.7, 24.7)))
        for bad in ({'stops': []}, {'stops': [{'id': 'a', 'lon': 0, 'lat': 0}]}, {**good, 'days': True}, {**good, 'start': {'lon': 'x'}}):
            with self.assertRaises(ValueError):
                weekly_plan.read(bad)
        with self.assertRaises(ValueError):
            weekly_plan.plan_week(stops, days=7)
        with self.assertRaises(ValueError):
            weekly_plan.plan_week(stops, days=5, max_per_day=0)


if __name__ == '__main__':
    unittest.main()
