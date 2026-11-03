# -*- coding: utf-8 -*-
"""Conservative Farq-*specialty* fill from the business NAME (free, lexicon-based).

Sister module to :mod:`build_category_from_name`. That one fills a weak POI's
**sub_id** from its name; this one goes one level deeper: a POI that already has a
**confident** sub_id but an **empty** specialty often states its specialty in its
own name («… تموينات», «مغسلة …», «Afghan restaurant»). This module reads the
owner-curated ``specialties.csv`` (``match_terms`` per specialty) and, for such
POIs only, proposes a specialty **chosen only among the specialties of that POI's
own sub_id** — so cross-sub leakage is impossible by construction.

Fill-only candidate, never a blind override — المستخدم أولاً:

  * Only POIs with a **confident** served sub_id (``cls_confidence`` in
    {high, medium} AND a specific sub_id that is neither ``unc.*`` nor
    ``*_general``) **and** an **empty** ``specialty_ids`` are considered. A POI
    that already carries a specialty is never touched.
  * Terms are normalised exactly like ``taxonomy_search`` (alef/hamza/
    ta-marbuta/tatweel/whitespace folding + light singularisation), GENERIC
    activity nouns are dropped, and a small curated BLOCKLIST removes a few short
    ambiguous tokens (gas/key/نجم/امن) rather than raising a blunt min length
    (which would wrongly drop عود/ذهب/شاي/زيت/شيش).
  * For a candidate POI, 1–3-grams of ``name_en``+``name_ar`` are matched **only**
    against the term→specialty map of that POI's **own sub_id**. A specialty is
    assigned only when every matched term agrees on **one** specialty
    (unambiguous). Terms that disagree yield nothing — it stays «غير متاح».

Output: a *delta* parquet ``[poi_key, specialty_from_name, specialty_concept_from_name,
classification_method]`` for confident-sub + empty-specialty rows with an
unambiguous name match. ``classification_method`` is ``name_specialty`` for a
distinctive term, or ``name_specialty_sub_default`` when the only match was the
sub's own generic activity word (بوفيه/تموينات/مغسلة) — those map every POI in the
sub to one "default" specialty and are flagged for **owner approval** before any
publish (see :func:`sub_default_flags`).

Run directly:
    python build_specialty_from_name.py [--base <targets.parquet>] \\
        [--specialties <specialties.csv>] [--concepts <specialty_concepts.csv>] \\
        [--out <delta.parquet>]
"""

from __future__ import annotations

import csv
import os
import re
from typing import Dict, List, Optional, Set, Tuple

# --- normalisation (mirrors taxonomy_search.norm + plural_variants) -----------

# alef/hamza/ta-marbuta/ya folding, identical to taxonomy_search.TR
_TR = str.maketrans("أإآةىؤئ", "اااهيوي")
# diacritics + tatweel
_DIAC = re.compile("[ً-ْـ]")
# explicit punctuation (same set as taxonomy_search.norm — note the Arabic «،؟»,
# which a "keep Arabic block" filter alone would wrongly retain)
_PUNCT = re.compile(r"[_/\-–|(),.&{}\[\]\"'’:;!؟?،+*#]+")
# anything still outside [a-z0-9 + Arabic] after that -> space
_KEEP = re.compile(r"[^a-z0-9؀-ۿ ]")
_WS = re.compile(r"\s+")

#: generic activity nouns that carry no specialty signal (same spirit as
#: taxonomy_search.GENERIC; stored folded so the check is post-normalisation).
GENERIC: Set[str] = {
    "مواد", "معدات", "خدمات", "اجهزه", "مستلزمات", "ادوات", "منتجات", "قطع", "اعمال",
    "محل", "محلات", "شركه", "مؤسسه", "مكتب", "مركز", "تجاره", "بيع", "عامه", "عام",
    "جمله", "services", "service", "equipment", "supplies", "products", "materials",
    "parts", "store", "shop", "company", "general", "trading", "wholesale", "retail",
    "center", "office", "other", "and",
}

