# -*- coding: utf-8 -*-
"""Conservative Farq-subcategory fill from the business NAME (free, lexicon-based).

A POI's own name usually states its activity («صيدلية…», «… للمقاولات», "… Barber").
The repo already ships a mined term→sub_id lexicon (`search_lexicon.csv`); this
module uses only its **high-confidence, unambiguous** terms to classify *weak*
POIs from their `name_en`/`name_ar`. It is the name-pattern lever the taxonomy
search uses, applied as a *fill* for POIs the classifier left weak.

Fill-only candidate, never a blind override — المستخدم أولاً:

  * Only terms with ``share >= 0.6`` AND ``support >= 5`` AND length >= 4, and
    only terms that map to a **single** sub_id, are used. Short/ambiguous terms
    are dropped.
  * A POI is classified only when every lexicon term found in its name agrees on
    **one** sub_id (``nsub == 1``). A name whose terms disagree yields nothing —
    we never pick one; it stays «غير متاح».
  * A POI that already has a confident, specific category is not touched by the
    publish step that consumes this delta.

Output: a *delta* parquet ``[poi_key, sub_from_name]`` for weak POIs with an
unambiguous name classification. Emitted value is a real taxonomy ``sub_id``.

Run directly:
    python build_category_from_name.py [--base <targets.parquet>] \\
        [--lexicon <search_lexicon.csv>] [--out <delta.parquet>]
"""

from __future__ import annotations

import csv
import re
from typing import Dict, Optional

_MIN_SHARE = 0.6
_MIN_SUPPORT = 5
_MIN_LEN = 4
_KEEP = re.compile(r"[^a-z0-9؀-ۿ ]")


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def load_lexicon(csv_path: str) -> Dict[str, str]:
    """High-confidence term → sub_id map; only terms that map to a single sub_id."""
    by_term: Dict[str, set] = {}
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            term = (row.get("term") or "").strip().lower()
            sub = (row.get("sub_id") or "").strip()
            if not term or not sub or len(term) < _MIN_LEN:
                continue
            if _f(row.get("share")) < _MIN_SHARE or _f(row.get("support")) < _MIN_SUPPORT:
                continue
            by_term.setdefault(term, set()).add(sub)
    return {t: next(iter(s)) for t, s in by_term.items() if len(s) == 1}


def _grams(name: str):
    toks = _KEEP.sub(" ", (name or "").lower()).split()
    n = len(toks)
    for i in range(n):
        for L in (1, 2, 3):
            if i + L <= n:
                g = " ".join(toks[i:i + L])
                if len(g) >= _MIN_LEN:
                    yield g


def classify(name_en: Optional[str], name_ar: Optional[str], lex: Dict[str, str]) -> Optional[str]:
    """Return the single sub_id the name's lexicon terms agree on, else ``None``.

    Scans 1–3-grams of ``name_en`` and ``name_ar``. If every matched term points
    to one sub_id, returns it; if they disagree (or none match), returns ``None``.
    """
    subs = set()
    for name in (name_en, name_ar):
        if not name:
            continue
        for g in _grams(name):
            s = lex.get(g)
            if s:
                subs.add(s)
                if len(subs) > 1:
                    return None
    return next(iter(subs)) if len(subs) == 1 else None


def build(
    targets_path: str,
    lexicon_path: str,
    out_path: str,
    memory_limit: str = "10GB",
    threads: int = 6,
    temp_directory: Optional[str] = None,
):
    """Build the delta ``[poi_key, sub_from_name]`` for weak POIs (unambiguous only).

    The SQL mirrors :func:`classify`: 1–3-grams of name_en+name_ar joined to the
    unique high-confidence lexicon; a POI is emitted only when exactly one
    distinct sub_id is found across all its grams.
    """
    import duckdb

    lex = load_lexicon(lexicon_path)
    con = duckdb.connect()
    con.execute(f"PRAGMA memory_limit='{memory_limit}'")
    con.execute(f"PRAGMA threads={threads}")
    if temp_directory:
        con.execute(f"SET temp_directory='{temp_directory}'")
    con.execute("CREATE TEMP TABLE lex(term VARCHAR, sub VARCHAR)")
    con.executemany("INSERT INTO lex VALUES (?, ?)", list(lex.items()))

    weak = ("(sub_id IS NULL OR sub_id LIKE 'unc.%' OR sub_id LIKE '%\\_general' ESCAPE '\\' "
            "OR lower(coalesce(cls_confidence,'')) IN ('low',''))")
    con.execute(
        f"""
        COPY (
          WITH tok AS (
            SELECT poi_key,
              string_split(regexp_replace(lower(coalesce(name_en,'')||' '||coalesce(name_ar,'')),
                           '[^a-z0-9؀-ۿ ]',' ','g'), ' ') AS toks
            FROM read_parquet('{targets_path}')
            WHERE {weak} AND (name_en IS NOT NULL OR name_ar IS NOT NULL)
          ),
          g AS (
            SELECT poi_key, gram FROM (
              SELECT poi_key, unnest(toks) AS gram FROM tok
              UNION ALL SELECT poi_key, toks[i]||' '||toks[i+1] FROM tok, generate_series(1,len(toks)-1) s(i)
              UNION ALL SELECT poi_key, toks[i]||' '||toks[i+1]||' '||toks[i+2] FROM tok, generate_series(1,len(toks)-2) s(i)
            ) WHERE length(gram) >= {_MIN_LEN}
          ),
          m AS (
            SELECT g.poi_key, count(DISTINCT lex.sub) AS nsub, min(lex.sub) AS one_sub
            FROM g JOIN lex ON g.gram = lex.term GROUP BY g.poi_key
          )
          SELECT poi_key, one_sub AS sub_from_name FROM m WHERE nsub = 1
        ) TO '{out_path}' (FORMAT PARQUET)
        """
    )
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out_path}')").fetchone()[0]
    con.close()
    return n


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build the name→sub_id classification fill delta.")
    ap.add_argument("--base", default="/app/data/releases/atlas-2026-11-03-v15-normalized/targets.parquet")
    ap.add_argument("--lexicon", default="/app/data/taxonomy/search_lexicon.csv")
    ap.add_argument("--out", default="/tmp/category_from_name.parquet")
    ap.add_argument("--temp-directory", default=None)
    args = ap.parse_args()
    n = build(args.base, args.lexicon, args.out, temp_directory=args.temp_directory)
    print(f"wrote {n} delta rows -> {args.out}")
