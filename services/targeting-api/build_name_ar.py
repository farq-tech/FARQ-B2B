"""Fill a trustworthy Arabic name (``name_ar``) for Atlas POIs that lack one.

Goal #8 of the Atlas data-quality workstream: many POIs carry no Arabic name, or
only a generic/English placeholder (e.g. travel agencies left as "Travel Agency").
This module derives ``name_ar`` from the strongest Arabic source already present on
the record, in a fixed priority order, and emits a *delta* parquet of only the rows
it adds or improves. It never overwrites a good existing Arabic name and never
writes a bare generic activity word in place of a real name.

Priority of fill sources (highest first):
  1. ``brand_name_ar``        — the consumer-facing brand name (Arabic).
  2. ``source_license_name``  — the official commercial-license trade name (Arabic).
  3. ``urbi_legal_name_ar``   — the Farq directory legal name (Arabic), legal-form
                                prefixes stripped.
  4. ``legal_name``           — generic legal name (Arabic), prefixes stripped.
  5. ``brand_map``            — a small curated transliteration map for well-known
                                brands, used ONLY when the record is otherwise
                                English-only/empty and nothing above applies. This
                                is the only "transliteration" path and it is
                                hand-curated, never free-form.

All outputs are build provenance. The user-facing source label in Atlas remains
"فرق"; ``name_source`` here records which upstream column the value came from so a
correction can enter at a single point.

Run directly to (re)build the delta:
    python build_name_ar.py [--base <targets.parquet>] [--out <name_ar.parquet>]
"""

from __future__ import annotations

import argparse
import re
import unicodedata
from typing import Optional, Tuple

# --- character / blank helpers ------------------------------------------------

_ARABIC_RE = re.compile(r"[؀-ۿ]")


def has_arabic(value: Optional[str]) -> bool:
    """True iff *value* contains at least one Arabic letter."""
    return bool(value) and bool(_ARABIC_RE.search(value))


def normalize_ws(value: Optional[str]) -> Optional[str]:
    """NFKC-normalize, trim, and collapse internal whitespace. '' -> None."""
    if value is None:
        return None
    text = unicodedata.normalize("NFKC", str(value)).strip()
    text = re.sub(r"\s+", " ", text)
    return text or None


# --- junk / generic detection -------------------------------------------------

# English-only values that are placeholders or bare activity words, not real
# names. A record carrying one of these is treated as effectively empty, so an
# Arabic source may replace it.
JUNK_LATIN = {
    "no information", "approved", "medium", "n/a", "na", "null", "none",
    "unknown", "test", "catering", "laundry", "barber", "tailor", "car wash",
    "coffee shop", "coffee", "storehouse", "store", "restaurant", "pharmacy",
    "salon", "bakery", "supermarket", "grocery", "cafe", "clinic", "mosque",
    "contracting corporation", "cross cars temporary license", "tail",
}


def is_junk_latin(value: Optional[str]) -> bool:
    """True if an English-only *value* is a placeholder, number, or bare
    activity word that should be treated as missing."""
    if not value:
        return True
    text = value.strip().lower()
    if text in JUNK_LATIN:
        return True
    if re.fullmatch(r"[\d\.\s\-_,/]+", text):  # numbers / punctuation only
        return True
    if len(re.sub(r"[^a-z0-9]", "", text)) <= 1:  # single char / empty core
        return True
    return False


# Leading legal-form boilerplate stripped from legal names to recover the trade
# name. Longer / more specific phrases must precede their shorter substrings.
LEGAL_PREFIXES = [
    "مؤسسة فردية", "شركة الشخص الواحد", "شركة شخص واحد",
    "ذ.م.م.", "ذ.م.م", "ذ م م", "مؤسسة", "شركة", "مجموعة",
]

# Bare generic Arabic activity words. A candidate that reduces to only these
# (plus connective particles) is NOT a real name and is rejected.
GENERIC_AR = {
    "مطعم", "كافيه", "مقهى", "صيدلية", "صالون", "مغسلة", "ورشة", "محل", "مكتب",
    "سوبرماركت", "بقالة", "مخبز", "مخبوزات", "عيادة", "مستوصف", "فندق", "مسجد",
    "شركة", "مؤسسة", "وكالة", "معرض", "مركز", "مستودع", "وكالة سفر", "مكتب عقار",
    "مكتب عقارات", "صالون حلاقة", "صالون تجميل",
}
_PARTICLES = {"ال", "و", "لل", "ل", "في", "من"}


def strip_legal_prefix(value: Optional[str]) -> Optional[str]:
    """Repeatedly remove leading legal-form tokens from *value*."""
    if not value:
        return value
    current = value.strip()
    prev = None
    while current and current != prev:
        prev = current
        for prefix in LEGAL_PREFIXES:
            if current == prefix:
                current = ""
                break
            if current.startswith(prefix + " "):
                current = current[len(prefix):].strip()
                break
    return current or None


def is_generic_arabic(value: Optional[str]) -> bool:
    """True if *value* is only generic activity words / particles (no real name)."""
    if not value:
        return True
    text = value.strip()
    if text in GENERIC_AR:
        return True
    tokens = text.split()
    return all(tok in GENERIC_AR or tok in _PARTICLES for tok in tokens)


