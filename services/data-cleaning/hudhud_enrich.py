"""Add rich columns to a directory snapshot from each place's current state in the full HudHud change-request database.

A step after the golden export and before publishing, a sibling of hudhud_fill.py. Where hudhud_fill fills EXISTING empty
fields, this ADDS new columns that the directory does not carry yet, from the same per-place current state (trx_*). Rules,
kept identical to hudhud_fill so the two steps compose:
- a new column is added only where HudHud holds a valid value; every other row stays null;
- only places live in HudHud (`ready to publish`, not deleted) and not permanently closed are read;
- every value is checked by its pattern (a Google Maps URL, an http(s) logo URL, a 0-100 confidence) and a value that
  fails is left out, never guessed;
- an existing value is never changed: if a snapshot already carries one of these columns with a value, it is kept;
- `hudhud_enriched` lists the new columns each row took from HudHud (separate from hudhud_fill's `hudhud_filled`).

Columns added (none are in the served directory today):
- google_maps_url   — the place's Google Maps link, for verification and display;
- logo_url          — the brand/place logo URL (HudHud's store; mirror to our own storage is a separate step);
- hudhud_confidence — HudHud's own data-quality confidence for the record, 0-100 (a signal, not a classification).

verified_by_google is deliberately NOT added here: in the source it is a free-text Google listing status
(e.g. «Claim this business»), not a trust boolean, and needs its own analysis first.

Reads the snapshot and the database (read-only); writes a new snapshot and a report next to it. Never writes over its
input or the served files.

    python3 hudhud_enrich.py --targets T.parquet --crs crs_fixed.duckdb --out T_enriched.parquet
"""
import argparse
import collections
import json
import os
import re
import sys

import duckdb
from urllib.parse import urlparse

from hudhud_fill import text  # same emptiness rule as the fill step

# a Google host that owns Maps: google.<tld> or google.<cc>.<tld>, optionally www./maps. — anchored at both ends
# so an extra label (the attacker's www.google.com.evil.sa) never matches; the short links are listed outright
GOOGLE_HOST = re.compile(r'^(www\.|maps\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$')
SHORT_HOSTS = {'goo.gl', 'maps.app.goo.gl'}


def gmaps(v):
    """A Google Maps URL, or None. The host is parsed (not matched as a substring) and must be Google's own; the link
    must be a Maps one — a /maps path, a maps.* host, or a ?cid= place query. https only, bounded length.
    A backslash (a browser reads it as «/», so the real host would differ from the parsed one), whitespace, or any
    userinfo (`user@host`, which sends a browser to a different host than urlparse reads) rejects the URL."""
    v = text(v)
    if not v or len(v) > 600 or '\\' in v or any(c.isspace() for c in v):
        return None
    try:
        u = urlparse(v)
    except ValueError:
        return None
    if '@' in (u.netloc or '') or not (u.netloc or '').isascii():   # userinfo or a non-ascii authority: host is ambiguous
        return None
    host = (u.hostname or '').lower()
    if u.scheme != 'https' or not host:
        return None
    if host in SHORT_HOSTS:
        return v
    if GOOGLE_HOST.match(host) and (u.path.startswith('/maps') or host.startswith('maps.') or 'cid=' in (u.query or '')):
        return v
    return None


def logo(v):
    """An http(s) logo URL, or None."""
    v = text(v)
    return v if v and len(v) <= 600 and re.match(r'^https?://', v, re.I) else None


def confidence(v):
    """HudHud's record confidence as a 0-100 number (string form), or None outside the range."""
    v = text(v)
    if not re.match(r'^\d{1,3}(\.\d+)?$', v):
        return None
    f = float(v)
    return str(round(f, 1)) if 0 <= f <= 100 else None


# new column -> (trx source column, cleaner). SQL type of each new column:
NEW_FIELDS = {
    'google_maps_url': ('trx_google_url', gmaps),
    'logo_url': ('trx_logo', logo),
    'hudhud_confidence': ('trx_confidence', confidence),
}
COLTYPE = {'google_maps_url': 'varchar', 'logo_url': 'varchar', 'hudhud_confidence': 'double'}


