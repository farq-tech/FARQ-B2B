# -*- coding: utf-8 -*-
"""Conservative Farq-subcategory fill from the curated Urbi-category map (FREE).

~68k POIs carry an Urbi category string (``urbi_category_en``) but a large slice
of them land in a *weak* Farq bucket: a low-confidence classification, the
uncertain main ``unc.*``, or a generic ``*_general`` placeholder. Measured on the
live release ``atlas-2026-11-02-v13-enriched``: **24,872** such weak POIs carry an
Urbi category, and all 24,872 are *also* weak in the served ``poi_taxonomy.parquet``
sidecar — i.e. the user sees «غير مصنّف» for them today. This module uses a
**hand-curated, owner-reviewable mapping** (Urbi ``category_en`` -> a Farq
``sub_id``, in ``reference/urbi_category_map.csv``) to propose a specific
subcategory for *exactly those* weak POIs.

It differs from the Google-category fill in one important way: every mapped value
here is a **real, validated Atlas ``sub_id``** (each entry is checked against
``farq_taxonomy.json`` — 0 invalid at build time), because Urbi's category labels
sit cleanly on the Atlas taxonomy. It is therefore a stronger candidate than the
Google label map, but it is still a **candidate signal**, never a blind write:

  * A POI that already has a *confident* Farq category (``cls_confidence`` in
    {high, medium} AND a specific ``sub_id`` that is neither ``unc.*`` nor
    ``*_general``) is **never** overridden — المستخدم أولاً: we do not move a
    good label.
  * A weak POI whose Urbi category is **unknown** to the curated map gains
    nothing — we never guess; it stays «غير متاح» as before. The map covers the
    high-frequency Urbi categories only (~84% of the weak-Urbi mass); the long
    tail is deliberately left unmapped rather than mapped on a hunch.
  * The emitted ``sub_from_urbi`` feeds the live classification layer
    (``apply_rubricator`` -> ``poi_taxonomy.parquet``) as one more piece of
    evidence; the classification layer, not this delta, decides the served
    ``sub_id`` after weighing it against name/rubricator signals.

Resolution per POI (whole-string match — an Urbi category like
``"Cafe / Restaurants"`` is a single label, the ``/`` is part of it, so we do NOT
split on it):
  1. normalised ``urbi_category_en`` -> curated map  => source ``urbi_category_en``

Outputs a *delta* parquet of only the rows that gain a subcategory, columns
``[poi_key, sub_from_urbi, category_source]``.

Run directly to (re)build the delta:
    python build_category_from_urbi.py [--base <targets.parquet>] \\
        [--map <urbi_category_map.csv>] [--out <category_from_urbi.parquet>] \\
        [--taxonomy <farq_taxonomy.json>]
"""

from __future__ import annotations

import csv
import os
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
    """Normalise an Urbi category into the curated map's key space.

    Unlike the Google map, an Urbi category is a *single whole label*
    (``"Grocery stores / Supermarkets"``); the ``/`` is part of the label, not a
    delimiter, so we keep the full string and only fold case and collapse inner
    whitespace. Returns ``None`` for an empty/blank value.
    """
    if value is None:
        return None
    key = re.sub(r"\s+", " ", value.strip().lower())
    return key or None


def load_map(csv_path: str) -> Dict[str, str]:
    """Load the curated ``category_en -> farq_sub_id`` map.

    Keys are normalised with :func:`map_key`. Duplicate rows for a key are
    collapsed deterministically (``min`` of the sub_id) so a POI never fans out
    into several delta rows.
    """
    best: Dict[str, str] = {}
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = map_key(row.get("category_en"))
            sub = (row.get("farq_sub_id") or "").strip()
            if not key or not sub:
                continue
            if key not in best or sub < best[key]:
                best[key] = sub
    return best


def resolve_sub(
    urbi_category_en: Optional[str],
    cat_map: Dict[str, str],
) -> Tuple[Optional[str], Optional[str]]:
    """Map a POI's Urbi category through the curated map.

    Returns ``(sub_from_urbi, category_source)`` or ``(None, None)`` when the Urbi
    category is empty or unknown to the map.
    """
    primary = map_key(urbi_category_en)
    if primary and primary in cat_map:
        return cat_map[primary], "urbi_category_en"
    return None, None