def clean_arabic_candidate(value: Optional[str]) -> Optional[str]:
    """Normalize an Arabic source value into a usable name, or None if it is not
    Arabic, is empty, or reduces to a generic activity word."""
    text = normalize_ws(value)
    if not text or not has_arabic(text):
        return None
    text = normalize_ws(strip_legal_prefix(text))
    # Re-check for Arabic after stripping: some legal names are an Arabic legal
    # prefix (e.g. "مؤسسة فردية") in front of an English trade name; once the
    # prefix is gone the remainder may be English-only, which is not a name_ar.
    if not text or not has_arabic(text) or is_generic_arabic(text):
        return None
    return text


# Curated, high-confidence brand spellings. Keys are lower-cased English/latin
# forms; values are the canonical Arabic rendering. Keep this small and only add
# brands whose Arabic form is unambiguous.
BRAND_MAP = {
    "stc": "اس تي سي",
    "mobily": "موبايلي",
    "dhl": "دي إتش إل",
    "domino's pizza": "دومينوز بيتزا",
    "dominos pizza": "دومينوز بيتزا",
    "kfc": "كنتاكي",
    "spl": "البريد السعودي",
    "riyad bank atm": "صراف بنك الرياض",
}

# Ordered (column, source-label) pairs for the Arabic-source fill chain.
SOURCE_CHAIN = [
    ("brand_name_ar", "brand_name_ar"),
    ("source_license_name", "source_license_name"),
    ("urbi_legal_name_ar", "urbi_legal_name_ar"),
    ("legal_name", "legal_name"),
]


def pick_name_ar(row: dict) -> Tuple[Optional[str], Optional[str]]:
    """Return ``(name_ar_fill, name_source)`` for *row*, or ``(None, None)`` to
    leave the record unchanged.

    *row* is a mapping with keys: name_ar, name_en, brand_name_ar,
    source_license_name, urbi_legal_name_ar, legal_name.
    """
    existing = normalize_ws(row.get("name_ar"))

    # Guard: never touch a good existing Arabic name.
    if has_arabic(existing) and not is_generic_arabic(existing):
        return None, None

    # Only fill when the existing value is missing, junk-English, or a bare
    # generic Arabic word.
    fillable = (
        existing is None
        or (not has_arabic(existing) and is_junk_latin(existing))
        or (has_arabic(existing) and is_generic_arabic(existing))
    )

    # 1-4: Arabic source chain.
    for column, label in SOURCE_CHAIN:
        candidate = clean_arabic_candidate(row.get(column))
        if candidate and (fillable or existing is None):
            if candidate != existing:
                return candidate, label

    # 5: curated brand map, only for English-only / empty records.
    if existing is None or (not has_arabic(existing) and not is_generic_arabic(existing)):
        for key in (existing, normalize_ws(row.get("name_en"))):
            if key:
                mapped = BRAND_MAP.get(key.strip().lower())
                if mapped and mapped != existing:
                    return mapped, "brand_map"

    return None, None


# --- build driver -------------------------------------------------------------

BASE_DEFAULT = (
    "/Volumes/farq/release_build/atlas-2026-11-02-v8-unified/targets.parquet"
)
TEMP_DIR = "/Volumes/farq/_duckdb_tmp"
FILL_COLUMNS = [
    "poi_key", "name_ar", "name_en",
    "brand_name_ar", "source_license_name", "urbi_legal_name_ar", "legal_name",
]


def build_delta(base_path: str = BASE_DEFAULT, out_path: Optional[str] = None):
    """Read the base targets parquet, compute fills, and return a DataFrame with
    columns ``[poi_key, name_ar_fill, name_source]``. If *out_path* is given the
    DataFrame is also written there as parquet."""
    import duckdb  # local import so the pure functions stay dependency-free

    con = duckdb.connect()
    con.execute(f"PRAGMA temp_directory='{TEMP_DIR}'")
    cols = ", ".join(FILL_COLUMNS)
    # Arabic character class built from real boundary chars (DuckDB's string
    # literal parser rejects backslash-u escapes).
    arabic_class = "[" + "؀" + "-" + "ۿ" + "]"
    # Restrict to rows that could possibly need a fill (missing or non-Arabic).
    work = con.execute(
        f"""
        SELECT {cols}
        FROM read_parquet('{base_path}')
        WHERE name_ar IS NULL OR trim(name_ar) = ''
           OR NOT regexp_matches(name_ar, '{arabic_class}')
        """
    ).df()

    picks = work.apply(
        lambda r: pick_name_ar(r.to_dict()), axis=1, result_type="expand"
    )
    work["name_ar_fill"] = picks[0]
    work["name_source"] = picks[1]
    delta = work.loc[
        work["name_ar_fill"].notna(), ["poi_key", "name_ar_fill", "name_source"]
    ].reset_index(drop=True)

    if out_path:
        import os
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        delta.to_parquet(out_path, index=False)
    return delta


def main():
    parser = argparse.ArgumentParser(description="Build the name_ar fill delta.")
    parser.add_argument("--base", default=BASE_DEFAULT)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    delta = build_delta(args.base, args.out)
    print(f"rows filled: {len(delta)}")
    print(delta["name_source"].value_counts().to_string())
    if args.out:
        print(f"written: {args.out}")


if __name__ == "__main__":
    main()
