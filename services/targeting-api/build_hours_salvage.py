"""Salvage POI working-hours whose raw text was corrupted by a day-name leak.

Atlas data-quality workstream #2 follow-up (hours salvage, internal/no-cost).

`build_hours_canonical` already parses every well-formed hours shape (258,081
POIs). A residual slice of raw ``working_hours`` strings fails to parse because
a single hour digit was clobbered by a day name during an upstream render, e.g.

    "Sun: 9:30 AM–Wed:30 PM"     (end hour 4 -> "Wed")
    "Sun: 8 AM–1Sun:59 PM"       (end hour 11, ones digit 1 -> "Sun")
    "Sun: Tue:30–Fri:30 PM"      (start 3 -> "Tue", end 6 -> "Fri")

The corruption is fully deterministic and reversible:

* It only ever hits the HOURS digit sitting immediately left of the ``:MM``
  colon, and only when that digit is in 1..7. Digits 0, 8, 9 (and the tens
  digit of a two-digit hour) are never day-mappable, so they survive verbatim
  — which is why two-digit hours keep their leading "1" ("1Sun:59" = "11:59").
* The mapping is the canonical day order, one-based:
  Sun->1, Mon->2, Tue->3, Wed->4, Thu->5, Fri->6, Sat->7  (= DAYS.index + 1).
* A legitimate day LABEL is always written "Day: " (colon then a space, e.g.
  "Fri: Closed"), whereas a corrupted hour is "Day:" + a digit. A ``:\\d``
  look-ahead therefore separates the two with no false positives.

After correcting the text we run the SAME ``build_hours_canonical`` parser, so
the output schema is byte-identical to the canonical delta. Only POIs that are
NOT already in ``hours_canonical.parquet`` are emitted, and ``hours_source`` is
stamped ``farq_salvaged`` so the provenance of a reconstructed value is explicit
(quality is never better than the raw-string tier, i.e. "medium"/"low").

Pure-stdlib corrector (``correct_hours_text`` / ``salvage_row``) so it imports
and tests without the data layer; ``build_delta()`` / ``main()`` use duckdb +
pyarrow and only run when invoked as a script.
"""
from __future__ import annotations

import json
import re

from build_hours_canonical import DAYS, canonical_hours

SALVAGE_SOURCE = "farq_salvaged"

# day name immediately followed by ":" + a digit == a clobbered hour digit.
# (A real day label is "Day: " / "Day:Closed" — colon then a non-digit.)
_DAY_LEAK_RE = re.compile(r"(?i)(?<![A-Za-z])(sun|mon|tue|wed|thu|fri|sat)(?=:\d)")

# Sun->"1" .. Sat->"7"  (one-based canonical day order).
_DAY_TO_DIGIT = {d: str(i + 1) for i, d in enumerate(DAYS)}

# narrow no-break space / RTL mark that Google-style exports sprinkle in.
_WS_FIXUP = {" ": " ", "‏": "", "‎": "", "\xa0": " "}


def has_day_leak(text) -> bool:
    """True if `text` carries at least one day-name-in-hour-position corruption."""
    if not text or ":" not in text:
        return False
    return _DAY_LEAK_RE.search(_normalize_ws(text)) is not None


def _normalize_ws(text: str) -> str:
    for bad, good in _WS_FIXUP.items():
        text = text.replace(bad, good)
    return text


def correct_hours_text(text):
    """Reconstruct the real hour digits from a day-leak-corrupted hours string.

    Returns the corrected string. If `text` has no corruption, the only change
    is whitespace normalisation (narrow no-break space -> plain space); callers
    that need to know whether anything was actually salvaged should check
    :func:`has_day_leak` first.
    """
    if text is None:
        return None
    norm = _normalize_ws(text)
    return _DAY_LEAK_RE.sub(lambda m: _DAY_TO_DIGIT[m.group(1).lower()], norm)


