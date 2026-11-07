# -*- coding: utf-8 -*-
"""Conservative Farq-subcategory fill from the curated Google-category map (FREE).

Many POIs carry a Google category string (``google_category`` is filled for
~58k POIs) but land in a *weak* Farq bucket: a low-confidence classification, the
uncertain main ``unc.*``, or a generic ``*_general`` placeholder. This module
uses a **user-provided curated mapping** (Google ``category_en`` -> Farq
subcategory, extracted from a Notion export — NOT Apify, no paid source) to
propose a more specific subcategory for *exactly those* weak POIs.

It is a **fill-only candidate**, never a replacement:

  * A POI that already has a *confident* Farq category (``cls_confidence`` in
    {high, medium} AND a specific ``sub_id`` that is neither ``unc.*`` nor
    ``*_general``) is **never** overridden — المستخدم أولاً: we do not move a
    good label.
  * A weak POI whose Google category is **unknown** to the curated map gains
    nothing — we never guess; it stays «غير متاح» as before.
  * The emitted ``sub_from_google`` is the curated map's label vocabulary, which
    is *not* the Atlas taxonomy ``sub_id`` space (see ``category_from_google.md``
    for the validation counts). It therefore feeds the live classification layer
    as a candidate signal; it is not written straight onto ``sub_id``.

Resolution per POI (first hit wins):
  1. first ``|``-token of ``google_category``   -> curated map  => source ``google_category``
  2. first ``|``-token of ``google_categories`` -> curated map  => source ``google_categories_first``

Outputs a *delta* parquet of only the rows that gain a subcategory, columns
``[poi_key, sub_from_google, category_source]``.

Run directly to (re)build the delta:
    python build_category_from_google.py [--base <targets.parquet>] \\
        [--map <google_category_map.csv>] [--out <category_from_google.parquet>] \\
        [--taxonomy <farq_taxonomy.json>]
"""

from __future__ import annotations

import csv
import re
from typing import Dict, Optional, Tuple

# --- weak-bucket guard --------------------------------------------------------

#: cls_confidence values treated as NOT confident (fill-eligible).
WEAK_CONFIDENCE = {"low"}

#: A sub_id in the uncertain main, or a generic placeholder, is fill-eligible.
_UNC_PREFIX = "unc."
_GENERIC_SUFFIX = "_general"


def is_weak_category(cls_confidence: Optional[str], sub_id: Optional[str]) -> bool:
    """True when the existing Farq category is low-confidence or a placeholder.

    Weak == the classifier said ``low``, OR the POI sits in the uncertain main
    ``unc.*``, OR in a generic ``*_general`` bucket. Everything else (a specific
    sub_id with high/medium confidence) is confident and must not be touched.
    """
    conf = (cls_confidence or "").strip().lower()
    sid = (sub_id or "").strip().lower()
    if conf in WEAK_CONFIDENCE:
        return True
    if sid.startswith(_UNC_PREFIX):
        return True
    if sid.endswith(_GENERIC_SUFFIX):
        return True
    return False


# --- curated-map lookup -------------------------------------------------------


def map_key(value: Optional[str]) -> Optional[str]:
    """Normalise a Google category into the curated map's key space.

    The Google strings can be pipe-delimited (``"Seafood restaurant|Restaurant"``);
    the curated map keys on a single category, so we take the first token and
    fold case/whitespace. Returns ``None`` for an empty/blank value.
    """
    if value is None:
        return None
    first = re.split(r"\|", value, maxsplit=1)[0]
    key = first.strip().lower()
    return key or None


def load_map(csv_path: str) -> Dict[str, str]:
    """Load the curated ``category_en -> farq_subcategory`` map.

    Keys are normalised with :func:`map_key`. Duplicate rows for a key are
    collapsed deterministically (``min`` of the subcategory label); conflicting
    values are therefore resolved stably rather than fanning a POI out into
    several delta rows.
    """
    best: Dict[str, str] = {}
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = map_key(row.get("category_en"))
            sub = (row.get("farq_subcategory") or "").strip()
            if not key or not sub:
                continue
            if key not in best or sub < best[key]:
                best[key] = sub
    return best


def resolve_sub(
    google_category: Optional[str],
    google_categories: Optional[str],
    cat_map: Dict[str, str],
) -> Tuple[Optional[str], Optional[str]]:
    """Map a POI's Google category through the curated map.

    Returns ``(sub_from_google, category_source)`` or ``(None, None)`` when
    neither the primary nor the fallback Google category is known to the map.
    """
    primary = map_key(google_category)
    if primary and primary in cat_map:
        return cat_map[primary], "google_category"
    fallback = map_key(google_categories)
    if fallback and fallback in cat_map:
        return cat_map[fallback], "google_categories_first"
    return None, None


