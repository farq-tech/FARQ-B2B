"""The site card of the store owners' lens: who lives around a candidate site, and who already competes there.

For a range (a circle or a drive-time area) it gives:
- the people living in it (the same building layer and figure as population_within);
- women, men, Saudis and non-Saudis: each district's people inside the range × that district's measured share
  (910ths), summed. Shares are never multiplied together, and a segment is «غير متاح» (None) unless every district
  with people in the range has a measured share — the card never fills a gap with a guess;
- children under 15: the same split by each district's age shape. Ages are a pattern of the region scaled to the
  district total, not a measurement (docs/atlas-product-foundation.md §2), so this figure is returned as an estimate;
- the competitors of the chosen activity inside the range: their count, per km² of the range, and the nearest by name.

Only aggregates and business names leave this module; no contact, key or coordinate of a business.
"""
import math

import insights

CHILD_AGES = ('00', '01', '05', '10')   # 0-1, 1-4, 5-9, 10-14 in build_population_demographics.AGE_CODES


def people_by_district(db, points_path, geometry, household_size):
    """Residents inside the range by the district their building is in: {district id: people}, or None without the
    building layer."""
    polygons = insights.canonical_data._polygons(geometry)
    coords = [p for rings in polygons for ring in rings for p in ring]
    if not points_path or not coords:
        return None
    columns = {row[0] for row in db.execute('describe select * from read_parquet(?)', [points_path]).fetchall()}
    if 'district_id' not in columns:
        return None
    people = 'population' if 'population' in columns else f'dwellings * {float(household_size)}'
    west, east = min(p[0] for p in coords), max(p[0] for p in coords)
    south, north = min(p[1] for p in coords), max(p[1] for p in coords)
    rows = db.execute(f"""select longitude, latitude, cast(district_id as varchar), {people} from read_parquet(?)
                          where longitude between ? and ? and latitude between ? and ?""",
                      [points_path, west, east, south, north]).fetchall()
    out = {}
    for (lon, lat, district, count), keep in zip(rows, insights._inside_mask([r[0] for r in rows], [r[1] for r in rows], polygons)):
        if not keep:
            continue
        if isinstance(count, bool) or count is None:
            return None
        try:
            count = float(count)
        except (TypeError, ValueError, OverflowError):
            return None
        if not math.isfinite(count) or count < 0:
            return None
        out[district] = out.get(district, 0.0) + count
        if not math.isfinite(out[district]):
            return None
    return out


def child_shares(demographics):
    """Each district's share of children under 15 from the golden by-age rows: {district name: share}."""
    totals, children = {}, {}
    for row in demographics or []:
        if row.get('age_code') == 'ALL' or row.get('total') is None:
            continue
        name = row.get('district_ar')
        totals[name] = totals.get(name, 0.0) + float(row['total'])
        if row.get('age_code') in CHILD_AGES:
            children[name] = children.get(name, 0.0) + float(row['total'])
    return {name: children.get(name, 0.0) / total for name, total in totals.items() if total > 0}


def _split(people, share):
    """Σ people × share over the districts, or None when any district with people has no share."""
    if not people or any(share.get(name) is None for name in people):
        return None
    return round(sum(count * share[name] for name, count in people.items()))


NO_BUILDINGS = 'لا تتوفر بيانات سكان صالحة أو مكتملة من طبقة المباني لهذا النطاق.'
NO_RESIDENTS = 'لا مبانٍ سكنية داخل النطاق.'
UNNAMED = 'بعض سكان النطاق خارج الأحياء المسماة، فلا يُقسَّم عددهم.'
SEGMENTS = ('men', 'women', 'saudi', 'non_saudi', 'children')


def _missing(people, share, what):
    """Why _split gave None, in one short Arabic line, naming up to three districts without the share."""
    gaps = sorted(name for name in people if share.get(name) is None)
    if not gaps:
        return None
    more = f' و{len(gaps) - 3} غيرها' if len(gaps) > 3 else ''
    return f'لا {what} لحي في النطاق: {"، ".join(gaps[:3])}{more}.'


