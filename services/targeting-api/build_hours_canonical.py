"""Consolidate all POI working-hours sources into ONE structured weekly schema.

Atlas data-quality workstream #2 (hours + "open now").

The base targets table carries opening hours in four different, overlapping
shapes, only ~10% of POIs have any of them, and no screen can answer
"open now?" from them. This module parses every shape into a single canonical
weekly schema and provides a pure `open_now` function on top of it.

Canonical schema (per POI)
--------------------------
hours_week : JSON object, keys "sun".."sat" (Asia/Riyadh local, 24h).
             Each value is a list of [start, end] pairs, "HH:MM".
             - Closed day        -> []
             - Open all day       -> [["00:00", "24:00"]]
             - Split shift        -> [["09:00","12:00"], ["16:00","21:00"]]
             - Overnight (wraps)  -> [["16:00","02:00"]]  (end <= start)
             End "00:00" from a source is normalised to "24:00" (midnight close).
is_24h      : bool  - all seven days are exactly [["00:00","24:00"]].
closed_days : list  - day keys with no intervals.
hours_source: str   - which source won (farq_clean / farq_perday / urbi /
                      farq_raw / rcrc).
hours_quality: str  - high / medium / low confidence in the canonical result.

Everything here is pure stdlib (json, re, datetime, zoneinfo) so it imports
without the data layer; `build_delta()` / `main()` use duckdb + pyarrow and
only run when invoked as a script.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

RIYADH = ZoneInfo("Asia/Riyadh")

DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

# datetime.weekday(): Mon=0 .. Sun=6  ->  our keys
_WEEKDAY_TO_KEY = {0: "mon", 1: "tue", 2: "wed", 3: "thu", 4: "fri", 5: "sat", 6: "sun"}

# label -> key, for labelled strings "Sun: .. | Mon: .."
_LABEL_TO_KEY = {
    "sun": "sun", "sunday": "sun",
    "mon": "mon", "monday": "mon",
    "tue": "tue", "tues": "tue", "tuesday": "tue",
    "wed": "wed", "weds": "wed", "wednesday": "wed",
    "thu": "thu", "thur": "thu", "thurs": "thu", "thursday": "thu",
    "fri": "fri", "friday": "fri",
    "sat": "sat", "saturday": "sat",
    # Arabic day names (robustness; data seen so far is ASCII)
    "الاحد": "sun", "الأحد": "sun",
    "الاثنين": "mon", "الإثنين": "mon",
    "الثلاثاء": "tue",
    "الاربعاء": "wed", "الأربعاء": "wed",
    "الخميس": "thu",
    "الجمعة": "fri",
    "السبت": "sat",
}

_CLOSED_TOKENS = {"", "-", "{}", "closed", "مغلق", "مغلقة", "off"}
_ALLDAY_TOKENS = {"24h", "24hr", "24hrs", "24hours", "24 hrs", "open24", "24/7"}

FULL_DAY = ["00:00", "24:00"]


# --------------------------------------------------------------------------- #
# Time-token parsing
# --------------------------------------------------------------------------- #
def _to_min(tok: str):
    """Parse a single clock token into minutes-since-midnight (0..1440).

    Accepts "HH:MM", "H:MM", "HH", "9a.m", "9:30pm", "١٢:٣٠" (Arabic digits),
    with optional am/pm. Returns None if unparseable. Midnight-as-end ("00:00"
    when it closes a range) is handled by the caller, not here.
    """
    if tok is None:
        return None
    t = tok.strip().lower()
    # normalise Arabic-Indic digits
    t = t.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789"))
    t = t.replace(" ", " ").replace("‏", "").replace("ص", "am").replace("م", "pm")
    if not t:
        return None
    # pull am/pm marker
    ampm = None
    m = re.search(r"(a\.?m\.?|p\.?m\.?)", t)
    if m:
        ampm = "am" if m.group(1).startswith("a") else "pm"
        t = t[: m.start()] + t[m.end():]
    t = t.strip().strip(".")
    m = re.match(r"^(\d{1,2})(?::(\d{1,2}))?$", t)
    if not m:
        return None
    h = int(m.group(1))
    mi = int(m.group(2)) if m.group(2) is not None else 0
    if mi > 59:
        return None
    if ampm:
        if h == 12:
            h = 0 if ampm == "am" else 12
        elif ampm == "pm":
            h += 12
    if h == 24 and mi == 0:
        return 1440
    if h > 24:
        return None
    return h * 60 + mi


def _fmt(minutes: int) -> str:
    if minutes >= 1440:
        return "24:00"
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _parse_cell(cell: str):
    """Parse ONE day cell into a normalised list of [start,end] "HH:MM" pairs.

    Returns [] for a closed/empty cell, [["00:00","24:00"]] for all-day,
    or None if nothing parseable was found (lets the caller treat it as
    "no info" rather than "closed").
    """
    if cell is None:
        return []
    raw = cell.strip()
    low = raw.lower().replace(" ", "")
    if low in _CLOSED_TOKENS:
        return []
    if low in _ALLDAY_TOKENS or low.startswith("24hr") or low.startswith("24hour") or low == "24/7":
        return [list(FULL_DAY)]

    intervals = []
    found_any = False
    # split multiple intervals on comma or slash
    for part in re.split(r"[,/]", raw):
        part = part.strip()
        if not part:
            continue
        low_part = part.lower().replace(" ", "")
        if low_part in _CLOSED_TOKENS:
            continue
        if low_part in _ALLDAY_TOKENS or low_part.startswith("24hr") or low_part.startswith("24hour"):
            intervals.append(list(FULL_DAY))
            found_any = True
            continue
        # split start-end on hyphen / en/em dash / "to"
        m = re.split(r"\s*(?:-|–|—|to|الى|إلى)\s*", part, maxsplit=1)
        if len(m) != 2:
            continue
        s = _to_min(m[0])
        e = _to_min(m[1])
        if s is None or e is None:
            continue
        found_any = True
        # end "00:00" means midnight close -> 24:00
        if e == 0:
            e = 1440
        if s == 0 and e == 0:
            intervals.append(list(FULL_DAY))
            continue
        if s == e:
            # zero-length; skip unless it's a full-day sentinel already handled
            continue
        intervals.append([_fmt(s), _fmt(e)])
    if not found_any:
        return None
    return _merge(intervals)


def _merge(intervals):
    """Sort and merge overlapping/adjacent *non-overnight* intervals.

    Overnight intervals (end <= start after normalisation) are kept as-is and
    not merged, so wrap semantics survive.
    """
    normal, overnight = [], []
    for s, e in intervals:
        sm, em = _to_min(s), _to_min(e)
        if em <= sm:
            overnight.append([s, e])
        else:
            normal.append((sm, em))
    normal.sort()
    out = []
    for sm, em in normal:
        if out and sm <= out[-1][1]:
            out[-1][1] = max(out[-1][1], em)
        else:
            out.append([sm, em])
    merged = [[_fmt(sm), _fmt(em)] for sm, em in out]
    return merged + overnight


# --------------------------------------------------------------------------- #
# Source parsers -> hours_week dict (day key -> interval list)
# --------------------------------------------------------------------------- #
def _empty_week():
    return {d: [] for d in DAYS}


def _clean_cell(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def parse_perday(cells: dict):
    """cells: {"sun": "...", ..., "sat": "..."} of raw per-day strings."""
    week = _empty_week()
    got = False
    for d in DAYS:
        parsed = _parse_cell(_clean_cell(cells.get(d)) or "")
        if parsed is None:
            continue
        week[d] = parsed
        if parsed:
            got = True
    return week if got else None


def parse_week_string(s: str):
    """Parse a consolidated string: labelled ("Sun: 09:00-17:00 | Mon: ..")
    or positional ("09:00-24:00 | .. (Sun..Sat)"), separators | or ;.
    """
    s = _clean_cell(s)
    if not s:
        return None
    parts = [p.strip() for p in re.split(r"[|;]", s) if p.strip()]
    if not parts:
        return None
    week = _empty_week()
    labelled = False
    got = False
    positional = []
    for p in parts:
        m = re.match(r"^\s*([A-Za-z؀-ۿ]+)\s*:\s*(.*)$", p)
        if m and m.group(1).strip().lower() in _LABEL_TO_KEY:
            labelled = True
            key = _LABEL_TO_KEY[m.group(1).strip().lower()]
            parsed = _parse_cell(m.group(2))
            if parsed is None:
                continue
            # a day may legitimately recur; prefer first non-empty
            if parsed and not week[key]:
                week[key] = parsed
                got = True
            elif not week[key]:
                week[key] = parsed
        else:
            positional.append(p)
    if labelled:
        return week if got else None
    # positional: map first 7 cells onto Sun..Sat
    if len(positional) < 1:
        return None
    for i, cell in enumerate(positional[:7]):
        parsed = _parse_cell(cell)
        if parsed is None:
            continue
        week[DAYS[i]] = parsed
        if parsed:
            got = True
    return week if got else None


# --------------------------------------------------------------------------- #
# Canonical selection
# --------------------------------------------------------------------------- #
def _finalize(week: dict):
    """Return (hours_week_json, is_24h, closed_days) or None if week is empty."""
    if week is None:
        return None
    if not any(week[d] for d in DAYS):
        return None
    is_24h = all(week[d] == [list(FULL_DAY)] for d in DAYS)
    closed_days = [d for d in DAYS if not week[d]]
    ordered = {d: week[d] for d in DAYS}
    return json.dumps(ordered, ensure_ascii=False, separators=(",", ":")), is_24h, closed_days


def _parse_quality(week: dict, source: str) -> str:
    """Confidence in the canonical result."""
    open_days = sum(1 for d in DAYS if week[d])
    trusted = source in ("farq_clean", "farq_perday", "urbi")
    if trusted and open_days >= 5:
        return "high"
    if trusted and open_days >= 1:
        return "medium"
    if source == "farq_raw" and open_days >= 1:
        return "medium"
    return "low"


# source priority: cleaned labelled string > per-day cols > urbi per-day
#                   > raw consolidated string (best-effort) > rcrc single string
def canonical_hours(row: dict):
    """Pick the best source for one POI row and return the canonical fields.

    `row` keys used: working_hours_clean, hours_sun..hours_sat,
    urbi_sun_hours..urbi_sat_hours, working_hours, rcrc_work_hours.

    Returns dict {hours_week, hours_source, hours_quality, is_24h, closed_days}
    or None when no source yields any open interval.
    """
    attempts = []

    attempts.append(("farq_clean", parse_week_string(row.get("working_hours_clean"))))

    attempts.append(("farq_perday",
                     parse_perday({d: row.get(f"hours_{d}") for d in DAYS})))

    attempts.append(("urbi",
                     parse_perday({d: row.get(f"urbi_{d}_hours") for d in DAYS})))

    attempts.append(("farq_raw", parse_week_string(row.get("working_hours"))))

    rcrc = _clean_cell(row.get("rcrc_work_hours"))
    if rcrc:
        parsed = _parse_cell(rcrc)
        if parsed:
            attempts.append(("rcrc", {d: list(parsed) for d in DAYS}))

    for source, week in attempts:
        fin = _finalize(week)
        if fin is None:
            continue
        hours_week, is_24h, closed_days = fin
        return {
            "hours_week": hours_week,
            "hours_source": source,
            "hours_quality": _parse_quality(week, source),
            "is_24h": is_24h,
            "closed_days": closed_days,
        }
    return None


# --------------------------------------------------------------------------- #
# open_now  (pure)
# --------------------------------------------------------------------------- #
def _intervals_min(day_list):
    """Convert a day's [["HH:MM","HH:MM"],..] into [(start_min, end_min),..]."""
    out = []
    for s, e in day_list or []:
        sm = _to_min(s)
        em = _to_min(e)
        if sm is None or em is None:
            continue
        if em == 0:
            em = 1440
        out.append((sm, em))
    return out


