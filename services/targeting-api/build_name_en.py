# -*- coding: utf-8 -*-
"""Conservative English-name normalisation for `name_en`.

`name_en` arrives raw from several sources: stray leading/trailing and doubled
whitespace, and explicit *non-name placeholders* that should read «غير متاح»
rather than pose as a name (`No Information`, `N/A`, `-`, `.`, `test`, …).

This module is deliberately minimal — المستخدم أولاً / الرقم يطابق مصدره:

  * **Whitespace only** is folded (trim + collapse internal runs). Letter case is
    left exactly as the source has it — title-casing 1.7M names would mangle
    brands (`iPhone`, `McDonald's`, acronyms), so we never touch case.
  * An explicit placeholder is mapped to **NULL** (→ «غير متاح»), never kept as a
    fake name and never guessed into something else. The placeholder set is the
    narrow list of true no-information markers; generic-but-real nouns like
    `Shop`/`Laundry` are **kept** (they are a weak name, not a placeholder).
  * Arabic text that landed in `name_en` is left untouched here (it is still a
    name; moving/clearing it is a separate source-mapping concern).

Output: a *delta* parquet `[poi_key, name_en_norm]` of only the rows whose value
changes — whitespace-folded, or cleared to NULL for a placeholder.

Run directly:
    python build_name_en.py [--base <targets.parquet>] [--out <delta.parquet>]
"""

from __future__ import annotations

import re
from typing import Optional

#: Explicit no-information markers → «غير متاح» (NULL). Narrow on purpose.
PLACEHOLDERS = {
    "no information", "no info", "n/a", "na", "none", "null", "nil", "unknown",
    "test", "tbd", "xxx", "xxxx", ".", "..", "...", "-", "--", "---", "_", "?",
    "??", "????", "0", "00", "غير متاح", "لا يوجد",
}


def normalize(value: Optional[str]) -> Optional[str]:
    """Return the cleaned `name_en`, or ``None`` for a blank/placeholder.

    Whitespace is trimmed and internal runs collapsed; case is preserved. A value
    whose folded form is an explicit placeholder becomes ``None``.
    """
    if value is None:
        return None
    s = re.sub(r"\s+", " ", value).strip()
    if not s:
        return None
    if s.lower() in PLACEHOLDERS:
        return None
    return s


def changed(original: Optional[str]) -> bool:
    """True when :func:`normalize` would alter ``original`` (incl. →NULL)."""
    if original is None:
        return False
    return normalize(original) != original


def build(
    targets_path: str,
    out_path: str,
    memory_limit: str = "8GB",
    threads: int = 6,
    temp_directory: Optional[str] = None,
):
    """Build the delta `[poi_key, name_en_norm]` (rows whose value changes).

    `name_en_norm` is NULL for a placeholder row (the fill merge clears the name
    to «غير متاح»); otherwise it is the whitespace-folded value.
    """
    import duckdb

    con = duckdb.connect()
    con.execute(f"PRAGMA memory_limit='{memory_limit}'")
    con.execute(f"PRAGMA threads={threads}")
    if temp_directory:
        con.execute(f"SET temp_directory='{temp_directory}'")

    con.create_function(
        "name_en_norm", normalize, ["VARCHAR"], "VARCHAR", null_handling="special"
    )
    con.execute(
        f"""
        COPY (
          SELECT poi_key, name_en_norm(name_en) AS name_en_norm
          FROM read_parquet('{targets_path}')
          WHERE name_en IS NOT NULL
            AND name_en_norm(name_en) IS DISTINCT FROM name_en
        ) TO '{out_path}' (FORMAT PARQUET)
        """
    )
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out_path}')").fetchone()[0]
    nulled = con.execute(
        f"SELECT count(*) FROM read_parquet('{out_path}') WHERE name_en_norm IS NULL"
    ).fetchone()[0]
    con.close()
    return n, nulled


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build the name_en normalisation delta.")
    ap.add_argument("--base", default="/app/data/releases/atlas-2026-11-02-v14-classification/targets.parquet")
    ap.add_argument("--out", default="/tmp/name_en_norm.parquet")
    ap.add_argument("--temp-directory", default=None)
    args = ap.parse_args()
    n, nulled = build(args.base, args.out, temp_directory=args.temp_directory)
    print(f"wrote {n} delta rows ({nulled} cleared to NULL) -> {args.out}")
