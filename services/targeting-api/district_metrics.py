# -*- coding: utf-8 -*-
"""The one definition of every derived district figure Atlas shows: area, residents per business, businesses per km²,
density, and the audience segment sizes. The map reads these from the service and never recomputes them, so no two
screens can disagree (docs/atlas-product-foundation.md). A missing input yields None — never a zero or a guess."""
import math

import canonical_data


def rounded_count(value):
    """Round a known count for an API response while preserving a measured zero."""
    return round(value) if value is not None else None


def area_km2(geometry):
    """A district outline's area in km², on a local flat projection (well under 1% off at district scale)."""
    total = 0.0
    for polygon in canonical_data._polygons(geometry):
        for index, ring in enumerate(polygon):
            if len(ring) < 3:
                continue
            lat = (sum(point[1] for point in ring) / len(ring)) * (math.pi / 180)
            twice = sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1))
            km2 = abs(twice / 2) * 111.32 * 111.32 * math.cos(lat)
            total += km2 if index == 0 else -km2   # inner rings are holes
    return total


def residents_per(population, count):
    """Residents for each business (or competitor); None when either figure is missing or there are none."""
    return (population / count) if (population is not None and count) else None


def scope_summary(populations, business_counts):
    """Aggregate a selected district scope on matching population and located-directory coverage."""
    if not populations or len(populations) != len(business_counts):
        return {"population": None, "businesses": None, "residents_per": None, "districts": 0}
    businesses_known = all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
                           for value in business_counts)
    population_known = all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
                          for value in populations)
    businesses = sum(business_counts) if businesses_known else None
    population = sum(populations) if population_known else None
    return {"population": population, "businesses": businesses,
            "residents_per": residents_per(population, businesses), "districts": len(populations)}


def unique_district_features_by_name(features):
    """Index official district features by exact Arabic label only when that label identifies one feature."""
    grouped = {}
    for feature in features:
        properties = feature.get('properties') or {}
        name = properties.get('ar') or properties.get('district_ar')
        if isinstance(name, str) and name:
            grouped.setdefault(name, []).append(feature)
    return {name: matches[0] if len(matches) == 1 else None for name, matches in grouped.items()}


def attach_district_ids(rows, features):
    """Attach an official district ID to aggregate rows only when the exact label maps to one feature."""
    index = unique_district_features_by_name(features)
    for row in rows:
        feature = index.get(row.get('district_ar'))
        district_id = (feature.get('properties') or {}).get('id') if feature else None
        row['district_id'] = str(district_id) if district_id is not None else None
    return rows


def unique_district_names_by_ids(district_ids, features):
    """Resolve requested canonical IDs to names only when each ID and each name identify one feature."""
    by_id, by_name = {}, {}
    for feature in features:
        properties = feature.get('properties') or {}
        district_id = properties.get('id')
        name = properties.get('ar') or properties.get('district_ar')
        if district_id is not None:
            by_id.setdefault(str(district_id), []).append(name)
        if isinstance(name, str) and name:
            by_name.setdefault(name, []).append(district_id)
    names = []
    for district_id in district_ids:
        matches = by_id.get(str(district_id), [])
        if len(matches) != 1 or not matches[0] or len(by_name.get(matches[0], [])) != 1:
            return None
        names.append(matches[0])
    return names


def population_audience_by_id(population_rows, audience_rows):
    """Join golden population and measured 910ths sex shares by ID; duplicate IDs remain unavailable."""
    population_groups = {}
    for row in population_rows or []:
        if row.get('district_id') is not None:
            population_groups.setdefault(str(row['district_id']), []).append(row)
    audience_groups = {}
    for row in audience_rows or []:
        if row.get('district_id') is not None:
            audience_groups.setdefault(str(row['district_id']), []).append(row)
    result = {}
    for district_id, group in population_groups.items():
        if len(group) != 1:
            continue
        row = group[0]
        size = {'men': None, 'women': None}
        shares = audience_groups.get(district_id, [])
        if len(shares) == 1:
            audience = audience_sizes(row.get('population'), shares[0].get('male_pct'), None)
            size = {'men': audience['men'], 'women': audience['women']}
        result[district_id] = {
            'district_id': district_id, 'district_ar': row.get('district_ar'),
            'population': row.get('population'), 'male': size['men'], 'female': size['women'],
            'source': row.get('source'),
        }
    return result


def per_km2(count, area):
    """Businesses per km²; None without an area."""
    return (count / area) if area else None


def density(population, area):
    """Residents per km²; None without a population or an area."""
    return (population / area) if (population is not None and area) else None


def audience_sizes(population, male_pct, saudi_pct):
    """Segment sizes = population × each measured share. Two shares are never multiplied together (their overlap is
    not measured). None where the population or that share is missing."""
    def share(pct):
        return (population * pct / 100) if (population is not None and pct is not None) else None
    return {
        "men": share(male_pct),
        "women": share(None if male_pct is None else 100 - male_pct),
        "saudi": share(saudi_pct),
        "non_saudi": share(None if saudi_pct is None else 100 - saudi_pct),
    }
