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
    "identity/source_to_farq_atlas_id.parquet",
)
TARGET_COLUMNS = {"poi_key", "farq_atlas_id", "latitude", "longitude", "city_en", "district_ar"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_count(db: duckdb.DuckDBPyConnection, path: Path, sql: str, *params: Any) -> int:
    return int(db.execute(sql, [str(path), *params]).fetchone()[0])


def _release_id(assets: dict[str, dict[str, Any]]) -> str:
    """Return a deterministic identifier for the exact immutable asset set."""
    canonical = json.dumps(assets, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


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
    district_ids = []
    unlabeled_districts = 0
    for feature in features:
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        name = props.get("ar") or props.get("name_ar") or props.get("district_ar") or props.get("name")
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if props.get("id") is None or not isinstance(geometry, dict):
            raise ValueError("districts GeoJSON contains a feature without a stable id or geometry")
        district_ids.append(str(props["id"]))
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
        else:
            # Keep valid official polygons whose source has an ID but no label;
            # clients can still join data by ID and omit the unavailable label.
            unlabeled_districts += 1
    duplicate_district_ids = len(district_ids) - len(set(district_ids))
    if duplicate_district_ids:
        raise ValueError("districts GeoJSON contains duplicate stable ids")
    duplicate_district_labels = len(names) - len(set(names))

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
               where (latitude is not null and (latitude < -90 or latitude > 90))
                  or (longitude is not null and (longitude < -180 or longitude > 180))""",
        )
        if rows == 0 or null_keys or distinct_keys != rows:
            raise ValueError("targets parquet has empty or duplicate poi_key values")
        if invalid_coordinates:
            raise ValueError("targets parquet contains invalid coordinates")
        unique_farq_ids = _safe_count(db, target_path, "select count(distinct farq_atlas_id) from read_parquet(?) where farq_atlas_id is not null and trim(farq_atlas_id) <> ''")
        invalid_farq_ids = _safe_count(db, target_path, "select count(*) from read_parquet(?) where farq_atlas_id is null or trim(farq_atlas_id) = ''")
        if invalid_farq_ids or unique_farq_ids != rows:
            raise ValueError("targets parquet has empty or duplicate Farq Atlas IDs")

        identity_path = data_dir / "identity/source_to_farq_atlas_id.parquet"
        identity_columns = {row[0] for row in db.execute("describe select * from read_parquet(?)", [str(identity_path)]).fetchall()}
        identity_missing = sorted({"source_poi_key", "canonical_poi_key", "farq_atlas_id"} - identity_columns)
        if identity_missing:
            raise ValueError(f"identity crosswalk misses columns: {', '.join(identity_missing)}")
        identity_rows = _safe_count(db, identity_path, "select count(*) from read_parquet(?)")
        identity_unique_sources = _safe_count(db, identity_path, "select count(distinct source_poi_key) from read_parquet(?) where source_poi_key is not null and trim(source_poi_key) <> ''")
        identity_invalid_rows = _safe_count(db, identity_path, "select count(*) from read_parquet(?) where source_poi_key is null or trim(source_poi_key) = '' or canonical_poi_key is null or trim(canonical_poi_key) = '' or farq_atlas_id is null or trim(farq_atlas_id) = ''")
        if identity_invalid_rows or identity_rows == 0 or identity_unique_sources != identity_rows:
            raise ValueError("identity crosswalk has empty or duplicate source keys")
        identity_orphans = int(db.execute(
            """select count(*) from read_parquet(?) identity
               left join read_parquet(?) target on target.poi_key=identity.canonical_poi_key
               where target.poi_key is null or target.farq_atlas_id<>identity.farq_atlas_id""",
            [str(identity_path), str(target_path)],
        ).fetchone()[0])
        if identity_orphans:
            raise ValueError("identity crosswalk does not resolve to matching canonical Farq Atlas IDs")
        missing_canonical_aliases = int(db.execute(
            """select count(*) from read_parquet(?) target
               anti join read_parquet(?) identity on identity.source_poi_key=target.poi_key""",
            [str(target_path), str(identity_path)],
        ).fetchone()[0])
        if missing_canonical_aliases:
            raise ValueError("identity crosswalk omits canonical target keys")

        poi_taxonomy_path = data_dir / "poi_taxonomy.parquet"
        taxonomy_columns = {row[0] for row in db.execute("describe select * from read_parquet(?)", [str(poi_taxonomy_path)]).fetchall()}
        taxonomy_missing_columns = sorted({"poi_key", "sub_id"} - taxonomy_columns)
        if taxonomy_missing_columns:
            raise ValueError(f"poi taxonomy misses required columns: {', '.join(taxonomy_missing_columns)}")
        taxonomy_rows = _safe_count(db, poi_taxonomy_path, "select count(*) from read_parquet(?)")
        if taxonomy_rows == 0:
            raise ValueError("poi taxonomy parquet is empty")
        taxonomy_distinct_keys = _safe_count(
            db,
            poi_taxonomy_path,
            "select count(distinct poi_key) from read_parquet(?) where poi_key is not null and trim(poi_key) <> ''",
        )
        taxonomy_invalid_keys = _safe_count(
            db,
            poi_taxonomy_path,
            "select count(*) from read_parquet(?) where poi_key is null or trim(poi_key) = ''",
        )
        if taxonomy_invalid_keys or taxonomy_distinct_keys != taxonomy_rows:
            raise ValueError("poi taxonomy has empty or duplicate poi_key values")
        unknown_subcategories = _safe_count(
            db,
            poi_taxonomy_path,
            "select count(*) from read_parquet(?) where sub_id is null or trim(sub_id) = '' or sub_id not in (select * from unnest(?))",
            list(sub_ids),
        )
        if unknown_subcategories:
            raise ValueError("poi taxonomy contains unknown subcategory ids")
        orphan_taxonomy_rows = int(
            db.execute(
                """select count(*) from read_parquet(?) taxonomy
                   left join read_parquet(?) target using (poi_key)
                   where target.poi_key is null""",
                [str(poi_taxonomy_path), str(target_path)],
            ).fetchone()[0]
        )
        if orphan_taxonomy_rows:
            raise ValueError("poi taxonomy contains poi_key values absent from targets")
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
        "release_id": _release_id(assets),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "assets": assets,
        "targets": {
            "rows": rows,
            "distinct_poi_keys": distinct_keys,
            "distinct_farq_atlas_ids": unique_farq_ids,
            "precise_point_rows": point_rows,
            "columns": sorted(columns),
        },
        "poi_taxonomy": {"rows": taxonomy_rows, "distinct_poi_keys": taxonomy_distinct_keys},
        "identity": {"crosswalk_rows": identity_rows, "distinct_source_poi_keys": identity_unique_sources, "aliases": identity_rows - rows},
        "districts": {"features": len(features), "labels": len(names), "unlabeled_with_stable_id": unlabeled_districts, "duplicate_labels": duplicate_district_labels},
        "taxonomy": {"subcategories": len(sub_ids)},
    }


def verify_manifest(report: dict[str, Any], manifest_path: Path) -> None:
    """Reject a staged release whose immutable inputs differ from an approved manifest."""
    try:
        expected = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("invalid release manifest") from error
    if expected.get("schema_version") != report.get("schema_version"):
        raise ValueError("release manifest schema version mismatch")
    if expected.get("release_id") != report.get("release_id"):
        raise ValueError("release manifest identifier mismatch")
    expected_assets = expected.get("assets")
    if not isinstance(expected_assets, dict):
        raise ValueError("release manifest has no assets")
    for name, actual in report["assets"].items():
        candidate = expected_assets.get(name)
        if not isinstance(candidate, dict) or candidate.get("sha256") != actual["sha256"] or candidate.get("bytes") != actual["bytes"]:
            raise ValueError(f"release manifest mismatch for {name}")
    if expected.get("targets", {}).get("rows") != report["targets"]["rows"]:
        raise ValueError("release manifest target-row count mismatch")
    if expected.get("districts", {}).get("features") != report["districts"]["features"]:
        raise ValueError("release manifest district-count mismatch")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an immutable Atlas targeting data release")
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--write-manifest", type=Path, help="write the verified-input manifest JSON to this path")
    parser.add_argument("--verify-manifest", type=Path, help="require the data assets to exactly match this approved manifest")
    args = parser.parse_args()
    try:
        report = validate_release(args.data_dir)
        if args.verify_manifest:
            verify_manifest(report, args.verify_manifest)
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
