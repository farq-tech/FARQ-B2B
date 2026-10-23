"""Validate and fingerprint an immutable Atlas targeting-data release.

This tool is deliberately read-only. Run it in the data build environment before
an approved snapshot is staged for the targeting service. It does not send data,
modify the source assets, or expose directory rows in its report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb


REQUIRED_ASSETS = (
    "targets.parquet",
    "poi_taxonomy.parquet",
    "street_density.parquet",
    "trade_clusters.parquet",
    "districts.geojson",
    "taxonomy/farq_taxonomy.json",
)
TARGET_COLUMNS = {"poi_key", "latitude", "longitude", "city_en", "district_ar"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_count(db: duckdb.DuckDBPyConnection, path: Path, sql: str) -> int:
    return int(db.execute(sql, [str(path)]).fetchone()[0])


def validate_release(data_dir: Path) -> dict[str, Any]:
    """Return a non-sensitive release report; raise ValueError for invalid data."""
    data_dir = data_dir.resolve()
    missing = [name for name in REQUIRED_ASSETS if not (data_dir / name).is_file() or (data_dir / name).stat().st_size == 0]
    if missing:
        raise ValueError(f"missing required assets: {', '.join(missing)}")

    taxonomy_path = data_dir / "taxonomy/farq_taxonomy.json"
    try:
        taxonomy = json.loads(taxonomy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("invalid taxonomy JSON") from error
    sub_ids = {str(item.get("sub_id")) for item in taxonomy.get("subs", []) if item.get("sub_id")}
    if not sub_ids:
        raise ValueError("taxonomy has no subcategory ids")

    district_path = data_dir / "districts.geojson"
    try:
        districts = json.loads(district_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("invalid districts GeoJSON") from error
    features = districts.get("features") if isinstance(districts, dict) else None
    if not isinstance(features, list) or not features:
        raise ValueError("districts GeoJSON has no features")
    names = []
    for feature in features:
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        name = props.get("ar") or props.get("name_ar") or props.get("district_ar") or props.get("name")
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not isinstance(name, str) or not name.strip() or not isinstance(geometry, dict):
            raise ValueError("districts GeoJSON contains an unnamed or geometry-less feature")
        names.append(name.strip())
    duplicate_district_names = len(names) - len(set(names))
    if duplicate_district_names:
        raise ValueError("districts GeoJSON contains duplicate district labels")

    target_path = data_dir / "targets.parquet"
    db = duckdb.connect(":memory:")
    try:
        columns = {row[0] for row in db.execute("describe select * from read_parquet(?)", [str(target_path)]).fetchall()}
        missing_columns = sorted(TARGET_COLUMNS - columns)
        if missing_columns:
            raise ValueError(f"targets parquet misses required columns: {', '.join(missing_columns)}")
        rows = _safe_count(db, target_path, "select count(*) from read_parquet(?)")
        distinct_keys = _safe_count(db, target_path, "select count(distinct poi_key) from read_parquet(?) where poi_key is not null")
        null_keys = _safe_count(db, target_path, "select count(*) from read_parquet(?) where poi_key is null or trim(poi_key) = ''")
        invalid_coordinates = _safe_count(
            db,
            target_path,
            """select count(*) from read_parquet(?)
               where latitude is not null and (latitude < -90 or latitude > 90)
                  or longitude is not null and (longitude < -180 or longitude > 180)""",
        )
        if rows == 0 or null_keys or distinct_keys != rows:
            raise ValueError("targets parquet has empty or duplicate poi_key values")
        if invalid_coordinates:
            raise ValueError("targets parquet contains invalid coordinates")

        taxonomy_rows = _safe_count(db, data_dir / "poi_taxonomy.parquet", "select count(*) from read_parquet(?)")
        if taxonomy_rows == 0:
            raise ValueError("poi taxonomy parquet is empty")
        point_rows = _safe_count(
            db,
            target_path,
            """select count(*) from read_parquet(?)
               where latitude is not null and longitude is not null
                 and coalesce(location_precision, 'point') = 'point'""",
        ) if "location_precision" in columns else _safe_count(
            db, target_path, "select count(*) from read_parquet(?) where latitude is not null and longitude is not null"
        )
    finally:
        db.close()

    assets = {name: {"bytes": (data_dir / name).stat().st_size, "sha256": _sha256(data_dir / name)} for name in REQUIRED_ASSETS}
    return {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "assets": assets,
        "targets": {
            "rows": rows,
            "distinct_poi_keys": distinct_keys,
            "precise_point_rows": point_rows,
            "columns": sorted(columns),
        },
        "poi_taxonomy_rows": taxonomy_rows,
        "districts": {"features": len(features), "labels": len(names)},
        "taxonomy": {"subcategories": len(sub_ids)},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an immutable Atlas targeting data release")
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--write-manifest", type=Path, help="write the verified-input manifest JSON to this path")
    args = parser.parse_args()
    try:
        report = validate_release(args.data_dir)
    except ValueError as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2
    if args.write_manifest:
        args.write_manifest.parent.mkdir(parents=True, exist_ok=True)
        args.write_manifest.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "targets": report["targets"]["rows"], "districts": report["districts"]["features"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
