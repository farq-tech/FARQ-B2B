"""Build deliberately fictional data for the Atlas read-only test service.

Names, coordinates, and records are synthetic.  No phone, email, website,
WhatsApp identity, or production identifier is generated.
"""
from __future__ import annotations

import csv
import json
import shutil
import sys
from pathlib import Path

import duckdb


TARGET_COLUMNS = [
    "poi_key", "name_ar", "name_en", "legal_name", "brand_name", "category", "category_ar",
    "secondary_category", "category_l3", "google_category", "city_en", "city_ar", "region_en",
    "region_ar", "district_ar", "district_en", "district_reliable", "street_ar", "latitude",
    "longitude", "location_precision", "phone_norm", "phone_kind", "has_whatsapp", "email",
    "website", "instagram", "working_hours", "rating", "sources", "source_count", "completeness_pct",
    "is_wholesale", "company_status", "lifecycle_state", "commercial_license", "specialty_ids",
    "role_badges", "specialty_concepts_ar",
]


def copy_parquet(db: duckdb.DuckDBPyConnection, path: Path, table: str, columns: list[str], rows: list[tuple], types: dict[str, str] | None = None):
    types = types or {}
    db.execute("create table " + table + " (" + ", ".join(f'c{i} {types.get(name, "varchar")}' for i, name in enumerate(columns)) + ")")
    db.executemany("insert into " + table + " values (" + ", ".join("?" for _ in columns) + ")", rows)
    projection = ", ".join(f'c{i} as "{name}"' for i, name in enumerate(columns))
    db.execute("copy (select " + projection + " from " + table + ") to ? (format parquet)", [str(path)])


def target(key: str, name: str, district: str, street: str, lat: float, lon: float, sub: str, category: str):
    return (
        key, name, None, name, name, "Construction", category, category, sub, "construction",
        "Riyadh", "الرياض", "Riyadh", "الرياض", district, district, True, street, lat, lon, "point",
        None, None, False, None, None, None, None, 4.2, "synthetic_fixture", 1, 78.0, False,
        "open", "active", None, "", "service", category,
    )


def main(dest: str):
    out = Path(dest)
    if out.exists():
        shutil.rmtree(out)
    (out / "taxonomy").mkdir(parents=True)
    db = duckdb.connect()
    contractors = [
        target(f"test-contract-{i:02d}", f"منشأة اختبار مقاولات {i:02d}", "العليا" if i <= 8 else "السلي", "شارع الاختبار", 24.700 + i * .001, 46.675 + i * .001, "build.contracting", "مقاولات وخدمات إنشائية")
        for i in range(1, 17)
    ]
    materials = [
        target(f"test-material-{i:02d}", f"منشأة اختبار مواد بناء {i:02d}", "العليا", "طريق النموذج", 24.730 + i * .001, 46.700 + i * .001, "build.materials", "مواد بناء وتشطيب")
        for i in range(1, 7)
    ]
    copy_parquet(db, out / "targets.parquet", "targets", TARGET_COLUMNS, contractors + materials, {
        "district_reliable": "boolean", "latitude": "double", "longitude": "double", "has_whatsapp": "boolean",
        "rating": "double", "source_count": "integer", "completeness_pct": "double", "is_wholesale": "boolean",
    })
    copy_parquet(
        db, out / "poi_taxonomy.parquet", "taxonomy", ["poi_key", "sub_id", "confidence"],
        [(r[0], r[8], "high") for r in contractors + materials],
    )
    density_rows = [
        ("Riyadh", "build", "البناء والتشييد", "build.contracting", "مقاولات", "شارع الاختبار", "العليا", 8, 0, 800, 1.0, 2.4, json.dumps({"type": "LineString", "coordinates": [[46.674, 24.699], [46.686, 24.711]]})),
        ("Riyadh", "build", "البناء والتشييد", "build.contracting", "مقاولات", "شارع الاختبار", "السلي", 8, 0, 760, 1.1, 2.1, json.dumps({"type": "LineString", "coordinates": [[46.684, 24.709], [46.696, 24.721]]})),
    ]
    copy_parquet(db, out / "street_density.parquet", "density", ["city_en", "main_id", "main_ar", "sub_id", "sub_ar", "street_ar", "district_ar", "n", "n_wholesale", "length_m", "per_100m", "lift", "geojson"], density_rows, {"n":"integer", "n_wholesale":"integer", "length_m":"double", "per_100m":"double", "lift":"double"})
    clusters = [("street", "شارع الاختبار", "build.contracting", "مقاولات", "العليا", "شارع الاختبار", 8, 0, 0.0, 2.4, 24.705, 46.680)]
    copy_parquet(db, out / "trade_clusters.parquet", "clusters", ["level", "label_ar", "sub_id", "sub_ar", "district_ar", "street_ar", "n", "n_wholesale", "wholesale_pct", "lift", "lat", "lon"], clusters, {"n":"integer", "n_wholesale":"integer", "wholesale_pct":"double", "lift":"double", "lat":"double", "lon":"double"})
    polygons = []
    for ident, name, coords in [
        ("test-olaya", "العليا", [[46.670,24.695],[46.690,24.695],[46.690,24.715],[46.670,24.715],[46.670,24.695]]),
        ("test-sulay", "السلي", [[46.680,24.705],[46.700,24.705],[46.700,24.725],[46.680,24.725],[46.680,24.705]]),
    ]:
        polygons.append({"type":"Feature","id":ident,"properties":{"id":ident,"district_ar":name,"city_en":"Riyadh"},"geometry":{"type":"Polygon","coordinates":[coords]}})
    (out / "districts.geojson").write_text(json.dumps({"type":"FeatureCollection","features":polygons}, ensure_ascii=False), encoding="utf-8")
    taxonomy = {"subs": [
        {"sub_id":"build.contracting", "main_id":"build", "main_ar":"البناء والتشييد", "sub_ar":"مقاولات وخدمات إنشائية", "sub_en":"Contracting", "match_hints":"مقاولات|مقاول|contracting|contractor", "commercial":True, "roles":"service"},
        {"sub_id":"build.materials", "main_id":"build", "main_ar":"البناء والتشييد", "sub_ar":"مواد بناء وتشطيب", "sub_en":"Building materials", "match_hints":"مواد بناء|تشطيب", "commercial":True, "roles":"retail"},
    ]}
    (out / "taxonomy" / "farq_taxonomy.json").write_text(json.dumps(taxonomy, ensure_ascii=False), encoding="utf-8")
    with (out / "taxonomy" / "product_families.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["family_id","family_ar","family_en","examples_ar","examples_en"])
        writer.writeheader(); writer.writerow({"family_id":"construction_services","family_ar":"خدمات مقاولات","family_en":"contracting","examples_ar":"مقاولات","examples_en":"contractor"})
    with (out / "taxonomy" / "sub_family_relations.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["relation","family_id","sub_id","strength"])
        writer.writeheader(); writer.writerow({"relation":"sells","family_id":"construction_services","sub_id":"build.contracting","strength":"core"}); writer.writerow({"relation":"buys","family_id":"construction_services","sub_id":"build.contracting","strength":"core"})
    db.close()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data")