def salvage_row(row: dict):
    """Salvage one POI row's hours from corrupted ``working_hours``.

    Returns the canonical fields dict (hours_week / hours_source /
    hours_quality / is_24h / closed_days) with ``hours_source`` stamped
    ``farq_salvaged``, or None when the row has no day-leak corruption or the
    corrected text still does not parse.
    """
    raw = row.get("working_hours")
    if not has_day_leak(raw):
        return None
    corrected = correct_hours_text(raw)
    # Feed only the corrected raw string through the canonical parser so the
    # output is identical in shape to the canonical delta.
    res = canonical_hours({"working_hours": corrected})
    if res is None:
        return None
    res["hours_source"] = SALVAGE_SOURCE
    return res


# --------------------------------------------------------------------------- #
# Delta build (script-only; needs duckdb + pyarrow)
# --------------------------------------------------------------------------- #
BASE_PARQUET = "/Volumes/farq/release_build/atlas-2026-11-02-v8-unified/targets.parquet"
CANONICAL_DELTA = ("/private/tmp/claude-501/-Users-m4pro-FARQ-B2B/"
                   "4d8ec590-15eb-4dfe-b0a1-9b98dc411188/scratchpad/v10/deltas/"
                   "hours_canonical.parquet")
DELTA_OUT = ("/private/tmp/claude-501/-Users-m4pro-FARQ-B2B/"
             "4d8ec590-15eb-4dfe-b0a1-9b98dc411188/scratchpad/v10/deltas/"
             "hours_salvage.parquet")
TMP_DIR = "/Volumes/farq/_duckdb_tmp"


def build_delta(base_parquet=BASE_PARQUET, canonical_delta=CANONICAL_DELTA,
                out_path=DELTA_OUT, limit=None):
    import duckdb
    import pyarrow as pa
    import pyarrow.parquet as pq

    con = duckdb.connect()
    con.execute(f"SET temp_directory='{TMP_DIR}'")

    # Only rows that (a) carry the day-leak signature in working_hours and
    # (b) are NOT already covered by the canonical hours delta.
    leak = r"(?i)(sun|mon|tue|wed|thu|fri|sat):[0-9]"
    q = f"""
        SELECT poi_key, working_hours
        FROM read_parquet('{base_parquet}') b
        WHERE b.working_hours IS NOT NULL
          AND regexp_matches(b.working_hours, '{leak}')
          AND b.poi_key NOT IN (SELECT poi_key FROM read_parquet('{canonical_delta}'))
    """
    if limit:
        q += f" LIMIT {int(limit)}"
    cur = con.execute(q)
    names = [d[0] for d in cur.description]

    out = {k: [] for k in ["poi_key", "hours_week", "hours_source",
                           "hours_quality", "is_24h"]}
    total = 0
    recovered = 0
    q_counts = {}
    while True:
        batch = cur.fetchmany(50000)
        if not batch:
            break
        for rec in batch:
            total += 1
            row = dict(zip(names, rec))
            res = salvage_row(row)
            if res is None:
                continue
            recovered += 1
            q_counts[res["hours_quality"]] = q_counts.get(res["hours_quality"], 0) + 1
            out["poi_key"].append(row["poi_key"])
            out["hours_week"].append(res["hours_week"])
            out["hours_source"].append(res["hours_source"])
            out["hours_quality"].append(res["hours_quality"])
            out["is_24h"].append(res["is_24h"])

    table = pa.table({
        "poi_key": pa.array(out["poi_key"]),
        "hours_week": pa.array(out["hours_week"], type=pa.string()),
        "hours_source": pa.array(out["hours_source"], type=pa.string()),
        "hours_quality": pa.array(out["hours_quality"], type=pa.string()),
        "is_24h": pa.array(out["is_24h"], type=pa.bool_()),
    })
    pq.write_table(table, out_path, compression="zstd")
    return {"candidates": total, "recovered": recovered,
            "quality_counts": q_counts, "out_path": out_path}


def main():
    stats = build_delta()
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
