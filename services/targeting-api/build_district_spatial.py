"""Spatial district fill + coordinate-quality audit for Atlas targets.

Purpose (data-quality workstream "district_spatial"):
  1. Fill `district_ar` / `district_en` for POIs where they are null, by
     point-in-polygon against the official district boundaries
     (`districts.geojson`), using only valid coordinates.
  2. Audit coordinate quality and flag POIs whose coordinate is unusable or
     suspect: null/zero coordinates, placeholder coordinates shared by many
     POIs (a city/district centroid used as a fallback), a point that falls in
     a district of a *different* city than the one stated, or a point that
     falls in no district at all.

Design decisions (user-first, per CLAUDE.md):
  - Districts are only ever read from the official boundary file. No name is
    invented in the UI layer; this module emits the Atlas-official `ar`/`en`
    spelling straight from the boundary properties.
  - A district is NEVER fabricated from a placeholder coordinate. When a
    coordinate is shared by at least PLACEHOLDER_MIN POIs it is treated as a
    centroid fallback, so the fill is withheld and the POI is flagged instead
    of being given false precision ("not available", not a guess).
  - A fill is only emitted when the point actually lies inside a boundary.
    Everything else is surfaced as an explicit coordinate-quality flag.

The module is import-safe (no work at import time) so it can be unit tested.
Run `python -m unittest test_build_district_spatial` for the point-in-polygon
checks, or run this file directly to build the delta parquet.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Optional

from shapely import STRtree
from shapely.geometry import Point, shape

# A coordinate shared by at least this many POIs is treated as a placeholder
# (city/district centroid fallback), not a real position. Calibrated from the
# v8 release: the top shared coordinates (50k+ POIs on one point) are clearly
# centroids, while genuine malls/complexes rarely exceed a few dozen POIs.
PLACEHOLDER_MIN = 50

# A coordinate shared by at least this many POIs is flagged as a soft warning
# ("dup_coord") even when a fill is still emitted.
DUP_WARN_MIN = 10


def _norm_city(name: Optional[str]) -> str:
    return (name or "").strip().casefold()


@dataclass(frozen=True)
class DistrictHit:
    district_ar: str
    district_en: str
    city_en: str


class DistrictIndex:
    """Point-in-polygon index over the official district boundaries.

    Builds a Shapely STRtree so a point only has to be tested against the few
    polygons whose bounding box it touches, instead of all 777.
    """

    def __init__(self, geoms, props):
        self._geoms = list(geoms)
        self._props = list(props)
        self._tree = STRtree(self._geoms)

    @classmethod
    def from_geojson(cls, geojson_path: str) -> "DistrictIndex":
        with open(geojson_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        geoms, props = [], []
        for feat in data["features"]:
            geom = shape(feat["geometry"])
            p = feat.get("properties", {})
            geoms.append(geom)
            props.append(
                {
                    "ar": p.get("ar") or p.get("name_ar") or p.get("district_ar"),
                    "en": p.get("en") or p.get("name_en") or p.get("district_en"),
                    "city_en": p.get("city_en"),
                }
            )
        return cls(geoms, props)

    def __len__(self) -> int:
        return len(self._geoms)

    @property
    def cities(self) -> set:
        """Distinct city_en values covered by the boundary file."""
        return {p["city_en"] for p in self._props if p.get("city_en")}

    def assign(self, lon: float, lat: float) -> Optional[DistrictHit]:
        """Return the district containing (lon, lat), or None.

        Coordinates are (lon, lat) to match GeoJSON axis order.
        """
        if lon is None or lat is None:
            return None
        pt = Point(lon, lat)
        for idx in self._tree.query(pt):
            geom = self._geoms[int(idx)]
            if geom.covers(pt):
                p = self._props[int(idx)]
                return DistrictHit(p["ar"], p["en"], p["city_en"])
        return None


def classify(
    stated_city_en: Optional[str],
    lat: Optional[float],
    lon: Optional[float],
    dup_count: int,
    index: DistrictIndex,
    covered_cities_cf: set,
):
    """Decide the fill + coordinate-quality flag for one POI.

    Returns (district_ar_fill, district_en_fill, district_fill_method,
    coord_quality_flag). Fills are None when not applicable.
    """
    # 1) unusable coordinates -> never fill.
    if lat is None or lon is None:
        return None, None, None, "null_coord"
    if lat == 0 or lon == 0:
        return None, None, None, "zero_coord"

    # 2) placeholder centroid shared by many POIs -> withhold fill.
    if dup_count >= PLACEHOLDER_MIN:
        return None, None, None, "shared_placeholder_coord"

    hit = index.assign(lon, lat)

    # 3) point lands in no district at all.
    if hit is None:
        if _norm_city(stated_city_en) in covered_cities_cf:
            return None, None, None, "outside_city_boundaries"
        return None, None, None, "city_not_covered"

    # 4) point lands in a district of a different city than stated.
    if (
        stated_city_en
        and hit.city_en
        and _norm_city(stated_city_en) != _norm_city(hit.city_en)
    ):
        # The point is authoritative for location, so we still fill the district
        # it physically sits in, but flag the city label / coordinate conflict.
        return hit.district_ar, hit.district_en, "point_in_polygon_city_mismatch", "city_mismatch"

    # 5) clean hit in the stated city.
    flag = "dup_coord" if dup_count >= DUP_WARN_MIN else "ok"
    return hit.district_ar, hit.district_en, "point_in_polygon", flag


def run_build(targets_parquet: str, geojson_path: str, out_parquet: str,
              temp_directory: Optional[str] = None):
    """Build the district_spatial delta parquet. Requires duckdb + pandas."""
    import duckdb

    con = duckdb.connect()
    if temp_directory:
        con.execute(f"SET temp_directory='{temp_directory}'")

    index = DistrictIndex.from_geojson(geojson_path)
    covered_cf = {_norm_city(c) for c in index.cities}

    # Rows we emit: every fill-candidate (null district + any coord), plus any
    # already-districted POI that sits on a heavily shared placeholder coord.
    rows = con.execute(
        f"""
        WITH g AS (
            SELECT latitude, longitude, count(*) n
            FROM read_parquet('{targets_parquet}')
            GROUP BY 1, 2
        )
        SELECT p.poi_key, p.city_en, p.latitude, p.longitude,
               p.district_ar AS existing_district_ar,
               p.population_spatial_match_status AS pop_status,
               COALESCE(g.n, 1) AS dup_count
        FROM read_parquet('{targets_parquet}') p
        LEFT JOIN g ON p.latitude IS NOT DISTINCT FROM g.latitude
                   AND p.longitude IS NOT DISTINCT FROM g.longitude
        WHERE p.district_ar IS NULL
           OR COALESCE(g.n, 1) >= {PLACEHOLDER_MIN}
        """
    ).fetchdf()

    out = {
        "poi_key": [], "district_ar_fill": [], "district_en_fill": [],
        "district_fill_method": [], "coord_quality_flag": [],
    }
    for r in rows.itertuples(index=False):
        is_fill_candidate = r.existing_district_ar is None
        if is_fill_candidate:
            dar, den, method, flag = classify(
                r.city_en, r.latitude, r.longitude, int(r.dup_count),
                index, covered_cf,
            )
        else:
            # already districted; only here because of a placeholder coord.
            dar = den = method = None
            flag = "shared_placeholder_coord"
        out["poi_key"].append(r.poi_key)
        out["district_ar_fill"].append(dar)
        out["district_en_fill"].append(den)
        out["district_fill_method"].append(method)
        out["coord_quality_flag"].append(flag)

    con.register("delta_df", __import__("pandas").DataFrame(out))
    con.execute(
        f"COPY (SELECT * FROM delta_df) TO '{out_parquet}' (FORMAT PARQUET)"
    )
    return out_parquet


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build district_spatial delta parquet")
    ap.add_argument("--targets", required=True)
    ap.add_argument("--geojson", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--temp-directory", default=None)
    a = ap.parse_args()
    path = run_build(a.targets, a.geojson, a.out, a.temp_directory)
    print("wrote", path)
