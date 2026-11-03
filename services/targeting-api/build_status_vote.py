# -*- coding: utf-8 -*-
"""Operating-status vote and freshness signal for every POI (improvements #1 + #13).

`company_status` is filled for only ~17% of the base (and ~99% of that is the literal
``unknown``).  This module derives a single best *operating status* for each POI by voting
across the signals the base already carries, and a *freshness* signal from the per-source
observation dates.  It never rewrites the originals: the vote is produced next to them, with
the source that decided it and a confidence, exactly like :mod:`status_policy`.

Design rules (owner / product foundation):
  * Target vocabulary is `status_policy` only:
    closed_permanent / closed_temporary / inactive / open / unknown_empty / unknown_invalid.
  * A missing signal stays «unknown», never a guess (المستخدم أولاً: «غير متاح»، لا تقدير).
    In particular an *expired license end-date* is NOT treated as closed: the whole municipal
    license snapshot is from 2023-2024, so dating-out would mislabel ~340k live POIs.  Only the
    curated ``license_expired`` boolean decides inactivity.
  * Python (`vote_row`) and DuckDB SQL (`VOTE_SQL`/`SOURCE_SQL`/`CONFIDENCE_SQL`) implement the
    same rules; the test asserts they agree.

Vote priority (first match wins):
  1. company_status normalises to closed_permanent            -> closed_permanent / company_status / high
  2. company_status normalises to closed_temporary            -> closed_temporary / company_status / high
  3. temp_closed = true                                       -> closed_temporary / temp_closed    / high
  4. license_expired = true                                   -> inactive         / commercial_license / low
  5. surveyor_verified_at present (physically surveyed)       -> open             / surveyor        / medium
  6. license_expired = false (license still active)           -> open             / commercial_license / low
  7. reviews_count > 0 or rating present (live Google record) -> open             / google_signals  / low
  8. company_status = a non-empty unrecognised value          -> unknown_invalid  / company_status  / none
  9. otherwise                                                -> unknown_empty    / none            / none

Freshness:
  last_seen_at = newest real observation date we hold = max(surveyor_verified_at date,
                 date embedded in company_status_source, e.g. ``hudhud_cr:2025-08-15``).
  is_stale     = last_seen_at older than STALE_AFTER_DAYS; NULL when we have no date
                 (unknown freshness is «غير متاح», not «fresh»).
"""
import datetime
import re

from status_policy import CLASS_SQL, normalize

# Freshness threshold. A code-review constant, not an environment variable.
STALE_AFTER_DAYS = 365

DELTA_COLUMNS = [
    "poi_key",
    "status_voted",
    "status_voted_source",
    "status_voted_confidence",
    "last_seen_at",
    "is_stale",
]

# ---- the vote in Python ---------------------------------------------------------------------------

def vote_row(row):
    """-> (status_voted, status_voted_source, status_voted_confidence)."""
    base = normalize(row.get("company_status"), row.get("lifecycle_state"))["status_normalized"]
    if base == "closed_permanent":
        return ("closed_permanent", "company_status", "high")
    if base == "closed_temporary":
        return ("closed_temporary", "company_status", "high")
    if row.get("temp_closed") is True:
        return ("closed_temporary", "temp_closed", "high")
    if row.get("license_expired") is True:
        return ("inactive", "commercial_license", "low")
    if _present(row.get("surveyor_verified_at")):
        return ("open", "surveyor", "medium")
    if row.get("license_expired") is False:
        return ("open", "commercial_license", "low")
    rc, rt = row.get("reviews_count"), row.get("rating")
    if (rc is not None and rc > 0) or rt is not None:
        return ("open", "google_signals", "low")
    if base == "unknown_invalid":
        return ("unknown_invalid", "company_status", "none")
    return ("unknown_empty", "none", "none")


DECIDED = frozenset({"open", "inactive", "closed_temporary", "closed_permanent"})


def _present(v):
    return v is not None and str(v).strip() != ""


_CS_DATE = re.compile(r":(\d{4}-\d{2}-\d{2})")


def _as_date(v):
    """Parse a surveyor timestamp or a plain date to a ``date``; None on failure."""
    if not _present(v):
        return None
    s = str(v)[:10]
    try:
        return datetime.date.fromisoformat(s)
    except ValueError:
        return None


