"""Normalize the Farq building shapefile into a verified Parquet layer.

Runs on the existing Farq Targeting service and its persistent volume. The
source shapefile remains unchanged. Raw vendor fields are retained (except the
source machine's local filesystem path), while bilingual use labels map to a
small Farq building-use vocabulary.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import re
import struct
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import shapefile


DEFAULT_DATA_DIR = Path(os.environ.get("TARGETING_DATA_DIR", "/app/data"))
LAYER_CITIES = {
    "даммам": "Dammam",
    "мека": "Makkah",
    "мекка": "Makkah",
    "рияд": "Riyadh",
    "медина": "Madinah",
    "джидда": "Jeddah",
    "хобар": "Khobar",
    "таиф": "Taif",
}
CITY_ALIASES = {
    "الرياض": "Riyadh", "riyadh": "Riyadh", "даммам": "Dammam", "الدمام": "Dammam", "dammam": "Dammam",
    "الخبر": "Khobar", "khobar": "Khobar", "الظهران": "Dhahran", "dhahran": "Dhahran",
    "مكة": "Makkah", "مكة المكرمة": "Makkah", "مكه": "Makkah", "makkah": "Makkah", "mecca": "Makkah", "мека": "Makkah", "мекка": "Makkah",
    "المدينة": "Madinah", "المدينة المنورة": "Madinah", "المدينه المنوره": "Madinah", "madinah": "Madinah", "medina": "Madinah", "медина": "Madinah",
    "جدة": "Jeddah", "جده": "Jeddah", "jeddah": "Jeddah", "джидда": "Jeddah",
    "الطائف": "Taif", "الطايف": "Taif", "taif": "Taif", "таиф": "Taif",
    "الجبيل": "Jubail", "jubail": "Jubail", "ينبع": "Yanbu", "yanbu": "Yanbu",
}

USE_LABELS = {
    "residential": "سكني",
    "commercial": "تجاري",
    "mixed_use": "مختلط",
    "industrial": "صناعي",
    "administrative": "إداري",
    "public_service": "خدمة عامة",
    "utility": "مرفق خدمي",
    "other": "أخرى",
    "unknown": "غير مصنف",
}


def norm(value: object) -> str:
    text = str(value or "").strip().casefold()
    text = re.sub(r"[\u064b-\u065f\u0670\u0640]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def classify(value: object) -> str:
    text = norm(value)
    if not text:
        return "unknown"
    if any(token in text for token in ("mixed use", "mixed-use", "مختلط")):
        return "mixed_use"
    if any(token in text for token in ("industrial", "factory", "warehouse", "workshop", "صناعي", "مصنع", "مستودع", "ورشة")):
        return "industrial"
    if any(token in text for token in ("residential", "residental", "villa", "house", "apartment", "سكن", "منزل", "المنازل", "فيلا", "شقة")):
        return "residential"
    if any(token in text for token in ("commercial", "retail", "shop", "store", "تجاري", "محل", "تسوق")):
        return "commercial"
    if any(token in text for token in ("administrative", "office", "إداري", "اداري", "مكاتب")):
        return "administrative"
    if any(token in text for token in ("school", "hospital", "clinic", "mosque", "مدرسة", "مستشفى", "عيادة", "مسجد")):
        return "public_service"
    if any(token in text for token in ("utility", "مرفق", "خدمي")):
        return "utility"
    if text in {"facility", "منشأة", "مرفق", "прочее", "прочие", "other"}:
        return "other"
    return "unknown"


def building_use(type_value: object, purpose_value: object) -> tuple[str, str]:
    """Prefer a specific purpose; fall back to source type without guessing."""
    for label, value in (("purpose", purpose_value), ("type", type_value)):
        use = classify(value)
        if use != "unknown":
            return use, label
    return "unknown", "unclassified"


def polygon_wkb(shape: shapefile.Shape) -> bytes | None:
    if not shape.points or not shape.parts:
        return None
    parts = list(shape.parts) + [len(shape.points)]
    out = bytearray(struct.pack("<BI", 1, 3))
    out.extend(struct.pack("<I", len(shape.parts)))
    for i in range(len(shape.parts)):
        points = shape.points[parts[i]:parts[i + 1]]
        out.extend(struct.pack("<I", len(points)))
        for x, y in points:
            out.extend(struct.pack("<dd", x, y))
    return bytes(out)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(source: Path, output_dir: Path) -> dict:
    source = source.expanduser().resolve()
    output_dir = output_dir.expanduser().resolve()
    shp = source / "Buildings.shp" if source.is_dir() else source.with_suffix(".shp")
    dbf = shp.with_suffix(".dbf")
    shx = shp.with_suffix(".shx")
    prj = shp.with_suffix(".prj")
    cpg = shp.with_suffix(".cpg")
    for required in (shp, dbf, shx, prj):
        if not required.is_file() or required.stat().st_size == 0:
            raise ValueError(f"missing or empty shapefile component: {required.name}")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise ValueError("output directory is not empty")
    output_dir.mkdir(parents=True, exist_ok=True)
    encoding = cpg.read_text(encoding="ascii", errors="ignore").strip() if cpg.exists() else "utf-8"
    reader = shapefile.Reader(str(shp), encoding=encoding or "utf-8")
    fields = [field[0] for field in reader.fields[1:]]
    expected = {"Type", "Purpose", "HouseId", "District", "City", "Street", "Elevation", "Entrances", "Apartments"}
    missing_fields = sorted(expected - set(fields))
    if missing_fields:
        raise ValueError("building source is missing required fields: " + ", ".join(missing_fields))

    # Retain every useful source attribute and geometry; omit only vendor-local path.
    output_fields = [name for name in fields if name.casefold() != "path"]
    output_fields += ["source_feature_id", "building_use", "classification_basis", "building_use_ar", "city_en", "geometry_wkb_hex"]
    temp_csv = output_dir / "buildings.normalized.csv.gz"
    out_parquet = output_dir / "buildings.parquet"
    counts = Counter()
    raw_types = Counter()
    raw_purposes = Counter()
    city_counts = Counter()
    null_house_ids = 0
    duplicate_house_ids = 0
    seen_house_ids: set[str] = set()
    null_geometry = 0
    row_count = 0
    city_field = next((f for f in fields if f.casefold() == "city"), None)
    layer_field = next((f for f in fields if f.casefold() == "layer"), None)
    type_field = next((f for f in fields if f.casefold() == "type"), None)
    purpose_field = next((f for f in fields if f.casefold() == "purpose"), None)
    house_field = next((f for f in fields if f.casefold() == "houseid"), None)

    with gzip.open(temp_csv, "wt", encoding="utf-8", newline="", compresslevel=6) as stream:
        writer = csv.DictWriter(stream, fieldnames=output_fields, extrasaction="ignore")
        writer.writeheader()
        for row_count, item in enumerate(reader.iterShapeRecords(), start=1):
            record = item.record.as_dict()
            shape = item.shape
            raw_type = record.get(type_field) if type_field else ""
            raw_purpose = record.get(purpose_field) if purpose_field else ""
            use, basis = building_use(raw_type, raw_purpose)
            city = str(record.get(city_field) or "").strip() if city_field else ""
            layer = str(record.get(layer_field) or "").strip() if layer_field else ""
            city_en = CITY_ALIASES.get(norm(city), city) if city else LAYER_CITIES.get(norm(layer), "")
            house_id = str(record.get(house_field) or "").strip() if house_field else ""
            if not house_id:
                null_house_ids += 1
            elif house_id in seen_house_ids:
                duplicate_house_ids += 1
            else:
                seen_house_ids.add(house_id)
            geometry = polygon_wkb(shape)
            if geometry is None:
                null_geometry += 1
            output = {name: record.get(name) for name in output_fields if name in record and name.casefold() != "path"}
            output.update({
                "source_feature_id": row_count,
                "building_use": use,
                "classification_basis": basis,
                "building_use_ar": USE_LABELS[use],
                "city_en": city_en,
                "geometry_wkb_hex": geometry.hex() if geometry else "",
            })
            writer.writerow(output)
            counts[use] += 1
            raw_types[str(raw_type or "(empty)")] += 1
            raw_purposes[str(raw_purpose or "(empty)")] += 1
            city_counts[city_en or "(unmapped)"] += 1
    reader.close()

    db = duckdb.connect()
    try:
        # The gzip CSV is a server-side streaming bridge; the final retained asset is Parquet.
        output_sql_path = str(out_parquet).replace("'", "''")
        db.execute(f"COPY (SELECT * FROM read_csv_auto(?, header=true, all_varchar=true)) TO '{output_sql_path}' (FORMAT PARQUET, COMPRESSION ZSTD)", [str(temp_csv)])
        parquet_rows = db.execute("SELECT count(*) FROM read_parquet(?)", [str(out_parquet)]).fetchone()[0]
        parquet_cols = [row[0] for row in db.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(out_parquet)]).fetchall()]
        bad_ids = db.execute("SELECT count(*) FROM read_parquet(?) WHERE source_feature_id IS NULL OR houseid IS NULL", [str(out_parquet)]).fetchone()[0]
        bad_geometry_hex = db.execute("SELECT count(*) FROM read_parquet(?) WHERE geometry_wkb_hex IS NULL OR geometry_wkb_hex = ''", [str(out_parquet)]).fetchone()[0]
    finally:
        db.close()
        temp_csv.unlink(missing_ok=True)

    report = {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": {"name": "Lenovo PS8S/GIS_UNIQUE/shapefiles/Buildings", "encoding": encoding, "features": row_count,
                   "source_sha256": {p.name: sha256(p) for p in (shp, shx, dbf, prj) if p.exists()}},
        "output": {"file": out_parquet.name, "rows": int(parquet_rows), "columns": parquet_cols, "bytes": out_parquet.stat().st_size},
        "validation": {"source_output_count_matches": row_count == parquet_rows, "missing_required_fields": missing_fields,
                       "null_geometry_source_rows": null_geometry, "null_or_duplicate_house_ids": null_house_ids + duplicate_house_ids,
                       "parquet_rows_missing_key_or_feature_id": int(bad_ids), "parquet_rows_missing_geometry": int(bad_geometry_hex)},
        "classification": {"counts": dict(counts), "labels_ar": USE_LABELS,
                           "raw_types": dict(raw_types), "raw_purposes": dict(raw_purposes),
                           "unclassified": counts["unknown"]},
        "cities": dict(city_counts),
    }
    (output_dir / "buildings.validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not report["validation"]["source_output_count_matches"] or bad_ids or bad_geometry_hex:
        raise ValueError("normalized buildings failed count, identity, or geometry validation; see buildings.validation.json")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize and validate the Buildings shapefile on the Farq server")
    parser.add_argument("--source", type=Path, default=DEFAULT_DATA_DIR / "buildings_ingest/source")
    parser.add_argument("--output", type=Path, default=DEFAULT_DATA_DIR / "buildings_ingest/normalized")
    args = parser.parse_args()
    report = normalize(args.source, args.output)
    print(json.dumps({"ok": True, "rows": report["output"]["rows"], "size_bytes": report["output"]["bytes"],
                      "classified": report["classification"]["counts"], "validation": report["validation"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