def enrich(snapshot, hudhud):
    """snapshot: {hudhud_id: {column: value}} for the new columns as the snapshot has them (usually empty);
    hudhud: {hudhud_id: {trx column: value}}. Returns {hudhud_id: {column: new value}} and a Counter of refused values."""
    out, refused = {}, collections.Counter()
    for hid, row in snapshot.items():
        place = hudhud.get(hid)
        if not place or place['trx_state'] != 'ready to publish' or str(place['trx_is_deleted']).lower() == 'true' \
                or text(place['trx_status']) == 'permanently closed':
            continue
        new = {}
        for column, (source, clean) in NEW_FIELDS.items():
            if text(row.get(column)) or not text(place.get(source)):   # an existing value is kept; nothing to add is skipped
                continue
            value = clean(place[source])
            if value is not None:
                new[column] = value
            else:
                refused[column] += 1
        if new:
            out[hid] = new
    return out, refused


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

    have = {name for name, *_ in db.execute(f"describe select * from read_parquet('{args.targets}')").fetchall()}
    if 'hudhud_id' not in have:
        sys.exit('refused: the snapshot has no column hudhud_id')
    cols = list(NEW_FIELDS)
    # read the snapshot's current value of each new column (null/absent → empty), so a value already there is never changed
    present = [c for c in cols if c in have]
    sel = ', '.join([f'{c}::varchar' for c in present]) or 'NULL'
    snapshot = {hid: dict(zip(present, rest)) for hid, *rest in db.execute(
        f"select cast(hudhud_id as varchar), {sel} from read_parquet('{args.targets}') where hudhud_id is not null").fetchall()}

    trx = ['trx_state', 'trx_is_deleted', 'trx_status'] + sorted({s for s, _ in NEW_FIELDS.values()})
    hudhud = {hid: dict(zip(trx, rest)) for hid, *rest in db.execute(
        # one row per place: trx_* is the place's current state; the most recently updated row is taken (as hudhud_fill)
        f"""select split_part(cr_entity_id::varchar, '.', 1), {', '.join(f'{c}::varchar' for c in trx)} from c.crs
            qualify row_number() over (partition by split_part(cr_entity_id::varchar, '.', 1)
                                       order by trx_updated_at desc nulls last, cr_created_at desc, cr_id desc) = 1""").fetchall()}
    new, refused = enrich(snapshot, hudhud)

    rows = [(hid, column, value) for hid, values in new.items() for column, value in values.items()]
    db.execute("create table e(hid varchar, col varchar, val varchar)")
    if rows:
        db.executemany("insert into e values (?, ?, ?)", rows)
    db.execute(f"create table t as select * from read_parquet('{args.targets}')")
    for column in cols:
        if column not in have:
            db.execute(f"alter table t add column {column} {COLTYPE[column]}")
        db.execute(f"""update t set {column} = try_cast(e.val as {COLTYPE[column]}) from e
                       where e.col = '{column}' and e.hid = cast(t.hudhud_id as varchar)""")
    db.execute("create table enr as select hid, list(col order by col) cols from e group by 1")
    if 'hudhud_enriched' not in have:
        db.execute("alter table t add column hudhud_enriched varchar[]")
    db.execute("""update t set hudhud_enriched = list_sort(list_distinct(coalesce(t.hudhud_enriched, []::varchar[]) || enr.cols))
                  from enr where enr.hid = cast(t.hudhud_id as varchar)""")

    # no existing value may change. The new columns are excluded here — filling their empty rows is the whole point,
    # and a column that already existed is guarded instead by `overwrote` below (empty → value only), exactly as
    # hudhud_fill leaves the fields it fills out of its own no-change check.
    check = [c for c in have if c != 'hudhud_enriched' and c not in NEW_FIELDS]
    changed = db.execute(f"""select count(*) from read_parquet('{args.targets}') o join t using (poi_key)
        where {' or '.join(f'o.{c}::varchar is distinct from t.{c}::varchar' for c in check)}""").fetchone()[0]
    # a new column that already existed may only go empty → value (never value → changed value)
    kept = [c for c in present]
    overwrote = db.execute(f"""select count(*) from read_parquet('{args.targets}') o join t using (poi_key)
        where { ' or '.join(f"(not (lower(trim(coalesce(o.{c}::varchar,''))) in ('','null','none','nan','[]','{{}}')) and o.{c}::varchar is distinct from t.{c}::varchar)" for c in kept) }""").fetchone()[0] if kept else 0
    count = db.execute(f"select (select count(*) from read_parquet('{args.targets}')), (select count(*) from t)").fetchone()
    if changed or overwrote or count[0] != count[1]:
        sys.exit(f'refused: {changed} existing values changed, {overwrote} new-column values overwritten, or rows {count} differ')
    db.execute(f"copy t to '{args.out}' (format parquet, compression zstd)")

    by_field = collections.Counter(column for values in new.values() for column in values)
    report = {
        'input': args.targets, 'output': args.out, 'rows': count[1],
        'rows_with_hudhud_id': len(snapshot), 'rows_enriched': len(new),
        'added_by_field': dict(by_field.most_common()),
        'refused_by_field': dict(refused.most_common()),
        'columns_added': [c for c in cols if c not in have],
    }
    json.dump(report, open(args.out.rsplit('.', 1)[0] + '.report.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