def open_now(hours_week, now_dt):
    """Pure. Is the POI open at `now_dt` (Asia/Riyadh)?

    hours_week : dict or JSON string in the canonical schema.
    now_dt     : datetime; naive is interpreted as Asia/Riyadh local,
                 tz-aware is converted to Asia/Riyadh.

    Returns {"open": bool, "until": "HH:MM"|None, "opens_at": "HH:MM"|None}.
    `until` is the closing time of the interval currently in progress.
    `opens_at` is the clock time of the next opening when currently closed
    (scanning forward up to 7 days). Handles overnight ranges and split shifts.
    """
    if isinstance(hours_week, str):
        hours_week = json.loads(hours_week)
    hours_week = hours_week or {}

    if now_dt.tzinfo is None:
        now = now_dt.replace(tzinfo=RIYADH)
    else:
        now = now_dt.astimezone(RIYADH)

    cur = now.hour * 60 + now.minute
    today = _WEEKDAY_TO_KEY[now.weekday()]
    prev = _WEEKDAY_TO_KEY[(now.weekday() - 1) % 7]

    # 1) spillover from yesterday's overnight interval into today
    for sm, em in _intervals_min(hours_week.get(prev)):
        if em <= sm:  # overnight wrap -> today 00:00..em
            if cur < em:
                return {"open": True, "until": _fmt(em), "opens_at": None}

    # 2) today's intervals
    for sm, em in _intervals_min(hours_week.get(today)):
        if em <= sm:  # overnight starting today: open from sm..midnight
            if cur >= sm:
                return {"open": True, "until": _fmt(em), "opens_at": None}
        else:
            if sm <= cur < em:
                return {"open": True, "until": _fmt(em), "opens_at": None}

    # 3) closed now -> find next opening clock time, scan up to 7 days
    #    today first (starts strictly after now), then following days
    today_starts = sorted(
        sm for sm, em in _intervals_min(hours_week.get(today)) if sm > cur
    )
    if today_starts:
        return {"open": False, "until": None, "opens_at": _fmt(today_starts[0])}

    for ahead in range(1, 8):
        key = _WEEKDAY_TO_KEY[(now.weekday() + ahead) % 7]
        starts = sorted(sm for sm, em in _intervals_min(hours_week.get(key)))
        if starts:
            return {"open": False, "until": None, "opens_at": _fmt(starts[0])}

    return {"open": False, "until": None, "opens_at": None}