#: short, genuinely ambiguous tokens that match too broadly. Kept tiny on
#: purpose: a blunt min-length>=4 would wrongly drop valid short trade words
#: like عود/ذهب/شاي/زيت/شيش, so we blocklist the few offenders instead.
#: («نجم»/«امن» are brand/quality fillers; «gas»/«key» are category-agnostic.)
BLOCKLIST: Set[str] = {"gas", "key", "نجم", "امن"}


def _fold(s: Optional[str]) -> str:
    """Lowercase + alef/hamza/ta-marbuta/tatweel/punct/whitespace fold."""
    s = (s or "").lower().translate(_TR)
    s = _DIAC.sub("", s)
    s = _PUNCT.sub(" ", s)
    s = _KEEP.sub(" ", s)
    return _WS.sub(" ", s).strip()


def _singular(tok: str) -> str:
    """Deterministic light singularisation (same rules as plural_variants).

    Returns the *reduced* form so both the lexicon term and the name token
    canonicalise to the same string (one-sided expansion is unnecessary).
    """
    t = tok
    if len(t) > 4 and t.endswith("ات"):
        t = t[:-2]
    elif len(t) > 4 and t.endswith("ين"):
        t = t[:-2]
    elif len(t) > 4 and t.endswith("es"):
        t = t[:-2]
    elif len(t) > 3 and t.endswith("ه"):
        t = t[:-1]
    elif len(t) > 3 and t.endswith("s"):
        t = t[:-1]
    # common Arabic broken plurals
    if len(t) == 5 and t[1] == "و" and t[2] == "ا":           # فواعل → فاعل
        t = t[0] + "ا" + t[3:]
    elif len(t) == 5 and t[0] == "ا" and t[-1] == "ه":        # أفعلة → فعيل
        t = t[1:3] + "ي" + t[3]
    return t


def _norm_tokens(name: Optional[str]) -> List[str]:
    """Folded, singularised token list of a name/term."""
    return [_singular(t) for t in _fold(name).split() if t]


def term_key(term: str) -> Optional[str]:
    """Canonical gram-key for a lexicon term, or ``None`` if it drops out.

    Drops empty terms, terms whose every token is a GENERIC activity noun, and
    terms that are a single BLOCKLIST token. GENERIC/BLOCKLIST membership is
    checked on the **folded** token (GENERIC/BLOCKLIST are stored folded, e.g.
    plural «خدمات»), while the returned key is the **singularised** canonical
    form so lexicon terms and name grams meet.
    """
    folded = [t for t in _fold(term).split() if t]
    if not folded:
        return None
    if len(folded) == 1 and folded[0] in BLOCKLIST:
        return None
    if all(t in GENERIC for t in folded):
        return None
    return " ".join(_singular(t) for t in folded)


def _grams(name: Optional[str]):
    """1–3-grams of a name's singularised tokens."""
    toks = _norm_tokens(name)
    n = len(toks)
    for i in range(n):
        for L in (1, 2, 3):
            if i + L <= n:
                yield " ".join(toks[i:i + L])


# --- taxonomy loading ---------------------------------------------------------


def load_specialties(csv_path: str) -> Dict[str, Dict[str, Set[str]]]:
    """``sub_id -> { term_key -> {specialty_id, ...} }`` from ``specialties.csv``.

    A term is kept per the :func:`term_key` rules. The value is a **set** of
    specialty_ids so a term that resolves to more than one specialty *within its
    sub* stays ambiguous (and will therefore block, not guess).
    """
    out: Dict[str, Dict[str, Set[str]]] = {}
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            sub = (row.get("sub_id") or "").strip()
            spec = (row.get("specialty_id") or "").strip()
            if not sub or not spec:
                continue
            sub_map = out.setdefault(sub, {})
            for raw in (row.get("match_terms") or "").split("|"):
                key = term_key(raw)
                if key:
                    sub_map.setdefault(key, set()).add(spec)
    return out


def load_specialty_names(csv_path: str) -> Dict[str, Set[str]]:
    """``specialty_id -> {folded+singular token of its own specialty_ar}``.

    Used to tell a *safe* sub-default (the sub's activity word is literally this
    specialty's own name, e.g. «شاورما» → ``food.fast_food.shawarma``) from a
    *narrow* one (a sub-umbrella word, e.g. «مستلزمات طبية», pinned to one
    specialty among many siblings — narrower than the name actually says).
    """
    out: Dict[str, Set[str]] = {}
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            spec = (row.get("specialty_id") or "").strip()
            if not spec:
                continue
            out.setdefault(spec, set()).update(_norm_tokens(row.get("specialty_ar")))
    return out


