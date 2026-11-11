"""Add missing city district polygons from the pinned National Address dataset.

The source dataset publisher declares CC0-1.0 for the data and attributes its
upstream to homaily/Saudi-Arabia-Regions-Cities-and-Districts, whose repository lists
GPL-2.0. That provenance needs review before a production release. Keep the
source fields on every imported polygon. Inputs and output belong in the
external targeting data volume, never in Git.

Usage:
  python3 import_national_address_districts.py \
    --base /data/current/districts.geojson \
    --output /data/review/districts.geojson
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
import os
import tempfile
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

import shapely
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

from canonical_data import canonical_city, canonical_districts, cross_city_duplicates, district_key, load_corrections


SOURCE_REPOSITORY = "https://github.com/yasseralsamman/saudi-national-address"
SOURCE_COMMIT = "deedf8ce8afa6eabe1abd0b7b8ec1ada7dddddf4"
SOURCE_BASE = f"https://raw.githubusercontent.com/yasseralsamman/saudi-national-address/{SOURCE_COMMIT}/data/dist"
SOURCE_FILES = {
    "districts.geojson": "0fd6b791e3147702a805c858e4bdc44de929a7e8ccdee8d1af7a524417823e0d",
    "cities.csv": "fdb6899c5371f1385e2c2e7385ef4c8f298ea2cb6d29214ed408c856ce1acd28",
}
EXISTING_ATLAS_CITIES = {
    "Riyadh", "Jeddah", "Makkah Al Mukarramah", "Al Madinah Al Munawwarah", "Dammam", "Al Khobar",
}
SOURCE_LICENSE = "CC0-1.0 declared by publisher; upstream lists GPL-2.0, verify rights before release"
SAUDI_BOUNDS = (33.0, 16.0, 57.0, 33.5)  # west, south, east, north; catches coordinate reversal.


def _download_verified(name: str, destination: Path) -> Path:
    url = f"{SOURCE_BASE}/{name}"
    request = urllib.request.Request(url, headers={"User-Agent": "FarqAtlas-district-import/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    if digest != SOURCE_FILES[name]:
        destination.unlink(missing_ok=True)
        raise ValueError(f"source checksum changed for {name}")
    return destination


def _polygonal(geometry: Any) -> Polygon | MultiPolygon | None:
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    if isinstance(geometry, GeometryCollection):
        parts = [part for part in geometry.geoms if isinstance(part, (Polygon, MultiPolygon))]
        if parts:
            merged = unary_union(parts)
            return merged if isinstance(merged, (Polygon, MultiPolygon)) else None
    return None


def _repair_geometry(geojson_geometry: dict[str, Any]) -> tuple[dict[str, Any] | None, bool]:
    try:
        geometry = shape(geojson_geometry)
        repaired = not geometry.is_valid
        if repaired:
            geometry = shapely.make_valid(geometry)
        geometry = _polygonal(geometry)
        if geometry is None or geometry.is_empty:
            return None, repaired
        if not geometry.is_valid:
            geometry = shapely.make_valid(geometry)
            geometry = _polygonal(geometry)
        if geometry is None or geometry.is_empty or not geometry.is_valid:
            return None, True
        west, south, east, north = geometry.bounds
        if not (SAUDI_BOUNDS[0] <= west <= east <= SAUDI_BOUNDS[2]
                and SAUDI_BOUNDS[1] <= south <= north <= SAUDI_BOUNDS[3]):
            return None, repaired
        return mapping(geometry), repaired
    except (TypeError, ValueError, KeyError):
        return None, False


def repair_existing_geometries(
    collection: dict[str, Any], max_relative_area_change: float = 0.005,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Repair invalid outlines only when make_valid changes their area by at most 0.5%."""
    repaired_collection = copy.deepcopy(collection)
    repaired_ids: list[str] = []
    skipped_unrepairable: list[str] = []
    skipped_large_area_change: list[dict[str, Any]] = []
    for feature in repaired_collection.get("features", []):
        raw_geometry = feature.get("geometry")
        if not raw_geometry:
            continue
        ident = str((feature.get("properties") or {}).get("id", feature.get("id", "")))
        try:
            before = shape(raw_geometry)
            if before.is_valid:
                continue
            repaired_geometry, _ = _repair_geometry(raw_geometry)
            if repaired_geometry is None:
                skipped_unrepairable.append(ident)
                continue
            after = shape(repaired_geometry)
            if before.area <= 0:
                skipped_large_area_change.append({"id": ident, "relative_area_change": None})
                continue
            relative_change = abs(after.area - before.area) / before.area
            if relative_change > max_relative_area_change:
                skipped_large_area_change.append({
                    "id": ident,
                    "relative_area_change": round(relative_change, 8),
                })
                continue
            feature["geometry"] = repaired_geometry
            repaired_ids.append(ident)
        except (TypeError, ValueError, KeyError):
            skipped_unrepairable.append(ident)
    return repaired_collection, {
        "repaired_count": len(repaired_ids),
        "repaired_ids": repaired_ids,
        "skipped_unrepairable_ids": skipped_unrepairable,
        "skipped_large_area_change": skipped_large_area_change,
        "max_relative_area_change": max_relative_area_change,
    }


