"""Polish Atlas Arabic names: shorten legal forms and unify brand spelling.

Two internal, zero-cost name improvements that build on the ``name_ar`` fill
delta (see :mod:`build_name_ar`). The *effective* Arabic name per POI is
``coalesce(name_ar_fill, base.name_ar)``; everything here works on that.

1. SHORTEN legal forms -> commercial name
   Saudi commercial names carry a leading legal form (``مؤسسة`` / ``شركة`` /
   ``مكتب`` / ``ذ.م.م``) and a trailing registry/activity descriptor
   (``للتجارة`` / ``التجارية`` / ``للمقاولات`` ...). For the map a user wants the
   distinctive trade name, not the boilerplate. ``name_ar_short`` is that trade
   name; the full form stays retrievable in ``name_ar_legal`` so nothing is lost
   and a correction can enter at a single point.

   GUARD: a short name is never allowed to collapse to a bare generic activity
   word (``مطعم`` / ``صيدلية`` / ``ورشة`` / ``وكالة سفر`` ...). If stripping would
   leave only a generic word (or nothing), the fuller name is kept instead.

2. UNIFY brand spelling across chain branches
   A chain's branches spell the Arabic name many ways (``DUNKIN`` has 19).
   ``brand_name_ar`` is a curated, near-canonical Arabic spelling (one per brand).
   For every branded POI whose effective name differs from that canonical
   spelling, ``brand_spelling_canonical`` records the unified spelling, so Atlas
   can show one spelling for the whole chain without discarding the branch name.

The user-facing source label in Atlas stays "فرق"; these are build-provenance
columns. Outputs a *delta* parquet of only the rows that change.

Run directly to (re)build the delta:
    python build_name_polish.py [--base <targets.parquet>] \\
        [--name-ar <name_ar.parquet>] [--out <name_polish.parquet>]
"""

from __future__ import annotations

import argparse
import re
from typing import Optional

# Reuse the vetted helpers from the name_ar fill module (read-only import).
from build_name_ar import (
    GENERIC_AR,
    has_arabic,
    is_generic_arabic,
    normalize_ws,
    strip_legal_prefix,
)

# --- leading legal forms ------------------------------------------------------

# Leading classifier words that precede the trade name. ``strip_legal_prefix``
# already handles مؤسسة / شركة / مجموعة / ذ.م.م and the one-person-company forms;
# these add the remaining display-droppable classifiers.
EXTRA_LEADING = ["مكتب", "مصنع"]


def strip_leading_legal(value: Optional[str]) -> Optional[str]:
    """Remove a leading legal/classifier form (``مؤسسة``/``شركة``/``مكتب`` ...)."""
    current = strip_legal_prefix(value)
    if not current:
        return current
    changed = True
    while changed and current:
        changed = False
        for word in EXTRA_LEADING:
            if current == word:
                return None
            if current.startswith(word + " "):
                current = current[len(word):].strip()
                changed = True
        stripped = strip_legal_prefix(current)
        if stripped != current:
            current = stripped or ""
            changed = True
    return current or None


# --- trailing legal phrases ---------------------------------------------------

# Trailing legal boilerplate (longest first so multi-word phrases match before
# their substrings).
TRAILING_LEGAL = [
    "شركة الشخص الواحد", "شركة شخص واحد", "ذات مسؤولية محدودة",
    "الشخص الواحد", "شخص واحد",
    "المحدودة", "المحدوده", "القابضة", "القابضه",
    "وشركاه", "وشركاؤه", "وشركاءه", "وأولاده", "واولاده",
    "وإخوانه", "واخوانه",
]


def strip_trailing_phrases(value: str, phrases) -> str:
    """Repeatedly drop any of *phrases* from the end of *value*."""
    current = value.strip()
    changed = True
    while changed and current:
        changed = False
        for phrase in phrases:
            if current == phrase:
                return ""
            if current.endswith(" " + phrase):
                current = current[: -len(phrase)].strip()
                changed = True
                break
    return current


# --- activity / registry tail -------------------------------------------------

