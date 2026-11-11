# -*- coding: utf-8 -*-
"""Confidence upgrade for `open` operating-status verdicts (status agent improvement #3).

The status vote (:mod:`build_status_vote`) classifies most `open` POIs at **low**
confidence, because a single weak signal (one Google review, one active-license row)
decided them.  This module raises that confidence — and only the confidence — when the
*same* POI is independently corroborated inside the base, using two signals the data
already carries.  No external or paid source is consulted, and no status is invented:
corroboration moves `low -> medium` or `medium -> high`, nothing else.

Two independent internal corroboration signals (owner: المستخدم أولاً — رقم أقوى، لا رقم جديد):
  * **delivery signal** – ``delivery_eta`` or ``delivery_rating`` present.  A live delivery
    ETA/rating is direct evidence the business is operating now (~5k POIs).
  * **multi-source** – ``source_count >= 2``.  The POI is attested by at least two
    independent sources, so the `open` verdict is about a real, corroborated entity.

Either signal lifts the verdict one rung on the ladder ``low -> medium -> high``.  Having
both strengthens the recorded reason; it never double-jumps (``low`` can reach ``medium``,
not ``high``, in one pass — conservative and honest).

Guards (فرق ثانياً — لا نناقض حكماً مغلقاً):
  * Only ``status_voted = 'open'`` rows are ever touched.  inactive / closed_temporary /
    closed_permanent verdicts are left exactly as the vote set them.
  * A POI is skipped (never upgraded) when the base itself carries a *closed* signal —
    ``company_status``/``lifecycle_state`` normalising to closed_permanent/closed_temporary,
    or ``temp_closed = true`` — even if the vote said open.  Corroboration must not paper
    over a direct contradiction.
  * Rows with no qualifying signal produce no output: the delta holds only genuine upgrades.

Python (:func:`upgrade_row`) and DuckDB SQL (the ``*_SQL`` constants) implement the same
rules; the test asserts they agree, as in :mod:`build_status_vote`.
"""
from status_policy import CLASS_SQL, normalize

DELTA_COLUMNS = ["poi_key", "status_confidence_upgraded", "upgrade_reason"]

# One rung up the confidence ladder. Only `open` verdicts (low/medium) are ever upgraded.
LADDER_UP = {"low": "medium", "medium": "high"}

# A base-level "closed" signal that blocks any upgrade of the vote.
_BASE_CLOSED = frozenset({"closed_permanent", "closed_temporary"})


# ---- the upgrade in Python ------------------------------------------------------------------------

def _present(v):
    return v is not None and str(v).strip() != ""


def _delivery_signal(row):
    """A live delivery ETA or rating => the business is operating."""
    return _present(row.get("delivery_eta")) or row.get("delivery_rating") is not None


def _multi_source(row):
    """Attested by >= 2 independent sources."""
    sc = row.get("source_count")
    return sc is not None and sc >= 2


def _base_closed(row):
    """The base carries a direct closed signal; never upgrade such a POI."""
    cls = normalize(row.get("company_status"), row.get("lifecycle_state"))["status_normalized"]
    return cls in _BASE_CLOSED or row.get("temp_closed") is True


def upgrade_row(row):
    """-> (status_confidence_upgraded, upgrade_reason), or None when no upgrade applies.

    ``row`` merges the status-vote fields (status_voted, status_voted_confidence) with the
    base signals (delivery_eta, delivery_rating, source_count, company_status,
    lifecycle_state, temp_closed).
    """
    if row.get("status_voted") != "open":
        return None
    nxt = LADDER_UP.get(row.get("status_voted_confidence"))
    if nxt is None:                      # already high / none -> nothing to raise
        return None
    if _base_closed(row):                # contradiction guard
        return None
    delivery, multi = _delivery_signal(row), _multi_source(row)
    if not (delivery or multi):          # no independent corroboration
        return None
    reason = "+".join([t for t, on in (("delivery_signal", delivery), ("multi_source", multi)) if on])
    return (nxt, reason)


# ---- the same upgrade in DuckDB SQL ---------------------------------------------------------------
DELIVERY_SQL = "((delivery_eta is not null and trim(delivery_eta)<>'') or delivery_rating is not null)"
MULTI_SOURCE_SQL = "(source_count>=2)"
QUALIFIES_SQL = f"({DELIVERY_SQL} or {MULTI_SOURCE_SQL})"
BASE_CLOSED_SQL = f"({CLASS_SQL} in ('closed_permanent','closed_temporary') or temp_closed is true)"

# Row is eligible for an upgrade (predicate used by build() and by the agreement test).
ELIGIBLE_SQL = (
    "(status_voted='open'"
    " and status_voted_confidence in ('low','medium')"
    f" and not {BASE_CLOSED_SQL}"
    f" and {QUALIFIES_SQL})"
)

UPGRADED_SQL = (
    "case status_voted_confidence when 'low' then 'medium' when 'medium' then 'high' end"
)

# Only evaluated on eligible rows, so at least one of the two signals is present.
REASON_SQL = (
    f"case when {DELIVERY_SQL} and {MULTI_SOURCE_SQL} then 'delivery_signal+multi_source'"
    f" when {DELIVERY_SQL} then 'delivery_signal'"
    " else 'multi_source' end"
)


def build(targets_path, vote_path, out_path, memory_limit="8GB", threads=6, temp_directory=None):
    """Write the confidence-upgrade delta parquet. Only genuinely upgraded `open` rows."""
    import duckdb

    conn = duckdb.connect()
    conn.execute(f"SET memory_limit='{memory_limit}'; SET threads={threads};")
    if temp_directory:
        conn.execute(f"SET temp_directory='{temp_directory}';")
    sql = f"""
    copy (
      select v.poi_key,
             ({UPGRADED_SQL}) as status_confidence_upgraded,
             ({REASON_SQL})   as upgrade_reason
      from read_parquet('{vote_path}') v
      join read_parquet('{targets_path}') b using (poi_key)
      where {ELIGIBLE_SQL}
    ) to '{out_path}' (format parquet)
    """
    conn.execute(sql)
    n = conn.execute("select count(*) from read_parquet(?)", [out_path]).fetchone()[0]
    conn.close()
    return n


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build the status-confidence upgrade delta parquet.")
    ap.add_argument("--targets", required=True)
    ap.add_argument("--vote", required=True, help="status_vote.parquet delta")
    ap.add_argument("--out", required=True)
    ap.add_argument("--temp-dir", default=None)
    a = ap.parse_args()
    rows = build(a.targets, a.vote, a.out, temp_directory=a.temp_dir)
    print(f"wrote {rows} rows -> {a.out}")
