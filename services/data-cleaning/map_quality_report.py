#!/usr/bin/env python3
"""Report map-location coverage from the targeting directory without emitting POI records.

The output contains only aggregate counts by city and classified subcategory. It never
prints names, addresses, identifiers, contact details, or coordinates.

Example:
  python3 services/data-cleaning/map_quality_report.py \
    /path/to/targets.parquet /path/to/poi_taxonomy.parquet \
    --taxonomy-json /path/to/farq_taxonomy.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_subcategory_names(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(row["sub_id"]): str(row.get("sub_ar") or row["sub_id"]) for row in data.get("subs", [])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets", type=Path, help="Target directory Parquet file")
    parser.add_argument("poi_taxonomy", type=Path, help="POI taxonomy Parquet file")
    parser.add_argument("--taxonomy-json", type=Path, help="Taxonomy JSON used to label subcategories")
    parser.add_argument("--min-city-size", type=int, default=10000)
    parser.add_argument("--min-category-size", type=int, default=1000)
    parser.add_argument("--top", type=int, default=20)
    args = parser.parse_args()
    if args.min_city_size < 1 or args.min_category_size < 1 or args.top < 1:
        parser.error("--min-city-size, --min-category-size, and --top must be positive")
    for path in (args.targets, args.poi_taxonomy, args.taxonomy_json):
        if path is not None and not path.is_file():
            parser.error(f"file not found: {path}")

    try:
        import duckdb
    except ImportError:
        print("Install the existing DuckDB dependency before running this report.", file=sys.stderr)
        return 2

    db = duckdb.connect()
    target = str(args.targets.resolve())
    taxonomy = str(args.poi_taxonomy.resolve())
    names = load_subcategory_names(args.taxonomy_json)
    precise = "coalesce(location_precision, 'point') = 'point' and latitude between -85.05112878 and 85.05112878 and longitude >= -180 and longitude < 180"
    precise_t = "coalesce(t.location_precision, 'point') = 'point' and t.latitude between -85.05112878 and 85.05112878 and t.longitude >= -180 and t.longitude < 180"

    summary = db.execute(
        f"""select count(*) as rows,
                   count(distinct poi_key) as unique_keys,
                   count(*) filter (where latitude is not null and longitude is not null) as coordinate_pairs,
                   count(*) filter (where {precise}) as map_eligible,
                   count(*) filter (where not ({precise})) as map_hidden,
                   count(*) filter (where latitude is not null and longitude is not null
                     and (latitude < -85.05112878 or latitude > 85.05112878 or longitude < -180 or longitude >= 180)) as invalid_coordinates,
                   count(*) filter (where district_reliable is true) as reliable_district,
                   count(*) filter (where district_reliable is false) as unreliable_district,
                   count(*) filter (where district_reliable is null) as unknown_district_reliability,
                   count(*) filter (where surveyor_verified_at is not null) as with_surveyor_timestamp
            from read_parquet(?)""",
        [target],
    ).fetchone()

    city_rows = db.execute(
        f"""select coalesce(city_en, 'غير محددة') as city,
                   count(*) as total,
                   count(*) filter (where {precise}) as map_eligible,
                   count(*) filter (where not ({precise})) as map_hidden,
                   round(100.0 * count(*) filter (where not ({precise})) / count(*), 1) as hidden_pct
            from read_parquet(?)
            group by 1
            having count(*) >= ?
            order by map_hidden desc, total desc
            limit ?""",
        [target, args.min_city_size, args.top],
    ).fetchall()

    category_rows = db.execute(
        f"""select p.sub_id,
                   count(distinct t.poi_key) as total,
                   count(distinct t.poi_key) filter (where not ({precise_t})) as map_hidden,
                   round(100.0 * count(distinct t.poi_key) filter (where not ({precise_t})) / count(distinct t.poi_key), 1) as hidden_pct
            from read_parquet(?) t
            join read_parquet(?) p using (poi_key)
            where p.confidence in ('high', 'medium')
            group by p.sub_id
            having count(distinct t.poi_key) >= ?
            order by map_hidden desc, total desc
            limit ?""",
        [target, taxonomy, args.min_category_size, args.top],
    ).fetchall()

    classified = db.execute(
        f"""select count(distinct t.poi_key),
                   count(distinct t.poi_key) filter (where not ({precise_t}))
            from read_parquet(?) t
            join read_parquet(?) p using (poi_key)
            where p.confidence in ('high', 'medium')""",
        [target, taxonomy],
    ).fetchone()
    rows, unique_keys, coordinate_pairs, map_eligible, map_hidden, invalid_coordinates, reliable_district, unreliable_district, unknown_district_reliability, with_surveyor_timestamp = summary
    output = {
        "source_files": {"targets": args.targets.name, "poi_taxonomy": args.poi_taxonomy.name},
        "summary": {
            "rows": rows,
            "unique_keys": unique_keys,
            "duplicate_keys": rows - unique_keys,
            "coordinate_pairs": coordinate_pairs,
            "map_eligible": map_eligible,
            "map_hidden": map_hidden,
            "map_hidden_pct": round(100 * map_hidden / rows, 1) if rows else 0,
            "invalid_coordinates": invalid_coordinates,
            "district_reliable": reliable_district,
            "district_unreliable": unreliable_district,
            "district_reliability_unknown": unknown_district_reliability,
            "with_surveyor_timestamp": with_surveyor_timestamp,
        },
        "classified_high_medium": {
            "rows": classified[0],
            "map_hidden": classified[1],
            "map_hidden_pct": round(100 * classified[1] / classified[0], 1) if classified[0] else 0,
        },
        "largest_city_gaps": [
            {"city": city, "total": total, "map_eligible": eligible, "map_hidden": hidden, "map_hidden_pct": pct}
            for city, total, eligible, hidden, pct in city_rows
        ],
        "largest_classified_subcategory_gaps": [
            {"subcategory": names.get(sub_id, sub_id), "total": total, "map_hidden": hidden, "map_hidden_pct": pct}
            for sub_id, total, hidden, pct in category_rows
        ],
        "privacy": "Aggregate counts only; no POI names, addresses, keys, contact details, or coordinates are emitted.",
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
