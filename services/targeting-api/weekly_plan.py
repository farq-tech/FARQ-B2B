"""A rep's working week: the target businesses of one territory split into day clusters, each a short drive.

Deterministic, no randomness and no outside calls:
1. If the week cannot hold every stop (days × max_per_day, at most 100 a day), the stops nearest the start point (or the stops'
   centre when there is none) are kept and the rest are returned as `unplanned`.
2. Day sizes are fixed up front so the days differ by at most one stop.
3. Seeds come from a sweep: stops sorted by angle around their centre, starting after the widest empty gap, cut into
   runs of the day sizes. A few rounds of capacity-bound k-means then pull each day into a compact cluster: every
   (stop, day) pair is taken in order of distance and a stop joins the nearest day that still has room.
4. Each day is ordered from the start point by nearest neighbour, then improved by 2-opt on the open path.

Distances are straight lines on the ground; the drive estimate multiplies them by a detour factor and divides by an
average city speed, so it is labelled an estimate wherever it is shown.
"""
import math

EARTH_M = 6371008.8
DETOUR = 1.3            # road distance ÷ straight line, typical for a city grid
SPEED_KMH = 30.0        # average city driving speed including stops at lights
KMEANS_ROUNDS = 12
MAX_STOPS = 5000
MAX_DAYS = 6
MAX_PER_DAY = 100


def _projector(points):
    """Local flat metres around the points' centre: good to well under 1% across a city."""
    lon0 = sum(p[0] for p in points) / len(points)
    lat0 = sum(p[1] for p in points) / len(points)
    kx = math.cos(math.radians(lat0)) * math.pi * EARTH_M / 180
    ky = math.pi * EARTH_M / 180
    return lambda p: ((p[0] - lon0) * kx, (p[1] - lat0) * ky)


def _sizes(n, days):
    base, extra = divmod(n, days)
    return [base + 1 if i < extra else base for i in range(days)]


def _sweep(xy, order_ids, sizes):
    """Stops by angle around their centre, starting just after the widest angular gap, cut into runs."""
    cx = sum(x for x, _ in xy.values()) / len(xy)
    cy = sum(y for _, y in xy.values()) / len(xy)
    angle = {i: math.atan2(xy[i][1] - cy, xy[i][0] - cx) for i in order_ids}
    ring = sorted(order_ids, key=lambda i: (angle[i], math.hypot(xy[i][0] - cx, xy[i][1] - cy), i))
    if len(ring) > 1:
        gaps = [(angle[ring[(k + 1) % len(ring)]] - angle[ring[k]]) % (2 * math.pi) for k in range(len(ring))]
        widest = max(range(len(ring)), key=lambda k: (gaps[k], -k))
        ring = ring[widest + 1:] + ring[:widest + 1]
    runs, at = [], 0
    for size in sizes:
        runs.append(ring[at:at + size])
        at += size
    return runs


def _centre(members, xy):
    return (sum(xy[i][0] for i in members) / len(members), sum(xy[i][1] for i in members) / len(members))


def _balanced_kmeans(xy, runs, sizes):
    groups = [list(run) for run in runs]
    for _ in range(KMEANS_ROUNDS):
        centres = [_centre(g, xy) if g else (0.0, 0.0) for g in groups]
        pairs = sorted(((xy[i][0] - c[0]) ** 2 + (xy[i][1] - c[1]) ** 2, i, d)
                       for i in xy for d, c in enumerate(centres) if sizes[d])
        room, placed, fresh = list(sizes), set(), [[] for _ in sizes]
        for _, i, d in pairs:
            if i in placed or not room[d]: continue
            fresh[d].append(i); placed.add(i); room[d] -= 1
        fresh = [sorted(g) for g in fresh]
        if fresh == [sorted(g) for g in groups]: break
        groups = fresh
    return groups


def _path_length(start, path, xy):
    total, here = 0.0, start
    for i in path:
        total += math.hypot(xy[i][0] - here[0], xy[i][1] - here[1]); here = xy[i]
    return total


