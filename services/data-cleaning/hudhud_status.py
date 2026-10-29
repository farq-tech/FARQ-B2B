"""Mark places HudHud's surveyors closed: each place's current state in the full HudHud change-request database.

A step after the golden export and the HudHud fill, before publishing, like chain_consensus.py and hudhud_fill.py. Rules:
- only places live in HudHud (`ready to publish`, not deleted) whose current status is `permanently closed` or
  `temporary closed`;
- the snapshot's company_status is written only when it is empty or a lighter closure (a permanent closure outranks a
  temporary one); any other value is left as it is, and no place is reopened;
- the values are the ones status_policy.py reads: `permanently_closed` (hidden from search, map and campaigns) and
  `temporarily_closed` (shown labelled; a campaign may still reach it, owner decision of 2026-10-15 in SEND_CLASSES);
- `company_status_source` names the source and the date of HudHud's state, e.g. `hudhud_cr:2025-08-28`.
The script refuses to write if any column other than these two changes, or the row count differs.

Reads the snapshot and the database (read-only); writes a new snapshot and a report next to it. Never writes over its input
or the served files.

    python3 hudhud_status.py --targets T.parquet --crs crs_fixed.duckdb --out T_closed.parquet
"""
import argparse
import collections
import json
import os
import sys

import pathlib

import duckdb

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'targeting-api'))
import status_policy  # noqa: E402

# HudHud's own values; a bare «closed» is a permanent closure, as import_crs_full.py and status_policy read it
CLOSURE = {'permanently closed': 'permanently_closed', 'closed': 'permanently_closed', 'temporary closed': 'temporarily_closed'}
# the snapshot's value is ranked by the shared status policy, so every spelling of a closure counts the same;
# a class missing here (open, inactive, hidden, invalid …) is never replaced
RANK = {'unknown_empty': 0, 'closed_temporary': 1, 'closed_permanent': 2}
WRITTEN = {'temporarily_closed': 1, 'permanently_closed': 2}


def decide(current, hudhud_status):
    """The status to write, or None to leave the snapshot's value. current: the snapshot's company_status."""
    new = CLOSURE.get((hudhud_status or '').strip().lower())
    now = RANK.get(status_policy.normalize(current)['status_normalized'])
    if not new or now is None:
        return None
    return new if WRITTEN[new] > now else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--targets', required=True)
    parser.add_argument('--crs', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    if os.path.abspath(args.out) == os.path.abspath(args.targets) or os.path.exists(args.out):
        sys.exit('refused: --out must be a new file, never the input or an existing snapshot')
    db = duckdb.connect()
    db.execute("SET threads=4")
    db.execute("SET memory_limit='8GB'")
    db.execute("SET preserve_insertion_order=false")
    db.execute(f"attach '{args.crs}' as c (read_only)")
    have = [name for name, *_ in db.execute(f"describe select * from read_parquet('{args.targets}')").fetchall()]
    if 'hudhud_id' not in have or 'company_status' not in have:
        sys.exit('refused: the snapshot has no hudhud_id or company_status column')
    # one row per place, as in hudhud_fill.py: the most recently updated CR row, used whole
    hudhud = {hid: (status, at) for hid, state, deleted, status, at in db.execute("""
        select split_part(cr_entity_id::varchar, '.', 1), trx_state, trx_is_deleted::varchar, trx_status, left(trx_updated_at::varchar, 10)
        from c.crs qualify row_number() over (partition by split_part(cr_entity_id::varchar, '.', 1)
                                              order by trx_updated_at desc nulls last, cr_created_at desc, cr_id desc) = 1""").fetchall()
        if state == 'ready to publish' and str(deleted).lower() != 'true'}
    changes, kept = [], collections.Counter()
    for hid, current in db.execute(f"select cast(hudhud_id as varchar), company_status from read_parquet('{args.targets}') where hudhud_id is not null").fetchall():
        status, at = hudhud.get(hid, (None, None))
        if CLOSURE.get((status or '').strip().lower()):
            new = decide(current, status)
            if new:
                changes.append((hid, new, f'hudhud_cr:{at}' if at else 'hudhud_cr', current or ''))
            else:
                kept[f"{CLOSURE[status.strip().lower()]}|release_already={current or '(empty)'}"] += 1

    db.execute("create table ch(hid varchar, status varchar, source varchar, before varchar)")
    if changes:   # nothing to change still writes the unchanged copy and its report
        db.executemany("insert into ch values (?, ?, ?, ?)", changes)
    db.execute(f"create table t as select * from read_parquet('{args.targets}')")
    if 'company_status_source' not in have:
        db.execute("alter table t add column company_status_source varchar")
    db.execute("""update t set company_status = ch.status, company_status_source = ch.source
                  from ch where ch.hid = cast(t.hudhud_id as varchar)""")

    # nothing else may move: every other column is compared with the input
    other = [c for c in have if c not in ('company_status', 'company_status_source')]
    changed = db.execute(f"""select count(*) from read_parquet('{args.targets}') o join t using (poi_key)
        where {' or '.join(f'o."{c}"::varchar is distinct from t."{c}"::varchar' for c in other if c != 'poi_key')}""").fetchone()[0]
    count = db.execute(f"select (select count(*) from read_parquet('{args.targets}')), (select count(*) from t)").fetchone()
    if changed or count[0] != count[1]:
        sys.exit(f'refused: {changed} rows changed outside company_status, or rows {count} differ')
    db.execute(f"copy t to '{args.out}' (format parquet, compression zstd)")

    report = {
        'input': args.targets, 'output': args.out, 'rows': count[1],
        'written': dict(collections.Counter(f'{before or "(empty)"} -> {status}' for _, status, _, before in changes)),
        'left_as_is': dict(kept),
        'written_by_city': dict(collections.Counter(c or '(none)' for (c,) in db.execute(
            "select t.city_en from t join ch on ch.hid = cast(t.hudhud_id as varchar)").fetchall()).most_common(10)),
        'other_columns_changed': changed,
    }
    with open(os.path.splitext(args.out)[0] + '.report.json', 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