def load_concepts(csv_path: str) -> Dict[str, str]:
    """``specialty_id -> concept_id`` from ``specialty_concepts.csv``."""
    out: Dict[str, str] = {}
    if not csv_path or not os.path.isfile(csv_path):
        return out
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            spec = (row.get("specialty_id") or "").strip()
            concept = (row.get("concept_id") or "").strip()
            if spec and concept:
                out[spec] = concept
    return out


#: connector prefixes in sub labels — «بقالة وتموينات», «إطارات وجنوط» etc.
_PFX = ("وال", "بال", "لل", "ال")
_PFX1 = ("و", "ل", "ب")


def _activity_token_variants(folded_tok: str) -> Set[str]:
    """Singular forms of a sub-label token, with leading «و/ل/ب/ال» stripped.

    Sub labels join trades with connectors («بقالة *و*تموينات»), so the activity
    noun arrives prefixed; we add the stripped form so it meets the bare match
    term (تموينات).
    """
    out = {_singular(folded_tok)}
    for p in _PFX:
        if folded_tok.startswith(p) and len(folded_tok) - len(p) >= 3:
            out.add(_singular(folded_tok[len(p):]))
    for p in _PFX1:
        if folded_tok.startswith(p) and len(folded_tok) - 1 >= 3:
            out.add(_singular(folded_tok[1:]))
    return out


def load_sub_labels(csv_path: str) -> Dict[str, Set[str]]:
    """``sub_id -> {activity token, ...}`` folded from ``sub_ar``.

    These are the sub's own activity words (e.g. مغسلة for ``personal.laundry``);
    a term made only of them is the sub's generic "default" specialty word.
    """
    out: Dict[str, Set[str]] = {}
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            sub = (row.get("sub_id") or "").strip()
            if not sub or sub in out:
                continue
            toks: Set[str] = set()
            for raw in _fold(row.get("sub_ar")).split():
                for v in _activity_token_variants(raw):
                    if v and v not in GENERIC:
                        toks.add(v)
            out[sub] = toks
    return out


def default_term_keys(
    spec_map: Dict[str, Dict[str, Set[str]]],
    sub_labels: Dict[str, Set[str]],
) -> Dict[str, Set[str]]:
    """``sub_id -> {term_key, ...}`` for terms that are purely the sub's activity word."""
    out: Dict[str, Set[str]] = {}
    for sub, terms in spec_map.items():
        acts = sub_labels.get(sub) or set()
        if not acts:
            continue
        hit = {k for k in terms if all(tok in acts for tok in k.split())}
        if hit:
            out[sub] = hit
    return out


# --- classification (pure logic) ----------------------------------------------


#: classification_method values, most trustworthy first.
METHOD_DISTINCTIVE = "name_specialty"                       # a distinctive term named it
METHOD_SUB_DEFAULT = "name_specialty_sub_default"           # sub's activity word == this specialty's own name (safe)
METHOD_SUB_DEFAULT_NARROW = "name_specialty_sub_default_narrow"  # sub-umbrella word, narrower than the name (doubtful)


