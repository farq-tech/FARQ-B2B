#!/usr/bin/env python3
"""Build district-level 2025 WorldPop counts on the Farq data volume.

This job is intentionally server-side. It reads the staged GeoTIFF and Atlas
district polygons, then writes a small, auditable district enrichment layer.
Population values stay separate from business records and are joined by the
district identifier in the Atlas API.
"""
from __future__ import annotations

import hashlib
import json
import os
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
RASTER = POP_DIR / "sau_pop_2025_CN_100m_R2025A_v1.tif"
DISTRICTS = DATA_DIR / "districts.geojson"
OUTPUT = POP_DIR / "district_population_2025.parquet"
REPORT = POP_DIR / "district_population_2025_report.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    if not RASTER.is_file() or not DISTRICTS.is_file():
        raise SystemExit(f"Missing source: {RASTER if not RASTER.is_file() else DISTRICTS}")

    collection = json.loads(DISTRICTS.read_text(encoding="utf-8"))
    rows: list[dict[str, object]] = []
    with rasterio.open(RASTER) as src:
        if str(src.crs) != "EPSG:4326":
            raise ValueError(f"Expected EPSG:4326 raster, got {src.crs}")
        if src.count != 1:
            raise ValueError(f"Expected one raster band, got {src.count}")

        for feature in collection.get("features", []):
            geometry = feature.get("geometry")
            properties = feature.get("properties") or {}
            if not geometry or geometry.get("type") not in {
                "Polygon",
                "MultiPolygon",
            }:
                continue
            district_id = properties.get("id")
            if district_id is None:
                continue

            try:
                raster, transform = mask(
                    src,
                    [geometry],
                    crop=True,
                    filled=False,
                    all_touched=False,
                )
            except ValueError:
                # The district is outside the raster bounds; preserve it with
                # explicit null population rather than silently dropping it.
                rows.append(
                    {
                        "district_id": district_id,
                        "district_ar": properties.get("ar"),
                        "district_en": properties.get("en"),
                        "city_ar": properties.get("city_ar"),
                        "city_en": properties.get("city_en"),
                        "population_estimate": None,
                        "population_valid_cells": 0,
                        "population_polygon_cells": 0,
                        "population_coverage_pct": None,
                        "population_year": 2025,
                        "population_source": "worldpop_sau_pop_2025_CN_100m_R2025A_v1",
                        "population_license": "CC-BY-4.0",
                    }
                )
                continue

            band = raster[0]
            inside = geometry_mask(
                [geometry],
                out_shape=band.shape,
                transform=transform,
                invert=True,
                all_touched=False,
            )
            valid = inside & ~np.ma.getmaskarray(band)
            values = np.asarray(band.data, dtype=np.float64)
            valid_values = values[valid]
            polygon_cells = int(inside.sum())
            valid_cells = int(valid.sum())
            estimate = float(valid_values.sum(dtype=np.float64)) if valid_cells else None
            rows.append(
                {
                    "district_id": district_id,
                    "district_ar": properties.get("ar"),
                    "district_en": properties.get("en"),
                    "city_ar": properties.get("city_ar"),
                    "city_en": properties.get("city_en"),
                    "population_estimate": estimate,
                    "population_valid_cells": valid_cells,
                    "population_polygon_cells": polygon_cells,
                    "population_coverage_pct": (
                        round(valid_cells * 100.0 / polygon_cells, 4)
                        if polygon_cells
                        else None
                    ),
                    "population_year": 2025,
                    "population_source": "worldpop_sau_pop_2025_CN_100m_R2025A_v1",
                    "population_license": "CC-BY-4.0",
                }
            )

    if not rows:
        raise ValueError("No district polygons were eligible for population overlay")
    ids = [row["district_id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("District feature IDs are not unique")

    # Use JSON to preserve Arabic strings and typed nulls without delimiter or
    # locale ambiguity, then let DuckDB produce the serving Parquet.
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
            "(FORMAT PARQUET, COMPRESSION ZSTD)",
            [str(staging_json)],
        )
        result = db.execute(
            "SELECT count(*), count(*) FILTER (WHERE population_estimate IS NOT NULL), "
            "sum(population_estimate), sum(population_valid_cells), "
            "count(*) FILTER (WHERE population_coverage_pct < 50) "
            "FROM read_parquet(?)",
            [str(staging_parquet)],
        ).fetchone()
        db.close()
        os.replace(staging_parquet, OUTPUT)
    finally:
        staging_json.unlink(missing_ok=True)
        staging_parquet.unlink(missing_ok=True)

    metadata = {
        "source_file": RASTER.name,
        "source_sha256": sha256(RASTER),
        "source_bytes": RASTER.stat().st_size,
        "source_year": 2025,
        "source_crs": "EPSG:4326",
        "source_resolution": "3 arc-seconds (~100 m at equator)",
        "source_units": "estimated people per grid cell",
        "source_release": "WorldPop R2025A v1 (alpha release)",
        "source_license": "CC-BY-4.0",
        "source_attribution": (
            "WorldPop, University of Southampton; DOI:10.5258/SOTON/WP00839"
        ),
        "district_source": DISTRICTS.name,
        "row_count": int(result[0]),
        "districts_with_population_values": int(result[1]),
        "sum_of_district_estimates": float(result[2] or 0),
        "sum_of_valid_population_cells": int(result[3] or 0),
        "districts_with_under_50pct_raster_coverage": int(result[4] or 0),
        "output_file": OUTPUT.name,
        "interpretation": (
            "Population estimates are aggregated over district polygon cells. "
            "They are modeled resident counts, not customers, visitors, or demand."
        ),
    }
    REPORT.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == "__main__":
    main()