def decide(
    urbi_category_en: Optional[str],
    cls_confidence: Optional[str],
    sub_id: Optional[str],
    cat_map: Dict[str, str],
) -> Tuple[Optional[str], Optional[str]]:
    """Full fill-only decision for one POI.

    A subcategory is proposed **only** when the existing category is weak
    (:func:`is_weak_category`) *and* the Urbi category resolves through the
    curated map. A confident POI, or an unmapped Urbi category, yields
    ``(None, None)`` and is left exactly as it was.
    """
    if not is_weak_category(cls_confidence, sub_id):
        return None, None
    return resolve_sub(urbi_category_en, cat_map)


# --- taxonomy validation ------------------------------------------------------


def taxonomy_sub_ids(taxonomy_path: str) -> set:
    """Set of valid ``sub_id`` values in the Atlas taxonomy."""
    import json

    tax = json.load(open(taxonomy_path, encoding="utf-8"))
    return {s.get("sub_id", "") for s in tax.get("subs", [])}


def invalid_map_targets(cat_map: Dict[str, str], tax_ids: set) -> list:
    """Curated targets that are NOT valid Atlas sub_ids (should be empty)."""
    return sorted({sub for sub in cat_map.values() if sub not in tax_ids})


# --- delta build (duckdb) -----------------------------------------------------


def build(
    targets_path: str,
    map_path: str,
    out_path: str,
    memory_limit: str = "8GB",
    threads: int = 6,
    temp_directory: Optional[str] = None,
):
    """Build the fill-only delta parquet ``[poi_key, sub_from_urbi, category_source]``.

    The SQL mirrors the Python :func:`decide` rules exactly: the ``is_weak``
    guard and the whole-string (no-split) normalisation of ``urbi_category_en``.
    """
    import duckdb

    cat_map = load_map(map_path)  # deterministic, deduped
    con = duckdb.connect()
    con.execute(f"PRAGMA memory_limit='{memory_limit}'")
    con.execute(f"PRAGMA threads={threads}")
    if temp_directory:
        con.execute(f"SET temp_directory='{temp_directory}'")

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
              nullif(regexp_replace(lower(trim(coalesce(urbi_category_en,''))),'\\s+',' ','g'),'') AS uc,
              {weak_sql} AS is_weak
            FROM read_parquet('{targets_path}')
            WHERE urbi_category_en IS NOT NULL AND trim(urbi_category_en) <> ''
          )
          SELECT b.poi_key,
                 m.sub AS sub_from_urbi,
                 'urbi_category_en' AS category_source
          FROM base b
          JOIN cmap m ON b.uc = m.k
          WHERE b.is_weak
        ) TO '{out_path}' (FORMAT PARQUET)
        """
    )
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out_path}')").fetchone()[0]
    con.close()
    return n


_HERE = os.path.dirname(os.path.abspath(__file__))

if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Build the conservative Urbi-category -> Farq sub_id fill delta."
    )
    ap.add_argument("--base", default="/app/data/releases/atlas-2026-11-02-v13-enriched/targets.parquet")
    ap.add_argument("--map", default=os.path.join(_HERE, "reference", "urbi_category_map.csv"))
    ap.add_argument("--out", default="/tmp/category_from_urbi.parquet")
    ap.add_argument("--taxonomy", default="/app/data/taxonomy/farq_taxonomy.json")
    ap.add_argument("--temp-directory", default=None)
    args = ap.parse_args()

    # fail-closed: refuse to build if any curated target is not a real sub_id.
    if os.path.isfile(args.taxonomy):
        bad = invalid_map_targets(load_map(args.map), taxonomy_sub_ids(args.taxonomy))
        if bad:
            raise SystemExit(f"map has {len(bad)} invalid sub_id target(s): {bad}")

    n = build(args.base, args.map, args.out, temp_directory=args.temp_directory)
    print(f"wrote {n} delta rows -> {args.out}")