def classify(
    name_en: Optional[str],
    name_ar: Optional[str],
    sub_id: Optional[str],
    spec_map: Dict[str, Dict[str, Set[str]]],
    default_terms: Optional[Dict[str, Set[str]]] = None,
    spec_names: Optional[Dict[str, Set[str]]] = None,
) -> Tuple[Optional[str], Optional[str]]:
    """Return ``(specialty_id, classification_method)`` the name agrees on, else ``(None, None)``.

    Scans 1–3-grams of ``name_en`` and ``name_ar`` against the term map of
    ``sub_id`` **only**. If every matched term points to one specialty, returns
    it; disagreement (or no match, or unknown sub) returns ``(None, None)``.

    Method tiers:
      * ``name_specialty`` — a *distinctive* term (not the sub's activity word) named it.
      * ``name_specialty_sub_default`` — the only matches were the sub's activity
        word, but that word is literally this specialty's own name (شاورما →
        shawarma): a safe default.
      * ``name_specialty_sub_default_narrow`` — the only matches were a sub-umbrella
        word that is *not* this specialty's name (مستلزمات طبية pinned to one of
        many siblings): narrower than the name says, so doubtful. Only emitted
        when ``spec_names`` is given; otherwise such a row stays ``sub_default``.
    """
    sub_map = spec_map.get((sub_id or "").strip())
    if not sub_map:
        return None, None
    specialties: Set[str] = set()
    matched: Set[str] = set()
    for name in (name_en, name_ar):
        if not name:
            continue
        for g in _grams(name):
            hit = sub_map.get(g)
            if hit:
                specialties |= hit
                matched.add(g)
                if len(specialties) > 1:
                    return None, None
    if len(specialties) != 1:
        return None, None
    spec = next(iter(specialties))
    dts = (default_terms or {}).get((sub_id or "").strip(), set())
    if any(g not in dts for g in matched):
        return spec, METHOD_DISTINCTIVE
    # all matches were the sub's activity word: safe iff one of them is this
    # specialty's own name; narrow (doubtful) iff it is only the sub umbrella.
    if spec_names is not None:
        own = spec_names.get(spec, set())
        safe = any(all(tok in own for tok in g.split()) for g in matched)
        return spec, (METHOD_SUB_DEFAULT if safe else METHOD_SUB_DEFAULT_NARROW)
    return spec, METHOD_SUB_DEFAULT


# --- delta build (duckdb) -----------------------------------------------------


def _confident_sql() -> str:
    """SQL predicate for a confident served sub_id (mirrors the Python guard)."""
    return (
        "(coalesce(sub_id,'') <> '' "
        "AND lower(trim(coalesce(cls_confidence,''))) IN ('high','medium') "
        "AND sub_id NOT LIKE 'unc.%' "
        "AND NOT ends_with(sub_id, '_general'))"
    )


def build(
    targets_path: str,
    specialties_path: str,
    concepts_path: Optional[str],
    out_path: str,
    memory_limit: str = "10GB",
    threads: int = 6,
    temp_directory: Optional[str] = None,
    batch_rows: int = 100_000,
) -> int:
    """Build the delta ``[poi_key, specialty_from_name, specialty_concept_from_name,
    classification_method]`` for confident-sub + empty-specialty POIs.

    The folding + singularisation rules live only in the pure-Python
    :func:`classify`; duckdb is used to *select* the candidate rows and to *write*
    the result, not to re-implement the lexicon match. This keeps one normalisation
    path and makes the logic unit-testable without duckdb.
    """
    import duckdb

    spec_map = load_specialties(specialties_path)
    sub_labels = load_sub_labels(specialties_path)
    default_terms = default_term_keys(spec_map, sub_labels)
    spec_names = load_specialty_names(specialties_path)
    concept_of = load_concepts(concepts_path) if concepts_path else {}

    # Separate read/write connections: issuing a write on the write connection
    # must not invalidate the open streaming read cursor.
    rcon = duckdb.connect()
    wcon = duckdb.connect()
    for con in (rcon, wcon):
        con.execute(f"PRAGMA memory_limit='{memory_limit}'")
        con.execute(f"PRAGMA threads={threads}")
        if temp_directory:
            con.execute(f"SET temp_directory='{temp_directory}'")

    wcon.execute(
        "CREATE TEMP TABLE delta(poi_key VARCHAR, specialty_from_name VARCHAR, "
        "specialty_concept_from_name VARCHAR, classification_method VARCHAR)"
    )

    cur = rcon.execute(
        f"""
        SELECT poi_key, name_en, name_ar, sub_id
        FROM read_parquet('{targets_path}')
        WHERE {_confident_sql()}
          AND (specialty_ids IS NULL OR trim(specialty_ids) = '')
          AND (name_en IS NOT NULL OR name_ar IS NOT NULL)
        """
    )

    total = 0
    while True:
        rows = cur.fetchmany(batch_rows)
        if not rows:
            break
        emit: List[Tuple[str, str, Optional[str], str]] = []
        for poi_key, name_en, name_ar, sub_id in rows:
            spec, method = classify(name_en, name_ar, sub_id, spec_map, default_terms, spec_names)
            if spec:
                emit.append((poi_key, spec, concept_of.get(spec), method))
        if emit:
            wcon.executemany("INSERT INTO delta VALUES (?, ?, ?, ?)", emit)
            total += len(emit)

    wcon.execute(f"COPY (SELECT * FROM delta) TO '{out_path}' (FORMAT PARQUET)")
    rcon.close()
    wcon.close()
    return total