def segments(people_by_id, id_map, names, audience, children):
    """The card's people figures. people_by_id: {building district id: people}; id_map/names: canonical_data's
    district id map and canonical names; audience: [{district_ar, male_pct, saudi_pct}]; children: child_shares()."""
    people = {}
    for district, count in (people_by_id or {}).items():
        canonical = str(id_map.get(district, district))
        name = (names.get(canonical) or (None,))[0]
        people[name] = people.get(name, 0.0) + count
    total = round(sum(people.values())) if people_by_id is not None else None
    male = {row['district_ar']: row['male_pct'] / 100 for row in audience or [] if row.get('male_pct') is not None}
    saudi = {row['district_ar']: row['saudi_pct'] / 100 for row in audience or [] if row.get('saudi_pct') is not None}
    flip = lambda shares: {name: 1 - value for name, value in shares.items()}
    known = {name: count for name, count in people.items() if name is not None}
    if len(known) != len(people):
        known = {}   # a building outside every named district: its people cannot be split, so no segment is
    out = {
        'population': total,
        'men': _split(known, male), 'women': _split(known, flip(male)),
        'saudi': _split(known, saudi), 'non_saudi': _split(known, flip(saudi)),
        'children': _split(known, children), 'children_is_estimate': True,
        'districts': len(known),
    }
    out['reasons'] = _segment_reasons(out, people_by_id, people, known, male, saudi, children)
    return out


def _segment_reasons(out, people_by_id, people, known, male, saudi, children):
    """{field: why it is None} for each people figure the card cannot give; a figure it gives has no entry."""
    if people_by_id is None:
        return {field: NO_BUILDINGS for field in ('population',) + SEGMENTS}
    if not people:
        cause = dict.fromkeys(SEGMENTS, NO_RESIDENTS)
    elif not known:
        cause = dict.fromkeys(SEGMENTS, UNNAMED)
    else:
        sex = _missing(known, male, 'نسبة مقيسة للذكور والإناث')
        nationality = _missing(known, saudi, 'نسبة مقيسة للسعوديين')
        cause = {'men': sex, 'women': sex, 'saudi': nationality, 'non_saudi': nationality,
                 'children': _missing(known, children, 'توزيع عمري')}
    return {field: text for field, text in cause.items() if out[field] is None and text}


def reasons(competitors, residents_per_competitor, population):
    """{field: why it is None} for the card's competitor figures (per_km2, residents_per_competitor). Without a chosen
    activity there is no competitor figure at all, which the card already says, so there is nothing to explain."""
    if competitors is None:
        return {}
    out = {}
    if competitors.get('per_km2') is None:
        out['per_km2'] = 'تعذر حساب مساحة النطاق.'
    if residents_per_competitor is None:
        out['residents_per_competitor'] = 'عدد السكان غير متاح.' if population is None else 'لا منافس داخل النطاق.'
    return out


def _metres(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(a))


def nearest(rows, geometry, centre, limit):
    """rows: (name, district, lon, lat). The ones inside the range, nearest the centre first."""
    polygons = insights.canonical_data._polygons(geometry)
    placed = [row for row in rows if row[2] is not None and row[3] is not None]
    inside = [row for row, keep in zip(placed, insights._inside_mask([r[2] for r in placed], [r[3] for r in placed], polygons)) if keep]
    if centre:
        ranked = sorted(inside, key=lambda row: (_metres(centre[0], centre[1], row[2], row[3]), row[0] or ''))
    else:
        ranked = sorted(inside, key=lambda row: row[0] or '')
    return len(inside), [{'name': name, 'district_ar': district,
                          'distance_m': round(_metres(centre[0], centre[1], lon, lat)) if centre else None}
                         for name, district, lon, lat in ranked[:limit]]