def order_day(start, members, xy):
    """Nearest neighbour from `start`, then 2-opt on the open path (the start is fixed, the end is free)."""
    left, path, here = set(members), [], start
    while left:
        nxt = min(left, key=lambda i: ((xy[i][0] - here[0]) ** 2 + (xy[i][1] - here[1]) ** 2, i))
        path.append(nxt); left.remove(nxt); here = xy[nxt]
    point = lambda k: start if k < 0 else xy[path[k]]
    dist = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])
    improved = True
    while improved and len(path) > 2:
        improved = False
        for a in range(-1, len(path) - 2):
            for b in range(a + 2, len(path)):
                # reverse path[a+1 .. b]: edges (a, a+1) and (b, b+1) become (a, b) and (a+1, b+1)
                before = dist(point(a), point(a + 1)) + (dist(point(b), point(b + 1)) if b + 1 < len(path) else 0)
                after = dist(point(a), point(b)) + (dist(point(a + 1), point(b + 1)) if b + 1 < len(path) else 0)
                if after < before - 1e-6:
                    path[a + 1:b + 1] = reversed(path[a + 1:b + 1]); improved = True
    return path


def plan_week(stops, days=5, max_per_day=None, start=None):
    """stops: [{'id', 'lon', 'lat'}]. Returns {'days': [...], 'unplanned': [ids], 'start_used': bool}.
    Each day: {'day': 1-based, 'stops': [ids in visiting order], 'count', 'meters_estimate', 'seconds_estimate'}."""
    if not 1 <= days <= MAX_DAYS: raise ValueError('days')
    if max_per_day is not None and not 1 <= max_per_day <= MAX_PER_DAY: raise ValueError('max_per_day')
    seen, points = set(), {}
    for stop in stops:
        ident = str(stop['id'])
        if ident in seen: continue
        seen.add(ident); points[ident] = (float(stop['lon']), float(stop['lat']))
    if not points:
        return {'days': [], 'unplanned': [], 'start_used': start is not None}
    project = _projector(list(points.values()) + ([start] if start else []))
    xy = {i: project(p) for i, p in points.items()}
    depot = project(start) if start else _centre(list(xy), xy)

    capacity = days * (max_per_day or MAX_PER_DAY)
    ids = sorted(xy, key=lambda i: (math.hypot(xy[i][0] - depot[0], xy[i][1] - depot[1]), i))
    kept, unplanned = ids[:capacity], ids[capacity:]
    xy_kept = {i: xy[i] for i in kept}
    active_days = min(days, len(kept))
    sizes = _sizes(len(kept), active_days)
    groups = _balanced_kmeans(xy_kept, _sweep(xy_kept, sorted(xy_kept), sizes), sizes)

    # days go round the start point in one direction, so the week reads as a sweep of the territory
    groups.sort(key=lambda g: (math.atan2(_centre(g, xy)[1] - depot[1], _centre(g, xy)[0] - depot[0]), g[0]))
    plan = []
    for index, members in enumerate(groups):
        path = order_day(depot, members, xy)
        meters = _path_length(depot, path, xy) * DETOUR
        plan.append({'day': index + 1, 'stops': path, 'count': len(path),
                     'meters_estimate': round(meters), 'seconds_estimate': round(meters / (SPEED_KMH * 1000 / 3600))})
    return {'days': plan, 'unplanned': sorted(unplanned), 'start_used': start is not None}


def read(body):
    """Validates a /weekly-plan request body into plan_week arguments."""
    stops = body.get('stops')
    if not isinstance(stops, list) or not 1 <= len(stops) <= MAX_STOPS: raise ValueError('stops')
    clean = []
    for stop in stops:
        if not isinstance(stop, dict): raise ValueError('stops')
        lon, lat, ident = stop.get('lon'), stop.get('lat'), stop.get('id')
        if not isinstance(ident, (str, int)) or isinstance(ident, bool) or not str(ident) or len(str(ident)) > 120: raise ValueError('id')
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lon, lat)): raise ValueError('point')
        if not (34 <= lon <= 56 and 16 <= lat <= 33): raise ValueError('point')
        clean.append({'id': str(ident), 'lon': lon, 'lat': lat})
    days = body.get('days', 5)
    if isinstance(days, bool) or not isinstance(days, int): raise ValueError('days')
    per_day = body.get('max_per_day')
    if per_day is not None and (isinstance(per_day, bool) or not isinstance(per_day, int)): raise ValueError('max_per_day')
    start = body.get('start')
    if start is not None:
        if not isinstance(start, dict): raise ValueError('start')
        lon, lat = start.get('lon'), start.get('lat')
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lon, lat)) or not (34 <= lon <= 56 and 16 <= lat <= 33):
            raise ValueError('start')
        start = (float(lon), float(lat))
    return clean, days, per_day, start