# --- reporting helpers --------------------------------------------------------


def sub_default_flags(
    spec_map: Dict[str, Dict[str, Set[str]]],
    default_terms: Dict[str, Set[str]],
    spec_names: Optional[Dict[str, Set[str]]] = None,
) -> List[Tuple[str, str, List[str]]]:
    """``[(sub_id, specialty_id, [term_key, ...]), ...]`` for owner approval.

    Every specialty reachable *only* through the sub's generic activity word.
    These assign one "default" specialty to any POI whose name is just the trade
    noun, so they need owner sign-off before publish.
    """
    out: List[Tuple[str, str, List[str]]] = []
    for sub, dkeys in sorted(default_terms.items()):
        by_spec: Dict[str, List[str]] = {}
        for k in dkeys:
            for spec in sorted(spec_map[sub][k]):
                by_spec.setdefault(spec, []).append(k)
        for spec in sorted(by_spec):
            out.append((sub, spec, sorted(by_spec[spec])))
    return out


def narrow_default_flags(
    spec_map: Dict[str, Dict[str, Set[str]]],
    default_terms: Dict[str, Set[str]],
    spec_names: Dict[str, Set[str]],
) -> List[Tuple[str, str, List[str]]]:
    """The *doubtful* subset of :func:`sub_default_flags`.

    A (sub, specialty) pair whose only triggering terms are sub-umbrella words
    that are **not** the specialty's own name — so the bare trade noun is being
    pinned to one narrow sibling (e.g. «مستلزمات طبية» → ``…disposables`` among
    38 siblings). These are the ones most likely to mislead and want separate
    owner sign-off.
    """
    out: List[Tuple[str, str, List[str]]] = []
    for sub, spec, terms in sub_default_flags(spec_map, default_terms):
        own = spec_names.get(spec, set())
        if not any(all(tok in own for tok in k.split()) for k in terms):
            out.append((sub, spec, terms))
    return out


_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_TAX = os.path.join(_HERE, "..", "..", "docs", "qa", "targeting", "taxonomy")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Build the conservative name→specialty fill delta."
    )
    ap.add_argument("--base", default="/app/data/releases/atlas-2026-11-03-v16-namecat/targets.parquet")
    ap.add_argument("--specialties", default="/app/data/taxonomy/specialties.csv")
    ap.add_argument("--concepts", default="/app/data/taxonomy/specialty_concepts.csv")
    ap.add_argument("--out", default="/tmp/specialty_from_name.parquet")
    ap.add_argument("--temp-directory", default=None)
    ap.add_argument("--flags", action="store_true", help="print the sub-default specialties for owner approval and exit")
    args = ap.parse_args()

    if args.flags:
        sm = load_specialties(args.specialties)
        dts = default_term_keys(sm, load_sub_labels(args.specialties))
        names = load_specialty_names(args.specialties)
        flags = sub_default_flags(sm, dts)
        narrow = narrow_default_flags(sm, dts, names)
        narrow_set = {(s, sp) for s, sp, _ in narrow}
        print(f"{len(flags)} sub-default specialties "
              f"({len(flags) - len(narrow)} safe [word == specialty name], "
              f"{len(narrow)} NARROW [doubtful, separate approval]):")
        for sub, spec, terms in flags:
            tier = "NARROW" if (sub, spec) in narrow_set else "safe  "
            print(f"  {tier}\t{sub}\t{spec}\t{'|'.join(terms)}")
        raise SystemExit(0)

    n = build(args.base, args.specialties, args.concepts, args.out, temp_directory=args.temp_directory)
    print(f"wrote {n} delta rows -> {args.out}")