# Single-token activity heads that open the trade-activity descriptor. A token
# starting with "لل" (for-the-...) is treated as an activity head too; these two
# cover للمقاولات / للتجارة / للخدمات and the lighter لتجارة / لبيع / لتأجير forms.
ACTIVITY_LAM = {
    "لتجارة", "لتجاره", "لبيع", "لتأجير", "لتاجير", "لصيانة", "لصيانه",
    "لخدمات", "لتقديم", "لتقنية", "لتقنيه", "لتوزيع", "لإنتاج", "لانتاج",
    "لمواد", "لتسويق", "لصناعة", "لصناعه", "لنقل", "لتشغيل", "لاستقدام",
    "لتجهيز", "لتركيب", "لتجارة", "لمقاولات",
}

# Trailing descriptive/نسبة adjectives and و-joined activity words that are part
# of the registry descriptor, not the trade name.
TRAILING_ADJ = {
    "التجارية", "التجاريه", "العامة", "العامه", "عامة", "عامه",
    "العقارية", "العقاريه", "العقاري", "الهندسية", "الهندسيه",
    "المعمارية", "المعماريه", "الغذائية", "الغذائيه", "الطبية", "الطبيه",
    "القانونية", "القانونيه", "الصناعية", "الصناعيه", "الزراعية",
    "السياحية", "التعليمية", "الوطنية", "الدولية", "العالمية",
    "المتحدة", "المتحده", "الحديثة", "الحديثه",
    "والمقاولات", "والصيانة", "والصيانه", "والاعلان", "والإعلان",
    "والتسويق", "والتجارة", "والتجاره", "والنقل", "والتوزيع",
}

_DANGLING = {"و", "ال", "لل", "ل", "في", "من", "-", "،", "."}


def _is_activity_head(token: str) -> bool:
    if token in ACTIVITY_LAM:
        return True
    # "لل..." (for the ...) openers, but not a bare particle.
    return token.startswith("لل") and len(token) > 3


def cut_activity_tail(value: str) -> str:
    """Cut the trade-activity descriptor off the end of *value*.

    Everything from the earliest activity-head token (at position >= 1, so at
    least one core word always survives the cut) to the end is dropped.
    """
    tokens = value.split()
    for i in range(1, len(tokens)):
        if _is_activity_head(tokens[i]):
            return " ".join(tokens[:i]).strip()
    return value.strip()


def strip_trailing_adjectives(value: str) -> str:
    """Drop trailing descriptive adjectives / dangling particles while more than
    one token remains."""
    tokens = value.split()
    while len(tokens) > 1 and (tokens[-1] in TRAILING_ADJ or tokens[-1] in _DANGLING):
        tokens.pop()
    return " ".join(tokens).strip()


# --- owner-name triple --------------------------------------------------------

# Common Saudi given-name tokens plus patronymic / family markers. Used only to
# strip a LEADING owner name when a real trade name clearly follows it; when in
# doubt the owner name is kept (it is itself a valid shop name).
PERSONAL_TOKENS = {
    "عبدالله", "عبدالعزيز", "عبدالرحمن", "عبدالمحسن", "عبدالاله", "عبدالإله",
    "عبداللطيف", "عبدالمجيد", "عبدالكريم", "عبدالوهاب", "عبدالهادي",
    "محمد", "احمد", "أحمد", "علي", "سعد", "سعود", "فهد", "خالد", "ناصر",
    "صالح", "سلطان", "يوسف", "ابراهيم", "إبراهيم", "عمر", "عثمان", "حسن",
    "حسين", "سلمان", "طلال", "بندر", "ماجد", "وليد", "زياد", "رياض", "فيصل",
    "نواف", "مشعل", "تركي", "سامي", "جابر", "الشريف", "القحطاني", "الغامدي",
    "الزهراني", "العتيبي", "الشهري", "الحربي", "الدوسري", "المالكي",
    "السالم", "السعيد", "الحمد", "العلي", "العمر", "الفهد", "الخالد",
    "بن", "ابن", "آل", "بنت",
}