def decide(
    google_category: Optional[str],
    google_categories: Optional[str],
    cls_confidence: Optional[str],
    sub_id: Optional[str],
    cat_map: Dict[str, str],
) -> Tuple[Optional[str], Optional[str]]:
    """Full fill-only decision for one POI.

    A subcategory is proposed **only** when the existing category is weak
    (:func:`is_weak_category`) *and* the Google category resolves through the
    curated map. A confident POI, or an unmapped Google category, yields
    ``(None, None)`` and is left exactly as it was.
    """
    if not is_weak_category(cls_confidence, sub_id):
        return None, None
    return resolve_sub(google_category, google_categories, cat_map)


# --- taxonomy validation (reporting only) -------------------------------------


def _norm_tax(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def taxonomy_sub_names(taxonomy_path: str) -> set:
    """Set of normalised ``sub_en`` names in the Atlas taxonomy (for validation)."""
    import json

    tax = json.load(open(taxonomy_path, encoding="utf-8"))
    return {_norm_tax(s.get("sub_en", "")) for s in tax.get("subs", [])}


def validates_against_taxonomy(sub_label: str, tax_names: set) -> bool:
    """True if a curated label matches an Atlas ``sub_en`` (case/punct, plural-insensitive)."""
    n = _norm_tax(sub_label)
    if n in tax_names:
        return True
    sing = n[:-1] if n.endswith("s") else n
    return sing in {t[:-1] if t.endswith("s") else t for t in tax_names}


# --- delta build (duckdb) -----------------------------------------------------


def build(
    targets_path: str,
    map_path: str,
    out_path: str,
    memory_limit: str = "8GB",
    threads: int = 6,
    temp_directory: Optional[str] = None,
):
    """Build the fill-only delta parquet ``[poi_key, sub_from_google, category_source]``.

    The SQL mirrors the Python :func:`decide` rules exactly: the ``is_weak``
    guard, the first-``|``-token normalisation, and the google_category ->
    google_categories fallback.
    """
    import duckdb

    cat_map = load_map(map_path)  # deterministic, deduped
    con = duckdb.connect()
    con.execute(f"PRAGMA memory_limit='{memory_limit}'")
    con.execute(f"PRAGMA threads={threads}")
    if temp_directory:
        con.execute(f"SET temp_directory='{temp_directory}'")

    # Curated map -> a temp table (one row per key).
    con.execute("CREATE TEMP TABLE cmap(k VARCHAR, sub VARCHAR)")
    con.executemany("INSERT INTO cmap VALUES (?, ?)", list(cat_map.items()))

    weak_sql = (
        "(lower(trim(coalesce(cls_confidence,''))) IN ('low') "
        "OR lower(trim(coalesce(sub_id,''))) LIKE 'unc.%' "
        "OR lower(trim(coalesce(sub_id,''))) LIKE '%\\_general' ESCAPE '\\')"
    )
    con.execute(
        f"""
        COPY (
          WITH base AS (
            SELECT poi_key,
              nullif(lower(trim(split_part(coalesce(google_category,''),'|',1))),'')   AS gc1,
              nullif(lower(trim(split_part(coalesce(google_categories,''),'|',1))),'') AS gcs1,
              {weak_sql} AS is_weak
            FROM read_parquet('{targets_path}')
            WHERE (google_category IS NOT NULL AND trim(google_category) <> '')
               OR (google_categories IS NOT NULL AND trim(google_categories) <> '')
          )
          SELECT b.poi_key,
                 coalesce(mc.sub, mf.sub) AS sub_from_google,
                 CASE WHEN mc.sub IS NOT NULL THEN 'google_category'
                      WHEN mf.sub IS NOT NULL THEN 'google_categories_first'
                 END AS category_source
          FROM base b
          LEFT JOIN cmap mc ON b.gc1 = mc.k
          LEFT JOIN cmap mf ON b.gcs1 = mf.k
          WHERE b.is_weak AND coalesce(mc.sub, mf.sub) IS NOT NULL
        ) TO '{out_path}' (FORMAT PARQUET)
        """
    )
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out_path}')").fetchone()[0]
    con.close()
    return n


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Build the conservative Google-category -> Farq subcategory fill delta."
    )
    ap.add_argument(
        "--base",
        default="/Volumes/farq/release_build/atlas-2026-11-02-v8-unified/targets.parquet",
    )
    ap.add_argument(
        "--map",
        default="/private/tmp/claude-501/-Users-m4pro-FARQ-B2B/"
        "4d8ec590-15eb-4dfe-b0a1-9b98dc411188/scratchpad/v10/deltas/google_category_map.csv",
    )
    ap.add_argument(
        "--out",
        default="/private/tmp/claude-501/-Users-m4pro-FARQ-B2B/"
        "4d8ec590-15eb-4dfe-b0a1-9b98dc411188/scratchpad/v10/deltas/category_from_google.parquet",
    )
    ap.add_argument(
        "--taxonomy",
        default="/Volumes/farq/release_build/atlas-2026-11-02-v8-unified/taxonomy/farq_taxonomy.json",
    )
    ap.add_argument("--temp-directory", default="/Volumes/farq/_duckdb_tmp")
    args = ap.parse_args()

    n = build(args.base, args.map, args.out, temp_directory=args.temp_directory)
    print(f"wrote {n} delta rows -> {args.out}")
