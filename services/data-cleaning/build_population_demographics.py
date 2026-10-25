#!/usr/bin/env python3
"""Aggregate WorldPop 2025 age/sex grids to Atlas district IDs on the data server.

The GeoTIFFs stay in the server's population staging directory. Only modeled
district-level aggregates are emitted for the authenticated Targeting API.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path

LIBS = os.environ.get("FARQ_AUDIT_LIBS", "/tmp/farq-audit-libs")
if LIBS and LIBS not in sys.path:
    sys.path.insert(0, LIBS)

import duckdb
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.mask import mask

DATA_DIR = Path(os.environ.get("FARQ_DATA_DIR", "/app/data"))
POP_DIR = DATA_DIR / "buildings_ingest" / "population"
RASTER_DIR = POP_DIR / "agesex_2025"
DISTRICTS = DATA_DIR / "districts.geojson"
OUTPUT = POP_DIR / "district_demographics_2025.parquet"
REPORT = POP_DIR / "district_demographics_2025_report.json"
AGE_CODES = ("00", "01", *(f"{age:02d}" for age in range(5, 90, 5)), "90")
AGE_LABELS = {
    "00": "0-1",
    "01": "1-4",
    **{f"{age:02d}": f"{age}-{age + 4}" for age in range(5, 90, 5)},
    "90": "90+",
}
FILE_RE = re.compile(r"^sau_([fmt])_(\d{2})_2025_CN_100m_R2025A_v1\.tif$")
TOTAL_FILES = {
    "female": "sau_T_F_2025_CN_100m_R2025A_v1.tif",
    "male": "sau_T_M_2025_CN_100m_R2025A_v1.tif",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sum_polygon(src: rasterio.io.DatasetReader, geometry: dict) -> tuple[float | None, int, int]:
    try:
        data, transform = mask(src, [geometry], crop=True, filled=False, all_touched=False)
    except ValueError:
        return None, 0, 0
    band = data[0]
    inside = geometry_mask(
        [geometry], out_shape=band.shape, transform=transform,
        invert=True, all_touched=False,
    )
    valid = inside & ~np.ma.getmaskarray(band)
    count = int(valid.sum())
    if not count:
        return None, 0, int(inside.sum())
    values = np.asarray(band.data, dtype=np.float64)
    return float(values[valid].sum(dtype=np.float64)), count, int(inside.sum())


def main() -> None:
    if not DISTRICTS.is_file():
        raise SystemExit(f"Missing district boundaries: {DISTRICTS}")
    if not RASTER_DIR.is_dir():
        raise SystemExit(f"Missing staged age/sex rasters: {RASTER_DIR}")
    POP_DIR.mkdir(parents=True, exist_ok=True)

    rasters: dict[tuple[str, str], Path] = {}
    for path in RASTER_DIR.glob("*.tif"):
        match = FILE_RE.fullmatch(path.name)
        if not match:
            continue
        sex, age = match.groups()
        if age not in AGE_LABELS:
            continue
        key = (sex, age)
        if key in rasters:
            raise ValueError(f"Duplicate source raster for {key}: {path.name}")
        rasters[key] = path

    required = {(sex, age) for sex in "fmt" for age in AGE_CODES}
    missing = sorted(required - rasters.keys())
    if missing:
        raise SystemExit(f"Incomplete source set ({len(missing)} missing): {missing[:12]}")
    total_rasters = {sex: RASTER_DIR / name for sex, name in TOTAL_FILES.items()}
    missing_totals = [str(path) for path in total_rasters.values() if not path.is_file()]
    if missing_totals:
        raise SystemExit(f"Missing all-age sex totals: {missing_totals}")

    collection = json.loads(DISTRICTS.read_text(encoding="utf-8"))
    features = [
        feature for feature in collection.get("features", [])
        if feature.get("geometry", {}).get("type") in {"Polygon", "MultiPolygon"}
        and (feature.get("properties") or {}).get("id") is not None
    ]
    ids = [feature["properties"]["id"] for feature in features]
    if len(ids) != len(set(ids)):
        raise ValueError("District feature IDs are not unique")

    rows: list[dict[str, object]] = []
    age_sex_sums: dict[str, dict[str, float]] = {
        str(feature["properties"]["id"]): {"male": 0.0, "female": 0.0}
        for feature in features
    }
    raster_checksums: dict[str, str] = {}
    reference_grid: tuple[int, int, object] | None = None
    for path in total_rasters.values():
        raster_checksums[path.name] = sha256(path)
    for age in AGE_CODES:
        sources = {sex: rasters[(sex, age)] for sex in "fmt"}
        for sex, path in sources.items():
            raster_checksums[path.name] = sha256(path)
        with rasterio.open(sources["t"]) as total_src, \
             rasterio.open(sources["m"]) as male_src, \
             rasterio.open(sources["f"]) as female_src:
            for src in (total_src, male_src, female_src):
                if str(src.crs) != "EPSG:4326" or src.count != 1:
                    raise ValueError(f"Unexpected raster metadata: {src.name}")
            if (total_src.width, total_src.height, total_src.transform) != (
                male_src.width, male_src.height, male_src.transform
            ) or (total_src.width, total_src.height, total_src.transform) != (
                female_src.width, female_src.height, female_src.transform
            ):
                raise ValueError(f"Age/sex grid alignment mismatch for age {age}")
            if age == AGE_CODES[0]:
                reference_grid = (total_src.width, total_src.height, total_src.transform)

            for feature in features:
                props = feature["properties"]
                geometry = feature["geometry"]
                total, valid_cells, polygon_cells = sum_polygon(total_src, geometry)
                male, _, _ = sum_polygon(male_src, geometry)
                female, _, _ = sum_polygon(female_src, geometry)
                district_sums = age_sex_sums[str(props["id"])]
                if male is not None:
                    district_sums["male"] += male
                if female is not None:
                    district_sums["female"] += female
                rows.append({
                    "district_id": props["id"],
                    "district_ar": props.get("ar"),
                    "district_en": props.get("en"),
                    "city_ar": props.get("city_ar"),
                    "city_en": props.get("city_en"),
                    "age_code": age,
                    "age_group": AGE_LABELS[age],
                    "male_estimate": male,
                    "female_estimate": female,
                    "total_estimate": total,
                    "valid_cells": valid_cells,
                    "polygon_cells": polygon_cells,
                    "coverage_pct": round(valid_cells * 100.0 / polygon_cells, 4) if polygon_cells else None,
                    "population_year": 2025,
                    "population_source": "worldpop_sau_agesex_2025_CN_100m_R2025A_v1",
                    "population_license": "CC-BY-4.0",
                })

    # The source also provides all-age male/female grids. Preserve these
    # totals as a separate ALL row; consumers must exclude it when summing age
    # bands. This is useful for reconciliation with the age-band partitions.
    all_age_grid_sums = {"male": 0.0, "female": 0.0}
    max_district_abs_pct_diff = {"male": 0.0, "female": 0.0}
    with rasterio.open(total_rasters["male"]) as male_src, rasterio.open(total_rasters["female"]) as female_src:
        for src in (male_src, female_src):
            if str(src.crs) != "EPSG:4326" or src.count != 1:
                raise ValueError(f"Unexpected all-age raster metadata: {src.name}")
        if (male_src.width, male_src.height, male_src.transform) != (female_src.width, female_src.height, female_src.transform):
            raise ValueError("All-age male/female raster alignment mismatch")
        if reference_grid != (male_src.width, male_src.height, male_src.transform):
            raise ValueError("All-age rasters do not align with age-band grids")
        for feature in features:
            props = feature["properties"]
            male, male_valid, male_cells = sum_polygon(male_src, feature["geometry"])
            female, female_valid, female_cells = sum_polygon(female_src, feature["geometry"])
            band_sums = age_sex_sums[str(props["id"])]
            for sex, grid_total in (("male", male), ("female", female)):
                if grid_total is not None:
                    all_age_grid_sums[sex] += grid_total
                    difference = abs(grid_total - band_sums[sex])
                    relative_pct = 100.0 * difference / max(abs(grid_total), 1.0)
                    max_district_abs_pct_diff[sex] = max(max_district_abs_pct_diff[sex], relative_pct)
            valid_cells = min(male_valid, female_valid)
            polygon_cells = max(male_cells, female_cells)
            rows.append({
                "district_id": props["id"],
                "district_ar": props.get("ar"),
                "district_en": props.get("en"),
                "city_ar": props.get("city_ar"),
                "city_en": props.get("city_en"),
                "age_code": "ALL",
                "age_group": "جميع الأعمار",
                "male_estimate": male,
                "female_estimate": female,
                "total_estimate": male + female if male is not None and female is not None else None,
                "valid_cells": valid_cells,
                "polygon_cells": polygon_cells,
                "coverage_pct": round(valid_cells * 100.0 / polygon_cells, 4) if polygon_cells else None,
                "population_year": 2025,
                "population_source": "worldpop_sau_agesex_2025_CN_100m_R2025A_v1",
                "population_license": "CC-BY-4.0",
            })

    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", suffix=".json", dir=POP_DIR, delete=False
    ) as stream:
        staging_json = Path(stream.name)
        json.dump(rows, stream, ensure_ascii=False, allow_nan=False)

    staging_parquet = OUTPUT.with_suffix(".parquet.tmp")
    try:
        db = duckdb.connect()
        db.execute("SET threads=4")
        db.execute("SET memory_limit='2GB'")
        db.execute(
            f"COPY (SELECT * FROM read_json_auto(?)) TO '{staging_parquet}' "
            "(FORMAT PARQUET, COMPRESSION ZSTD)", [str(staging_json)]
        )
        result = db.execute(
            "SELECT count(*), count(*) FILTER (WHERE total_estimate IS NOT NULL), "
            "count(*) FILTER (WHERE coverage_pct < 50), "
            "sum(total_estimate) FILTER (WHERE age_code <> 'ALL') "
            "FROM read_parquet(?)", [str(staging_parquet)]
        ).fetchone()
        db.close()
        os.replace(staging_parquet, OUTPUT)
    finally:
        staging_json.unlink(missing_ok=True)
        staging_parquet.unlink(missing_ok=True)

    metadata = {
        "source_files": len(raster_checksums),
        "source_sha256": raster_checksums,
        "source_year": 2025,
        "source_crs": "EPSG:4326",
        "source_resolution": "3 arc-seconds (~100 m at equator)",
        "source_units": "estimated people per grid cell",
        "source_release": "WorldPop R2025A v1",
        "source_license": "CC-BY-4.0",
        "source_attribution": "WorldPop, University of Southampton; DOI:10.5258/SOTON/WP00841",
        "district_source": DISTRICTS.name,
        "row_count": int(result[0]),
        "rows_with_total_estimates": int(result[1]),
        "rows_with_under_50pct_raster_coverage": int(result[2]),
        "sum_of_age_band_estimates": float(result[3] or 0),
        "all_age_grid_sums": all_age_grid_sums,
        "age_band_sums_by_sex": {
            sex: sum(values[sex] for values in age_sex_sums.values())
            for sex in ("male", "female")
        },
        "all_age_to_age_band_max_district_difference_pct": max_district_abs_pct_diff,
        "output_file": OUTPUT.name,
        "age_groups": {"ALL": "جميع الأعمار", **AGE_LABELS},
        "all_age_totals_are_separate": True,
        "interpretation": (
            "Modeled resident population estimates by district, sex, and age band; "
            "not person-level census records, observed customers, or employment status."
        ),
    }
    REPORT.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == "__main__":
    main()