def repair_invalid_geometries_from_source(
    collection: dict[str, Any], source: dict[str, Any], city_rows: list[dict[str, str]],
    min_overlap_ratio: float = 0.95,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Replace an invalid atlas outline only with one valid, same-city, same-name source match."""
    repaired = copy.deepcopy(collection)
    cities = {str(row["city_id"]): row for row in city_rows}
    source_by_key: dict[tuple[str, str], list[tuple[str, Any]]] = {}
    for feature in source.get("features", []):
        props = feature.get("properties") or {}
        city_row = cities.get(str(props.get("city_id")))
        raw_name = props.get("name_ar")
        if not city_row or not isinstance(raw_name, str) or not raw_name.strip():
            continue
        city = canonical_city(city_row.get("name_en", ""))
        if not city:
            continue
        try:
            original = shape(feature.get("geometry") or {})
            if not original.is_valid:
                continue
            geometry, _ = _repair_geometry(feature.get("geometry") or {})
            if geometry is None:
                continue
            source_id = str(props.get("district_id", ""))
            key_name = district_key(raw_name[3:] if raw_name.startswith("حي ") else raw_name)
            source_by_key.setdefault((city[0], key_name), []).append((source_id, shape(geometry)))
        except (TypeError, ValueError, KeyError):
            continue

    replaced: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for feature in repaired.get("features", []):
        props = feature.get("properties")
        raw_geometry = feature.get("geometry")
        if not isinstance(props, dict) or not raw_geometry:
            continue
        try:
            existing_shape = shape(raw_geometry)
            if existing_shape.is_valid:
                continue
        except (TypeError, ValueError, KeyError):
            existing_shape = None
        city = canonical_city(props.get("city_en", ""))
        name = props.get("ar") or props.get("district_ar") or ""
        if not city or not isinstance(name, str) or not name.strip() or existing_shape is None:
            skipped.append({"id": str(props.get("id", "")), "reason": "invalid_identity_or_geometry"})
            continue
        try:
            repaired_shape = _polygonal(shapely.make_valid(existing_shape))
        except (TypeError, ValueError, KeyError):
            repaired_shape = None
        if repaired_shape is None or repaired_shape.is_empty:
            skipped.append({"id": str(props.get("id", "")), "reason": "unrepairable_geometry"})
            continue
        key_name = district_key(name[3:] if name.startswith("حي ") else name)
        candidates = []
        for source_id, source_shape in source_by_key.get((city[0], key_name), []):
            smaller_area = min(repaired_shape.area, source_shape.area)
            if smaller_area <= 0:
                continue
            try:
                ratio = repaired_shape.intersection(source_shape).area / smaller_area
            except (TypeError, ValueError):
                continue
            if ratio >= min_overlap_ratio:
                candidates.append((ratio, source_id, source_shape))
        if len(candidates) != 1:
            skipped.append({
                "id": str(props.get("id", "")),
                "reason": "no_unique_source_match" if not candidates else "multiple_source_matches",
            })
            continue
        ratio, source_id, source_shape = candidates[0]
        feature["geometry"] = mapping(source_shape)
        props["geometry_source"] = "Saudi National Address district dataset"
        props["geometry_source_district_id"] = source_id
        props["geometry_source_commit"] = SOURCE_COMMIT
        props["geometry_source_license"] = SOURCE_LICENSE
        replaced.append({
            "id": str(props.get("id", "")),
            "city_en": city[0],
            "district_ar": name,
            "source_district_id": source_id,
            "overlap_ratio": round(ratio, 6),
        })
    return repaired, {
        "replaced_count": len(replaced),
        "replaced": replaced,
        "skipped": skipped,
        "minimum_overlap_ratio": min_overlap_ratio,
    }


def supplement_missing_city_districts(
    source: dict[str, Any], city_rows: list[dict[str, str]], base: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Keep reviewed primary-city outlines and fill missing district IDs in other cities."""
    cities = {str(row["city_id"]): row for row in city_rows}
    existing_ids = {
        str(props["id"])
        for feature in base.get("features", [])
        if isinstance((props := feature.get("properties")), dict) and props.get("id") is not None
    }
    base_features_by_id: dict[str, list[dict[str, Any]]] = {}
    for feature in base.get("features", []):
        props = feature.get("properties")
        if isinstance(props, dict) and props.get("id") is not None:
            base_features_by_id.setdefault(str(props["id"]), []).append(feature)

    # Releases can carry a source polygon under an older or malformed city label.
    # Exact source ID + geometry is stronger evidence of coverage than that label;
    # recognize it before deciding a city needs importing.
    source_covered_cities: set[str] = set()
    source_boundary_matches = 0
    for feature in source.get("features", []):
        props = feature.get("properties") or {}
        source_id = props.get("district_id")
        city_row = cities.get(str(props.get("city_id")))
        if source_id is None or city_row is None:
            continue
        city = canonical_city(city_row.get("name_en", ""))
        if city is None:
            continue
        for base_feature in base_features_by_id.get(str(source_id), []):
            if base_feature.get("geometry") == feature.get("geometry"):
                source_covered_cities.add(city[0])
                source_boundary_matches += 1
                break
    canonical_base, _ = canonical_districts(base, load_corrections())
    base_boundaries = []
    for feature in canonical_base.get("features", []):
        props = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not props.get("city_en") or not geometry:
            continue
        try:
            base_boundaries.append((props["city_en"], district_key(props.get("ar") or props.get("district_ar") or ""), shape(geometry)))
        except (TypeError, ValueError):
            continue
    report: Counter[str] = Counter()
    imported: list[dict[str, Any]] = []
    ids: set[str] = set()
    skipped_unknown_cities: set[str] = set()
    overlap_conflicts: list[dict[str, Any]] = []

    for feature in source.get("features", []):
        source_props = feature.get("properties") or {}
        source_id = source_props.get("district_id")
        city_row = cities.get(str(source_props.get("city_id")))
        if source_id is None or city_row is None:
            report["skipped_missing_identity"] += 1
            continue
        city = canonical_city(city_row.get("name_en", ""))
        if city is None:
            skipped_unknown_cities.add(city_row.get("name_en", ""))
            report["skipped_unmapped_city"] += 1
            continue
        city_en, city_ar = city
        # The primary atlas cities keep their reviewed source outlines. For cities added from this source,
        # however, a matching polygon only proves that one ID is present; do not suppress missing IDs city-wide.
        if city_en in EXISTING_ATLAS_CITIES:
            report["skipped_city_already_in_atlas"] += 1
            continue

        ident = str(source_id)
        if ident in ids:
            raise ValueError(f"district id collision: {ident}")
        raw_name = source_props.get("name_ar")
        name_en = source_props.get("name_en")
        if not isinstance(raw_name, str) or not raw_name.strip() or not isinstance(name_en, str) or not name_en.strip():
            report["skipped_missing_name"] += 1
            continue
        geometry, repaired = _repair_geometry(feature.get("geometry") or {})
        if repaired:
            report["repaired_geometry"] += 1
        if geometry is None:
            report["skipped_invalid_or_out_of_bounds_geometry"] += 1
            continue
        source_shape = shape(geometry)
        if ident in existing_ids:
            source_id_duplicate = False
            for base_feature in base_features_by_id.get(ident, []):
                base_geometry = base_feature.get("geometry")
                try:
                    candidate_shape = shape(base_geometry) if base_geometry else None
                    smaller_area = min(source_shape.area, candidate_shape.area) if candidate_shape else 0
                    overlap_ratio = source_shape.intersection(candidate_shape).area / smaller_area if smaller_area > 0 else 0
                except (TypeError, ValueError):
                    overlap_ratio = 0
                if overlap_ratio >= 0.97:
                    source_id_duplicate = True
                    break
            if source_id_duplicate:
                report["skipped_duplicate_source_id"] += 1
                continue
            raise ValueError(f"district id collision with different geometry: {ident}")
        # canonical_districts removes the common Arabic prefix «حي » from atlas names.
        # Apply the same rule here so source spelling alone cannot defeat deduplication.
        source_name_key = district_key(raw_name[3:] if raw_name.startswith("حي ") else raw_name)
        duplicate = False
        conflict = None
        for base_city, base_name_key, base_shape in base_boundaries:
            smaller_area = min(source_shape.area, base_shape.area)
            if smaller_area <= 0:
                continue
            overlap_ratio = source_shape.intersection(base_shape).area / smaller_area
            if overlap_ratio < 0.97:
                continue
            if base_city == city_en and base_name_key == source_name_key:
                duplicate = True
                break
            if base_city != city_en:
                conflict = {
                    "source_city": city_en,
                    "source_id": ident,
                    "source_name_ar": raw_name,
                    "overlap_city": base_city,
                    "overlap_ratio": round(overlap_ratio, 6),
                }
                break
        if duplicate:
            report["skipped_duplicate_canonical_boundary"] += 1
            continue
        if conflict:
            report["skipped_ambiguous_cross_city_overlap"] += 1
            overlap_conflicts.append(conflict)
            continue

        props = {
            "id": source_id,
            "ar": raw_name,
            "en": name_en,
            "city_en": city_en,
            "city_ar": city_ar,
            "source": "Saudi National Address district dataset",
            "source_license": SOURCE_LICENSE,
            "source_repository": SOURCE_REPOSITORY,
            "source_commit": SOURCE_COMMIT,
            "source_district_id": source_id,
            "source_city_id": city_row["city_id"],
            "source_city_en": city_row.get("name_en"),
            "source_city_ar": city_row.get("name_ar"),
        }
        imported.append({"type": "Feature", "id": source_id, "properties": props, "geometry": geometry})
        ids.add(ident)
        report["imported"] += 1

    report_data: dict[str, Any] = dict(report)
    report_data["cities"] = dict(sorted(Counter(f["properties"]["city_en"] for f in imported).items()))
    report_data["source_boundary_matches_existing"] = source_boundary_matches
    report_data["source_cities_with_matching_boundaries"] = sorted(source_covered_cities)
    report_data["unmapped_city_names"] = sorted(name for name in skipped_unknown_cities if name)
    report_data["overlap_conflicts"] = overlap_conflicts
    return imported, report_data


def introduced_cross_city_overlaps(base: dict[str, Any], candidate: dict[str, Any]) -> list[list[str]]:
    """Report substantial cross-city overlaps introduced by this supplement, after reviewed district corrections."""
    corrections = load_corrections()
    base_canonical, _ = canonical_districts(base, corrections)
    candidate_canonical, _ = canonical_districts(candidate, corrections)

    def keys(collection: dict[str, Any]) -> dict[tuple[tuple[str, str], tuple[str, str]], list[str]]:
        out = {}
        for city_a, id_a, city_b, id_b in cross_city_duplicates(collection):
            members = tuple(sorted(((str(city_a), str(id_a)), (str(city_b), str(id_b)))) )
            out[members] = [city_a, id_a, city_b, id_b]
        return out

    base_pairs = keys(base_canonical)
    candidate_pairs = keys(candidate_canonical)
    return [candidate_pairs[key] for key in sorted(candidate_pairs.keys() - base_pairs.keys())]


def build_candidate(source_path: Path, city_path: Path, base_path: Path, output_path: Path) -> dict[str, Any]:
    source = json.loads(source_path.read_text(encoding="utf-8"))
    base = json.loads(base_path.read_text(encoding="utf-8"))
    with city_path.open(encoding="utf-8-sig", newline="") as handle:
        city_rows = list(csv.DictReader(handle))
    additions, report = supplement_missing_city_districts(source, city_rows, base)
    merged = {"type": "FeatureCollection", "features": [*base.get("features", []), *additions]}
    merged, geometry_repairs = repair_existing_geometries(merged)
    merged, source_geometry_repairs = repair_invalid_geometries_from_source(merged, source, city_rows)
    source_repaired_ids = {item["id"] for item in source_geometry_repairs["replaced"]}
    if source_repaired_ids:
        geometry_repairs["repaired_ids"] = sorted(set(geometry_repairs["repaired_ids"]) | source_repaired_ids)
        geometry_repairs["repaired_count"] = len(geometry_repairs["repaired_ids"])
        geometry_repairs["skipped_large_area_change"] = [
            item for item in geometry_repairs["skipped_large_area_change"]
            if item["id"] not in source_repaired_ids
        ]
    report["geometry_repairs"] = geometry_repairs
    report["source_geometry_repairs"] = source_geometry_repairs
    report["new_cross_city_overlaps"] = introduced_cross_city_overlaps(base, merged)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_path.parent, delete=False) as handle:
        json.dump(merged, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, output_path)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, type=Path, help="Current districts.geojson from the external data release")
    parser.add_argument("--output", required=True, type=Path, help="New candidate atlas path outside Git")
    args = parser.parse_args()
    if not args.base.is_file():
        raise SystemExit("--base must point to the current district atlas")
    if args.base.resolve() == args.output.resolve():
        raise SystemExit("--output must differ from --base; the source release is never overwritten")
    with tempfile.TemporaryDirectory(prefix="farq-national-districts-") as temporary:
        directory = Path(temporary)
        district_source = _download_verified("districts.geojson", directory / "districts.geojson")
        city_source = _download_verified("cities.csv", directory / "cities.csv")
        report = build_candidate(district_source, city_source, args.base, args.output)
    report.update({"source_commit": SOURCE_COMMIT, "source_repository": SOURCE_REPOSITORY,
                   "source_license": SOURCE_LICENSE, "output": str(args.output)})
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