def last_seen_at(row):
    """Newest real observation date we hold for the POI, or None."""
    dates = []
    d = _as_date(row.get("surveyor_verified_at"))
    if d:
        dates.append(d)
    m = _CS_DATE.search(str(row.get("company_status_source") or ""))
    if m:
        d = _as_date(m.group(1))
        if d:
            dates.append(d)
    return max(dates) if dates else None


def is_stale(seen, asof=None):
    """True/False when we have a date, None when freshness is unknown."""
    if seen is None:
        return None
    asof = asof or datetime.date.today()
    return (asof - seen).days > STALE_AFTER_DAYS


# ---- the same vote in DuckDB SQL ------------------------------------------------------------------
# ``CLASS_SQL`` already canonicalises company_status + lifecycle_state into the policy vocabulary.
_SURV_DATE = "try_cast(try_cast(surveyor_verified_at as timestamp) as date)"
_CS_DATE_SQL = (
    "try_strptime(regexp_extract(coalesce(company_status_source,''),':(\\d{4}-\\d{2}-\\d{2})',1),"
    "'%Y-%m-%d')::date"
)
LAST_SEEN_SQL = f"greatest({_SURV_DATE}, {_CS_DATE_SQL})"

# One ordered ladder shared by value / source / confidence so the three stay in lock-step.
# Each rung: (predicate, status, source, confidence).
_LADDER = [
    (f"{CLASS_SQL}='closed_permanent'", "closed_permanent", "company_status", "high"),
    (f"{CLASS_SQL}='closed_temporary'", "closed_temporary", "company_status", "high"),
    ("temp_closed=true", "closed_temporary", "temp_closed", "high"),
    ("license_expired=true", "inactive", "commercial_license", "low"),
    ("surveyor_verified_at is not null and trim(surveyor_verified_at)<>''", "open", "surveyor", "medium"),
    ("license_expired=false", "open", "commercial_license", "low"),
    ("(reviews_count>0 or rating is not null)", "open", "google_signals", "low"),
    (f"{CLASS_SQL}='unknown_invalid'", "unknown_invalid", "company_status", "none"),
]
_ELSE = ("unknown_empty", "none", "none")


def _case_sql(idx):
    arms = "\n".join(f"  when {pred} then '{vals[idx]}'" for (pred, *vals) in _LADDER)
    return f"case\n{arms}\n  else '{_ELSE[idx]}' end"


VOTE_SQL = _case_sql(0)
SOURCE_SQL = _case_sql(1)
CONFIDENCE_SQL = _case_sql(2)
IS_STALE_SQL = (
    f"case when {LAST_SEEN_SQL} is null then null "
    f"else (date_diff('day', {LAST_SEEN_SQL}, current_date) > {STALE_AFTER_DAYS}) end"
)

_DECIDED_SQL = "(" + ",".join(f"'{d}'" for d in sorted(DECIDED)) + ")"


def build(targets_path, out_path, memory_limit="8GB", threads=6, temp_directory=None):
    """Write the status-vote delta parquet. Rows only where we add a usable status or a date."""
    import duckdb

    conn = duckdb.connect()
    conn.execute(f"SET memory_limit='{memory_limit}'; SET threads={threads};")
    if temp_directory:
        conn.execute(f"SET temp_directory='{temp_directory}';")
    sql = f"""
    copy (
      with v as (
        select poi_key,
               ({VOTE_SQL}) as status_voted,
               ({SOURCE_SQL}) as status_voted_source,
               ({CONFIDENCE_SQL}) as status_voted_confidence,
               ({LAST_SEEN_SQL}) as last_seen_at,
               ({IS_STALE_SQL}) as is_stale
        from read_parquet(?)
      )
      select * from v
      where status_voted in {_DECIDED_SQL} or last_seen_at is not null
    ) to '{out_path}' (format parquet)
    """
    conn.execute(sql, [targets_path])
    n = conn.execute("select count(*) from read_parquet(?)", [out_path]).fetchone()[0]
    conn.close()
    return n


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build the operating-status vote delta parquet.")
    ap.add_argument("--targets", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--temp-dir", default=None)
    a = ap.parse_args()
    rows = build(a.targets, a.out, temp_directory=a.temp_dir)
    print(f"wrote {rows} rows -> {a.out}")
