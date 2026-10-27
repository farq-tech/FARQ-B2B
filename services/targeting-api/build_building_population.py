#!/usr/bin/env python3
"""Estimate district population from the Farq building layer (dasymetric method).

WorldPop spreads people over a 100 m satellite grid, so it blurs residential
blocks into commercial streets and empty lots. The building layer knows which
footprints are homes (`building_use`, verified by the owner as reliable), how
large they are, and in most cases how tall. Each home building becomes a number
of dwellings: a villa is one household however large it is, other homes are
floor area × home storeys over a flat size, a ground floor goes to shops when the
building is mixed use or a directory business lies inside it, and buildings under
construction hold nobody. A city's official population is then distributed over
its districts in proportion to dwellings; dwellings × household size also gives a
buildings-only total with no outside population source. Nothing is invented: the
total comes from the General Authority for Statistics (or, until an official
city figure is supplied, from the WorldPop city sum, and the output says which),
and the distribution comes from real buildings assigned to official district
polygons by point-in-polygon, never by the free-text district field.

`Apartments` is deliberately not used: the owner reports it is sparsely filled.

Runs on the Farq data server; inputs stay on its volume. Outputs one parquet
beside the WorldPop layer plus a JSON report with every assumption and the
per-district disagreement with WorldPop, so the map can show both estimates and
flag districts where they diverge instead of presenting one number as fact.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import statistics
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

LIBS = os.environ.get("FARQ_AUDIT_LIBS", "/tmp/farq-audit-libs")
if LIBS and LIBS not in sys.path:
    sys.path.insert(0, LIBS)

import duckdb
import shapely
from shapely.strtree import STRtree

DATA_DIR = Path(os.environ.get("FARQ_DATA_DIR", "/app/data"))
POP_DIR = DATA_DIR / "buildings_ingest" / "population"
SOURCE = "farq_buildings_dasymetric_v2"
USE_WEIGHT = {"residential": 1.0, "mixed_use": 1.0}   # uses that can hold homes; mixed use loses its ground floor below
# Dwelling-unit model. These constants scale every building alike, so they set the buildings-only total but
# cancel out of the district shares once a city total is calibrated; only the villa/apartment split and the
# floors removed for shops change how people are distributed between districts.
NET_FACTOR = 0.75          # share of gross floor area that is flats (stairs, shafts and walls excluded)
UNIT_M2 = 150.0            # net floor area of one flat
HOUSEHOLD_SIZE = 5.0       # people per dwelling for the buildings-only total; replace with an official figure when known
VILLA_PURPOSES = {"villa", "townhouse"}
NOT_YET_HOMES = ("under construction", "under repair")
NEW_BUILDING_TYPES = ("مباني جديدة", "new_building")   # vendor "new building" layer: built since the last survey


def write_rows(db, rows: list[dict], columns: list[tuple[str, str]], target: Path) -> None:
    """Write dict rows to parquet through a temporary CSV with explicit column types."""
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[name for name, _ in columns])
        writer.writeheader()
        writer.writerows(rows)
        temp_csv = handle.name
    try:
        spec = ", ".join(f"'{name}': '{kind}'" for name, kind in columns)
        quoted = str(target).replace("'", "''")
        db.execute(f"copy (select * from read_csv(?, header=true, nullstr='', columns={{{spec}}})) to '{quoted}' (format parquet, compression zstd)", [temp_csv])
    finally:
        os.unlink(temp_csv)


def growth_by_district(db, buildings: Path, columns: dict, tree, ids: list, batch: int = 50_000) -> dict:
    """Buildings that are being built, of any use, per official district: under construction or repair
    (from Purpose) and newly mapped buildings (from Type). A leading signal of where demand is arriving."""
    purpose_col, type_col, use_col = columns.get("purpose"), columns.get("type"), columns["building_use"]
    if not purpose_col and not type_col:
        return {}
    conditions = []
    if purpose_col:
        conditions.append(f"lower({purpose_col}) like '%under construction%' or lower({purpose_col}) like '%under repair%'")
    if type_col:
        conditions.append(f"lower({type_col}) in ({', '.join(repr(t) for t in NEW_BUILDING_TYPES)})")
    select = (f"select {columns['geometry_wkb_hex']}, {use_col}, " + (purpose_col or "null") + ", " + (type_col or "null") +
              f" from read_parquet(?) where ({' or '.join(conditions)}) and {columns['geometry_wkb_hex']} <> ''")
    elevation_col = columns.get("elevation")
    if elevation_col:
        select = select.replace(" from read_parquet(?)", f", try_cast({elevation_col} as double) from read_parquet(?)", 1)
    else:
        select = select.replace(" from read_parquet(?)", ", null from read_parquet(?)", 1)
    out: dict = defaultdict(lambda: {"under_construction": 0, "new_buildings": 0, "homes_under_construction": 0, "floor_area_m2": 0.0})
    cursor = db.execute(select, [str(buildings)])
    while True:
        rows = cursor.fetchmany(batch)
        if not rows:
            break
        geoms, meta = [], []
        for wkb_hex, use, purpose, typ, elevation in rows:
            try:
                geom = shapely.from_wkb(bytes.fromhex(wkb_hex))
            except Exception:
                continue
            geoms.append(geom)
            meta.append((use, (purpose or "").casefold(), (typ or "").casefold(), elevation))
        if not geoms:
            continue
        cents = [g.centroid for g in geoms]
        hits = tree.query(cents, predicate="within")
        first = {}
        for pi, di in zip(hits[0], hits[1]):
            first.setdefault(int(pi), int(di))
        for i, (use, purpose, typ, elevation) in enumerate(meta):
            if i not in first:
                continue
            bucket = out[ids[first[i]]]
            building = any(token in purpose for token in NOT_YET_HOMES)
            bucket["under_construction" if building else "new_buildings"] += 1
            if building and (use in ("residential", "mixed_use") or "villa" in purpose or "residential" in purpose):
                bucket["homes_under_construction"] += 1
            floors = max(1, min(60, round(elevation))) if elevation and elevation > 0 else 1
            bucket["floor_area_m2"] += footprint_m2(geoms[i], cents[i].y) * floors
    return out
DIVERGENCE_PCT = 30.0                                  # beyond this the two estimates are shown as disagreeing
MIN_COMPARABLE = 500                                   # below this many people a percentage gap is noise
EARTH_M_PER_DEG = 111_320.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def footprint_m2(geom, lat: float) -> float:
    """Planar area of a small WGS84 polygon; good to well under 1% at building scale."""
    return abs(geom.area) * EARTH_M_PER_DEG * EARTH_M_PER_DEG * math.cos(math.radians(lat))


def decide_elevation_mode(values: list[float], requested: str) -> tuple[str, dict]:
    """How to read the `Elevation` field: storey count, height in metres, or not at all."""
    stats: dict = {"positive_values": len(values)}
    if not values:
        return ("ignore", {**stats, "reason": "no positive elevation values"})
    median = statistics.median(values)
    integer_share = sum(1 for v in values if abs(v - round(v)) < 1e-6) / len(values)
    stats.update({"median": median, "integer_share": round(integer_share, 3), "p95": sorted(values)[int(0.95 * (len(values) - 1))]})
    if requested != "auto":
        return (requested, {**stats, "reason": "requested"})
    if median >= 8:
        return ("height", {**stats, "reason": "median looks like metres"})
    if 1 <= median <= 7 and integer_share >= 0.9:
        return ("floors", {**stats, "reason": "small integers look like storey counts"})
    return ("ignore", {**stats, "reason": "ambiguous; every building counted as one storey"})


def floors_from(value: float | None, mode: str, floor_height: float) -> tuple[int, bool]:
    """(storeys, known) — unknown buildings count as one storey rather than being dropped."""
    if value is None or value <= 0 or mode == "ignore":
        return 1, False
    if mode == "height":
        return max(1, min(60, round(value / floor_height))), True
    return max(1, min(60, round(value))), True


def dwelling_units(use: str, purpose: str, area_m2: float, floors: int, shops: int) -> tuple[float, str]:
    """(dwellings, class) for one building. Shops found inside take the ground floor; a one-storey
    building with a shop in it is a shop. Villas are one household however large they are."""
    p = (purpose or "").strip().casefold()
    if any(token in p for token in NOT_YET_HOMES):
        return 0.0, "not_yet_occupied"
    if p in VILLA_PURPOSES:
        if shops and floors <= 1:
            return 0.0, "shop"
        return (2.0 if floors >= 3 else 1.0), "villa"
    homes_floors = floors - 1 if (use == "mixed_use" or shops) else floors
    if homes_floors <= 0:
        return 0.0, "shop"
    return area_m2 * homes_floors * NET_FACTOR / UNIT_M2, ("mixed_use" if use == "mixed_use" else "apartments")


def load_pois(path: Path | None):
    """Point locations of directory businesses, used only to find shops inside buildings."""
    if not path or not path.is_file():
        return None, 0
    db = duckdb.connect()
    try:
        cols = {row[0].casefold() for row in db.execute("describe select * from read_parquet(?)", [str(path)]).fetchall()}
        where = " and location_precision = 'point'" if "location_precision" in cols else ""
        rows = db.execute(f"select longitude, latitude from read_parquet(?) where longitude is not null and latitude is not null{where}", [str(path)]).fetchall()
    finally:
        db.close()
    if not rows:
        return None, 0
    return STRtree(shapely.points(rows)), len(rows)


def load_official(path: Path | None) -> dict[str, dict]:
    if not path:
        return {}
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    out = {}
    for row in rows:
        city = (row.get("city_en") or "").strip()
        try:
            population = float(row["population"])
        except (KeyError, TypeError, ValueError):
            continue
        if city and population > 0:
            out[city] = {"population": population, "year": (row.get("year") or "").strip(), "source": (row.get("source") or "").strip()}
    return out


def load_districts(path: Path):
    collection = json.loads(path.read_text(encoding="utf-8"))
    ids, geoms, props, invalid = [], [], {}, 0
    for feature in collection.get("features", []):
        prop = feature.get("properties") or {}
        did, geo = prop.get("id"), feature.get("geometry")
        if did is None or not geo:
            continue
        geom = shapely.geometry.shape(geo)
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
            invalid += 1
        ids.append(did)
        geoms.append(geom)
        props[did] = prop
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate district ids in boundary source")
    return ids, geoms, props, invalid


def load_worldpop(path: Path | None) -> dict:
    if not path or not path.is_file():
        return {}
    db = duckdb.connect()
    try:
        rows = db.execute("select district_id, city_en, population_estimate from read_parquet(?)", [str(path)]).fetchall()
    finally:
        db.close()
    return {row[0]: {"city_en": row[1], "population": row[2]} for row in rows}


def build(buildings: Path, districts: Path, output_dir: Path, worldpop: Path | None, official: Path | None,
          elevation_mode: str = "auto", floor_height: float = 3.2, year: int = 2026, batch: int = 50_000,
          pois: Path | None = None) -> dict:
    ids, geoms, props, invalid_polygons = load_districts(districts)
    tree = STRtree(geoms)
    poi_tree, poi_count = load_pois(pois)
    official_totals = load_official(official)
    worldpop_rows = load_worldpop(worldpop)

    db = duckdb.connect()
    db.execute("SET threads=4; SET memory_limit='4GB'")
    columns = {row[0].casefold(): row[0] for row in db.execute("describe select * from read_parquet(?)", [str(buildings)]).fetchall()}
    for needed in ("building_use", "geometry_wkb_hex", "city_en"):
        if needed not in columns:
            raise ValueError(f"building layer is missing column {needed}")
    elevation_col = columns.get("elevation")
    purpose_col = columns.get("purpose")
    uses = ", ".join(f"'{u}'" for u in USE_WEIGHT)
    select = f"select {columns['building_use']}, {columns['city_en']}, {columns['geometry_wkb_hex']}, " + (f"try_cast({elevation_col} as double)" if elevation_col else "null") + \
        (f", {purpose_col}" if purpose_col else ", null") + \
        f" from read_parquet(?) where {columns['building_use']} in ({uses}) and {columns['geometry_wkb_hex']} is not null and {columns['geometry_wkb_hex']} <> ''"

    # First pass: decide how to read Elevation from a sample, so the rule is stated once and applied uniformly.
    sample = [row[0] for row in db.execute(f"select try_cast({elevation_col} as double) from read_parquet(?) where {columns['building_use']} in ({uses}) and try_cast({elevation_col} as double) > 0 using sample 200000 rows", [str(buildings)]).fetchall()] if elevation_col else []
    mode, elevation_stats = decide_elevation_mode([float(v) for v in sample if v is not None], elevation_mode)

    per_district: dict = defaultdict(lambda: {"buildings": 0, "floors_known": 0, "area_m2": 0.0, "weight": 0.0, "by_use": defaultdict(int), "by_class": defaultdict(int)})
    per_city: dict = defaultdict(lambda: {"candidate_buildings": 0, "assigned": 0, "outside_boundaries": 0, "ambiguous_boundary": 0, "invalid_geometry": 0, "by_use": defaultdict(int)})
    points: list[dict] = []   # one row per occupied home building, for population-around-a-point queries
    cursor = db.execute(select, [str(buildings)])
    while True:
        rows = cursor.fetchmany(batch)
        if not rows:
            break
        geometries, meta = [], []
        for use, city, wkb_hex, elevation, purpose in rows:
            city = city or ""
            per_city[city]["candidate_buildings"] += 1
            per_city[city]["by_use"][use] += 1
            try:
                geom = shapely.from_wkb(bytes.fromhex(wkb_hex))
                if geom.is_empty:
                    raise ValueError("empty")
            except Exception:
                per_city[city]["invalid_geometry"] += 1
                continue
            geometries.append(geom)
            meta.append((use, city, elevation, purpose))
        if not geometries:
            continue
        centroids = [g.centroid for g in geometries]
        hits = tree.query(centroids, predicate="within")   # (centroid index, district index) pairs
        matched: dict[int, list[int]] = defaultdict(list)
        for point_idx, district_idx in zip(hits[0], hits[1]):
            matched[int(point_idx)].append(int(district_idx))
        shops = defaultdict(int)
        if poi_tree is not None:
            inside = poi_tree.query(geometries, predicate="contains")   # (building index, poi index) pairs
            for building_idx in inside[0]:
                shops[int(building_idx)] += 1
        for i, (use, city, elevation, purpose) in enumerate(meta):
            found = matched.get(i)
            if not found:
                per_city[city]["outside_boundaries"] += 1
                continue
            if len(found) > 1:
                per_city[city]["ambiguous_boundary"] += 1
            district_id = ids[found[0]]
            floors, known = floors_from(elevation, mode, floor_height)
            area = footprint_m2(geometries[i], centroids[i].y)
            bucket = per_district[district_id]
            bucket["buildings"] += 1
            bucket["floors_known"] += int(known)
            bucket["area_m2"] += area
            units, kind = dwelling_units(use, purpose, area, floors, shops.get(i, 0))
            bucket["weight"] += units
            if units > 0:
                points.append({"longitude": round(centroids[i].x, 6), "latitude": round(centroids[i].y, 6), "district_id": district_id, "dwellings": round(units, 2)})
            bucket["by_use"][use] += 1
            bucket["by_class"][kind] += 1
            per_city[city]["assigned"] += 1

    # Calibration totals per city, by the district polygons' own city label so the share and the total agree.
    district_city = {did: (props[did].get("city_en") or "") for did in ids}
    city_weight: dict[str, float] = defaultdict(float)
    for did, bucket in per_district.items():
        city_weight[district_city[did]] += bucket["weight"]
    worldpop_city: dict[str, float] = defaultdict(float)
    for did, row in worldpop_rows.items():
        if row["population"] is not None and did in district_city:
            worldpop_city[district_city[did]] += float(row["population"])
    calibration: dict[str, dict] = {}
    for city in set(district_city.values()):
        if city in official_totals:
            calibration[city] = {"total": official_totals[city]["population"], "source": "official:" + (official_totals[city]["source"] or "unspecified"), "year": official_totals[city]["year"]}
        elif worldpop_city.get(city):
            calibration[city] = {"total": worldpop_city[city], "source": "worldpop_city_total", "year": "2025"}
        else:
            calibration[city] = {"total": None, "source": None, "year": None}

    out_rows, divergent, comparable = [], 0, 0
    for did in ids:
        prop, city = props[did], district_city[did]
        bucket = per_district.get(did)
        cal = calibration[city]
        share = (bucket["weight"] / city_weight[city]) if bucket and city_weight[city] > 0 else None
        estimate = round(share * cal["total"], 1) if share is not None and cal["total"] else None
        wp = worldpop_rows.get(did, {}).get("population")
        diff_pct = flag = None
        if estimate is not None and wp is not None and wp >= MIN_COMPARABLE and estimate >= MIN_COMPARABLE:
            diff_pct = round((estimate - wp) / wp * 100, 1)
            flag = abs(diff_pct) > DIVERGENCE_PCT
            comparable += 1
            divergent += int(flag)
        out_rows.append({
            "district_id": did, "district_ar": prop.get("ar"), "district_en": prop.get("en"), "city_ar": prop.get("city_ar"), "city_en": city,
            "residential_buildings": bucket["by_use"]["residential"] if bucket else 0,
            "mixed_use_buildings": bucket["by_use"]["mixed_use"] if bucket else 0,
            "floors_known_pct": round(100 * bucket["floors_known"] / bucket["buildings"], 1) if bucket and bucket["buildings"] else None,
            "villas": bucket["by_class"]["villa"] if bucket else 0,
            "shops_or_unoccupied_excluded": (bucket["by_class"]["shop"] + bucket["by_class"]["not_yet_occupied"]) if bucket else 0,
            "dwelling_units": round(bucket["weight"], 1) if bucket else 0.0,
            "population_buildings_only": round(bucket["weight"] * HOUSEHOLD_SIZE, 1) if bucket else None,
            "city_weight_share": round(share, 6) if share is not None else None,
            "population_estimate": estimate,
            "calibration_total": cal["total"], "calibration_source": cal["source"], "calibration_year": cal["year"],
            "worldpop_estimate": wp, "worldpop_diff_pct": diff_pct, "estimates_diverge": flag,
            "population_year": year, "population_source": SOURCE, "elevation_mode": mode,
        })

    output_dir.mkdir(parents=True, exist_ok=True)
    out_parquet = output_dir / f"district_population_buildings_{year}.parquet"
    fields = list(out_rows[0].keys()) if out_rows else ["district_id"]
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(out_rows)
        temp_csv = handle.name
    try:
        db.execute("create table out as select * from read_csv(?, header=true, nullstr='', columns={" + ", ".join(
            f"'{f}': '{t}'" for f, t in [("district_id", "VARCHAR"), ("district_ar", "VARCHAR"), ("district_en", "VARCHAR"), ("city_ar", "VARCHAR"), ("city_en", "VARCHAR"),
                                          ("residential_buildings", "BIGINT"), ("mixed_use_buildings", "BIGINT"), ("floors_known_pct", "DOUBLE"), ("villas", "BIGINT"), ("shops_or_unoccupied_excluded", "BIGINT"),
                                          ("dwelling_units", "DOUBLE"), ("population_buildings_only", "DOUBLE"),
                                          ("city_weight_share", "DOUBLE"), ("population_estimate", "DOUBLE"), ("calibration_total", "DOUBLE"), ("calibration_source", "VARCHAR"),
                                          ("calibration_year", "VARCHAR"), ("worldpop_estimate", "DOUBLE"), ("worldpop_diff_pct", "DOUBLE"), ("estimates_diverge", "BOOLEAN"),
                                          ("population_year", "INTEGER"), ("population_source", "VARCHAR"), ("elevation_mode", "VARCHAR")]) + "})", [temp_csv])
        target = str(out_parquet).replace("'", "''")
        db.execute(f"copy out to '{target}' (format parquet, compression zstd)")
    finally:
        os.unlink(temp_csv)
        db.close()

    points_parquet = output_dir / f"building_points_{year}.parquet"
    growth_parquet = output_dir / f"district_growth_{year}.parquet"
    db = duckdb.connect()
    try:
        db.execute("SET threads=4; SET memory_limit='4GB'")
        write_rows(db, points, [("longitude", "DOUBLE"), ("latitude", "DOUBLE"), ("district_id", "VARCHAR"), ("dwellings", "DOUBLE")], points_parquet)
        growth = growth_by_district(db, buildings, columns, tree, ids)
        write_rows(db, [{"district_id": did, "district_ar": props[did].get("ar"), "city_en": district_city[did], **{k: (round(v, 1) if isinstance(v, float) else v) for k, v in growth[did].items()}}
                        for did in ids if did in growth],
                   [("district_id", "VARCHAR"), ("district_ar", "VARCHAR"), ("city_en", "VARCHAR"), ("under_construction", "BIGINT"), ("new_buildings", "BIGINT"),
                    ("homes_under_construction", "BIGINT"), ("floor_area_m2", "DOUBLE")], growth_parquet)
    finally:
        db.close()

    report = {
        "source": SOURCE, "year": year,
        "inputs": {"buildings": {"path": str(buildings), "sha256": sha256(buildings)}, "districts": {"path": str(districts), "sha256": sha256(districts), "invalid_polygons_repaired": invalid_polygons},
                   "worldpop": str(worldpop) if worldpop else None, "official": str(official) if official else None},
        "method": {"weight": "dwelling units: villa = 1 (2 when 3+ storeys); other homes = footprint_m2 × home storeys × net_factor / unit_m2; "
                             "home storeys drop the ground floor for mixed use or when a directory business lies inside; under construction/repair excluded",
                   "net_factor": NET_FACTOR, "unit_m2": UNIT_M2, "household_size_for_buildings_only_total": HOUSEHOLD_SIZE,
                   "pois": {"path": str(pois) if pois else None, "points": poi_count},
                   "use_weight": USE_WEIGHT, "apartments_field_used": False,
                   "elevation_mode": mode, "elevation_stats": elevation_stats, "floor_height_m": floor_height,
                   "calibration": "district weight share × city total (official when supplied, else WorldPop city sum)",
                   "divergence_threshold_pct": DIVERGENCE_PCT, "min_comparable_population": MIN_COMPARABLE},
        "cities": {city: {**{k: v for k, v in stats.items() if k != "by_use"}, "by_use": dict(stats["by_use"]),
                          "calibration": calibration.get(city), "districts": sum(1 for d in ids if district_city[d] == city)}
                   for city, stats in sorted(per_city.items())},
        "districts": {"total": len(ids), "with_buildings": len(per_district), "comparable_with_worldpop": comparable, "diverging_from_worldpop": divergent},
        "output": {"file": out_parquet.name, "rows": len(out_rows), "building_points": {"file": points_parquet.name, "rows": len(points)},
                   "growth": {"file": growth_parquet.name, "districts": len(growth), "under_construction": sum(g["under_construction"] for g in growth.values()),
                              "new_buildings": sum(g["new_buildings"] for g in growth.values())}},
    }
    (output_dir / f"district_population_buildings_{year}_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="District population from residential building footprints, calibrated to official totals")
    parser.add_argument("--buildings", type=Path, default=DATA_DIR / "buildings_ingest" / "normalized" / "buildings.parquet")
    parser.add_argument("--districts", type=Path, default=DATA_DIR / "districts.geojson")
    parser.add_argument("--worldpop", type=Path, default=POP_DIR / "district_population_2025.parquet", help="WorldPop district layer for comparison and fallback calibration")
    parser.add_argument("--official", type=Path, default=None, help="CSV with city_en,population,year,source (official city totals)")
    parser.add_argument("--output", type=Path, default=POP_DIR)
    parser.add_argument("--elevation-mode", choices=["auto", "height", "floors", "ignore"], default="auto")
    parser.add_argument("--floor-height", type=float, default=3.2, help="metres per storey when Elevation is a height")
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--pois", type=Path, default=DATA_DIR / "targets.parquet", help="directory businesses (longitude/latitude) used to find shops inside buildings")
    args = parser.parse_args()
    for path in (args.buildings, args.districts):
        if not path.is_file():
            raise SystemExit(f"Missing source: {path}")
    report = build(args.buildings, args.districts, args.output, args.worldpop if args.worldpop.is_file() else None, args.official,
                   args.elevation_mode, args.floor_height, args.year, pois=args.pois if args.pois.is_file() else None)
    print(json.dumps({"ok": True, "elevation_mode": report["method"]["elevation_mode"], "districts": report["districts"],
                      "cities": {c: {"assigned": s["assigned"], "outside_boundaries": s["outside_boundaries"], "calibration": s["calibration"]["source"] if s["calibration"] else None}
                                 for c, s in report["cities"].items()}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