def _looks_personal(token: str) -> bool:
    if token in PERSONAL_TOKENS:
        return True
    # Family name written with the ال- article (e.g. الشمري, العنزي).
    return token.startswith("ال") and (token[2:] in {"شمري", "عنزي", "مطيري"})


def strip_owner_triple(value: str) -> str:
    """Strip a leading owner-name run (>= 2 personal tokens) IFF a non-generic,
    non-personal trade name of at least one token remains afterwards.

    Owner-only names (nothing but the person's name) are returned unchanged:
    the owner's name is the shop's name.
    """
    tokens = value.split()
    n = len(tokens)
    i = 0
    while i < n and _looks_personal(tokens[i]):
        i += 1
    if i < 2:  # no clear owner prefix
        return value
    remainder = tokens[i:]
    if not remainder:
        return value  # owner-only -> keep
    joined = " ".join(remainder).strip()
    if is_generic_arabic(joined):
        return value  # would leave only a generic word -> keep fuller
    return joined


# --- shortening entry point ---------------------------------------------------


def shorten_name(effective_name: Optional[str]) -> Optional[str]:
    """Return a shortened commercial ``name_ar_short`` for *effective_name*, or
    ``None`` to leave the name unchanged (not Arabic, already short, or the guard
    refuses the strip)."""
    base = normalize_ws(effective_name)
    if not base or not has_arabic(base):
        return None

    no_legal = normalize_ws(strip_leading_legal(base))
    core = no_legal or base

    core = strip_trailing_phrases(core, TRAILING_LEGAL)
    core = cut_activity_tail(core)
    core = strip_trailing_adjectives(core)
    core = strip_owner_triple(core)
    core = normalize_ws(core)

    # GUARD: never reduce to empty or a bare generic activity word. When the
    # stripped core carries no real trade name (empty or generic-only), keep the
    # fuller name untouched -> no delta row.
    if not core or is_generic_arabic(core):
        return None

    if core == base:
        return None  # nothing was shortened
    return core


# --- build driver -------------------------------------------------------------

BASE_DEFAULT = (
    "/Volumes/farq/release_build/atlas-2026-11-02-v8-unified/targets.parquet"
)
NAME_AR_DEFAULT = (
    "/private/tmp/claude-501/-Users-m4pro-FARQ-B2B/"
    "4d8ec590-15eb-4dfe-b0a1-9b98dc411188/scratchpad/v10/deltas/name_ar.parquet"
)
TEMP_DIR = "/Volumes/farq/_duckdb_tmp"


def _canonical_brand_spelling(con, base_path: str, name_ar_expr: str):
    """Return a {brand_name -> canonical Arabic spelling} dict from the curated
    ``brand_name_ar`` column (the most frequent value, to resolve the rare case
    of two spellings for one brand)."""
    arabic_class = "[" + "؀" + "-" + "ۿ" + "]"
    df = con.execute(
        f"""
        WITH b AS (
          SELECT brand_name, brand_name_ar, count(*) AS n
          FROM read_parquet('{base_path}')
          WHERE brand_name IS NOT NULL AND trim(brand_name) <> ''
            AND brand_name_ar IS NOT NULL
            AND regexp_matches(brand_name_ar, '{arabic_class}')
          GROUP BY 1, 2
        ),
        ranked AS (
          SELECT brand_name, brand_name_ar,
                 row_number() OVER (PARTITION BY brand_name ORDER BY n DESC, brand_name_ar) AS rk
          FROM b
        )
        SELECT brand_name, brand_name_ar FROM ranked WHERE rk = 1
        """
    ).fetchall()
    return {row[0]: row[1] for row in df}