# --------------------------------------------------------------------------- #
# Delta build (script-only; needs duckdb + pyarrow)
# --------------------------------------------------------------------------- #
BASE_PARQUET = "/Volumes/farq/release_build/atlas-2026-11-02-v8-unified/targets.parquet"
DELTA_OUT = ("/private/tmp/claude-501/-Users-m4pro-FARQ-B2B/"
             "4d8ec590-15eb-4dfe-b0a1-9b98dc411188/scratchpad/v10/deltas/"
             "hours_canonical.parquet")
TMP_DIR = "/Volumes/farq/_duckdb_tmp"

_SRC_COLS = (["poi_key", "working_hours", "working_hours_clean", "rcrc_work_hours"]
             + [f"hours_{d}" for d in DAYS]
             + [f"urbi_{d}_hours" for d in DAYS])


def build_delta(base_parquet=BASE_PARQUET, out_path=DELTA_OUT, limit=None):
    import duckdb
    import pyarrow as pa
    import pyarrow.parquet as pq

    con = duckdb.connect()
    con.execute(f"SET temp_directory='{TMP_DIR}'")
    cols = ", ".join(_SRC_COLS)
    q = f"SELECT {cols} FROM read_parquet('{base_parquet}')"
    if limit:
        q += f" LIMIT {int(limit)}"
    cur = con.execute(q)
    names = [d[0] for d in cur.description]

    out = {k: [] for k in ["poi_key", "hours_week", "hours_source",
                           "hours_quality", "is_24h"]}
    total = 0
    matched = 0
    src_counts = {}
    while True:
        batch = cur.fetchmany(50000)
        if not batch:
            break
        for rec in batch:
            total += 1
            row = dict(zip(names, rec))
            res = canonical_hours(row)
            if res is None:
                continue
            matched += 1
            src_counts[res["hours_source"]] = src_counts.get(res["hours_source"], 0) + 1
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
    return {"total": total, "matched": matched, "src_counts": src_counts,
            "out_path": out_path}


def main():
    stats = build_delta()
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
