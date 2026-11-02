# -*- coding: utf-8 -*-
"""Canonical Arabic street-name normalisation (spelling-only, road-type-safe).

`street_ar` arrives from several sources with the *same* street spelled several
ways: `عبد العزيز` vs `عبدالعزيز`, hamza/alef (`الامير` vs `الأمير`), ta-marbuta
(`المدينه` vs `المدينة`), tatweel and stray whitespace. Served as-is, one street
splits across spellings and its counts fragment.

This module folds only **true spelling variants of the same surface string** to a
single canonical form. It is deliberately conservative — المستخدم أولاً / الرقم
يطابق مصدره:

  * The **road-type word is preserved**: `شارع فلان` and `طريق فلان` are NOT
    merged — they can be two different roads. Only the letters after it are
    spelling-folded. (An aggressive key that dropped the prefix merged distinct
    roads; rejected.)
  * The canonical surface per normalisation key is the **modal** (most frequent)
    original spelling — we promote the spelling the data itself uses most, never
    invent one.
  * A street with no spelling twin keeps its exact original value; nothing is
    guessed or dropped.

Output: a *delta* parquet `[poi_key, street_ar_norm]` of only the rows whose
`street_ar` differs from its key's canonical form.

Run directly:
    python build_street_ar.py [--base <targets.parquet>] [--out <delta.parquet>]
"""

from __future__ import annotations

import re
from typing import Optional

# أ إ آ -> ا ، ة -> ه ، ى -> ي ، ؤ ئ -> و ي  (same table as canonical_data.AR_LETTERS)
_AR_LETTERS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي"})
_HARAKAT_TATWEEL = re.compile("[ً-ْـ]")  # tanwin/harakat + tatweel


def norm_key(value: Optional[str]) -> Optional[str]:
    """Spelling-folding key for grouping variants of the SAME street.

    Folds alef-hamza forms, ta-marbuta, alef-maqsura, waw/ya-hamza, strips
    harakat and tatweel, joins the `عبد <name>` split into `عبد<name>`, and
    collapses whitespace. The road-type word (`شارع`/`طريق`/…) is **kept**, so
    two roads that differ only by type stay distinct. Returns ``None`` for blank.
    """
    if value is None:
        return None
    s = value.translate(_AR_LETTERS)
    s = _HARAKAT_TATWEEL.sub("", s)
    s = s.replace("عبد ", "عبد")  # عبد العزيز -> عبدالعزيز (one name)
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def build(
    targets_path: str,
    out_path: str,
    memory_limit: str = "8GB",
    threads: int = 6,
    temp_directory: Optional[str] = None,
):
    """Build the delta `[poi_key, street_ar_norm]` (rows whose spelling is folded).

    For each :func:`norm_key` group the canonical surface is the modal original
    `street_ar` (highest POI count, ties broken by the spelling itself for
    determinism). A row is emitted only when its own `street_ar` differs from
    that canonical form.
    """
    import duckdb

    con = duckdb.connect()
    con.execute(f"PRAGMA memory_limit='{memory_limit}'")
    con.execute(f"PRAGMA threads={threads}")
    if temp_directory:
        con.execute(f"SET temp_directory='{temp_directory}'")

    con.create_function("street_key", norm_key, ["VARCHAR"], "VARCHAR")
    con.execute(
        f"""
        COPY (
          WITH src AS (
            SELECT poi_key, street_ar, street_key(street_ar) AS k
            FROM read_parquet('{targets_path}')
            WHERE street_ar IS NOT NULL AND trim(street_ar) <> ''
          ),
          counts AS (
            SELECT k, street_ar, count(*) AS c FROM src GROUP BY k, street_ar
          ),
          canon AS (
            SELECT k,
                   first(street_ar ORDER BY c DESC, street_ar) AS canonical
            FROM counts GROUP BY k
          )
          SELECT s.poi_key, c.canonical AS street_ar_norm
          FROM src s JOIN canon c USING (k)
          WHERE s.street_ar <> c.canonical
        ) TO '{out_path}' (FORMAT PARQUET)
        """
    )
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out_path}')").fetchone()[0]
    con.close()
    return n


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build the street_ar spelling-normalisation delta.")
    ap.add_argument("--base", default="/app/data/releases/atlas-2026-11-02-v14-classification/targets.parquet")
    ap.add_argument("--out", default="/tmp/street_ar_norm.parquet")
    ap.add_argument("--temp-directory", default=None)
    args = ap.parse_args()
    n = build(args.base, args.out, temp_directory=args.temp_directory)
    print(f"wrote {n} delta rows -> {args.out}")
