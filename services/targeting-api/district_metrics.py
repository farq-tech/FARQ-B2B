# -*- coding: utf-8 -*-
"""The one definition of every derived district figure Atlas shows: area, residents per business, businesses per km²,
density, and the audience segment sizes. The map reads these from the service and never recomputes them, so no two
screens can disagree (docs/atlas-product-foundation.md). A missing input yields None — never a zero or a guess."""
import math

import canonical_data


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