def build_delta(
    base_path: str = BASE_DEFAULT,
    name_ar_path: str = NAME_AR_DEFAULT,
    out_path: Optional[str] = None,
):
    """Compute the name_polish delta and return it as a DataFrame with columns
    ``[poi_key, name_ar_short, name_ar_legal, brand_spelling_canonical]``.

    A row is present iff the POI is shortened and/or brand-unified; unused
    columns are null for that row.
    """
    import duckdb

    con = duckdb.connect()
    con.execute(f"PRAGMA temp_directory='{TEMP_DIR}'")
    arabic_class = "[" + "؀" + "-" + "ۿ" + "]"

    # Effective Arabic name per POI = coalesce(name_ar_fill, base.name_ar).
    con.execute(
        f"""
        CREATE VIEW eff AS
        SELECT b.poi_key,
               coalesce(d.name_ar_fill, b.name_ar) AS name_ar,
               b.brand_name
        FROM read_parquet('{base_path}') b
        LEFT JOIN read_parquet('{name_ar_path}') d USING (poi_key)
        """
    )

    # --- GOAL 1: shortening -----------------------------------------------
    # Restrict to Arabic names that plausibly carry boilerplate: a legal lead,
    # an activity token, a trailing adjective, or 4+ words.
    work = con.execute(
        f"""
        SELECT poi_key, name_ar
        FROM eff
        WHERE name_ar IS NOT NULL
          AND regexp_matches(name_ar, '{arabic_class}')
          AND (
                name_ar LIKE 'مؤسسة %' OR name_ar LIKE 'شركة %'
             OR name_ar LIKE 'مكتب %'  OR name_ar LIKE 'مجموعة %'
             OR name_ar LIKE 'مصنع %'
             OR name_ar LIKE '% لل%'   OR name_ar LIKE '% ل%'
             OR name_ar LIKE '%التجارية%' OR name_ar LIKE '%العامة%'
             OR array_length(string_split(trim(name_ar), ' ')) >= 4
          )
        """
    ).df()

    work["name_ar_short"] = work["name_ar"].map(shorten_name)
    shortened = work.loc[work["name_ar_short"].notna()].copy()
    shortened = shortened.rename(columns={"name_ar": "name_ar_legal"})
    shortened = shortened[["poi_key", "name_ar_short", "name_ar_legal"]]

    # --- GOAL 2: brand unification ----------------------------------------
    canonical = _canonical_brand_spelling(con, base_path, "name_ar")
    import pandas as pd

    canon_df = pd.DataFrame(
        [(b, s) for b, s in canonical.items()],
        columns=["brand_name", "brand_spelling_canonical"],
    )
    branded = con.execute(
        f"""
        SELECT poi_key, name_ar, brand_name
        FROM eff
        WHERE brand_name IS NOT NULL AND trim(brand_name) <> ''
        """
    ).df()
    branded = branded.merge(canon_df, on="brand_name", how="inner")
    # Only rows whose effective name differs from the canonical spelling are a
    # real unification.
    branded["name_ar"] = branded["name_ar"].map(normalize_ws)
    unify = branded.loc[
        branded["name_ar"] != branded["brand_spelling_canonical"],
        ["poi_key", "brand_spelling_canonical"],
    ].copy()

    # --- merge the two deltas on poi_key ----------------------------------
    delta = pd.merge(shortened, unify, on="poi_key", how="outer")
    for col in ("name_ar_short", "name_ar_legal", "brand_spelling_canonical"):
        if col not in delta.columns:
            delta[col] = None
    delta = delta[
        ["poi_key", "name_ar_short", "name_ar_legal", "brand_spelling_canonical"]
    ].reset_index(drop=True)

    if out_path:
        import os

        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        delta.to_parquet(out_path, index=False)
    return delta


def main():
    parser = argparse.ArgumentParser(description="Build the name_polish delta.")
    parser.add_argument("--base", default=BASE_DEFAULT)
    parser.add_argument("--name-ar", default=NAME_AR_DEFAULT)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    delta = build_delta(args.base, args.name_ar, args.out)
    shortened = delta["name_ar_short"].notna().sum()
    unified = delta["brand_spelling_canonical"].notna().sum()
    print(f"rows total:     {len(delta)}")
    print(f"shortened:      {shortened}")
    print(f"brand-unified:  {unified}")
    if args.out:
        print(f"written: {args.out}")


if __name__ == "__main__":
    main()
