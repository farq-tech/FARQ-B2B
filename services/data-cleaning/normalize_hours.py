"""Write every `working_hours` value of a directory snapshot in the one readable form «Sun: 08:30 - 23:30 | Mon: …».

A step after the golden export and before publishing, like chain_consensus.py and hudhud_fill.py. The column holds what
each source gave (build_golden.py takes the surveyor CR first, then the earlier directory, Drive sheets and Google Maps):
- HudHud JSON, `{"timezone", "regular_hours": [...]}` or the bare list, sometimes as a Python repr (`{'timezone': …}`)
  or inside a saved API reply (`{"success", "data": {"trx": {"opening_hours": …}}}`), read with hudhud_fill.hours(), so
  «00:00 - 00:00» is a day open all day, written «00:00 - 24:00» (owner, 2026-10-29);
- Urbi, `Sun: 08:00 - 24:00; Mon: {}; …` (`{}` or ` - ` is a day with no hours) and `Mon-Thu 9:00-23:00, break
  13:00-16:00; Fri Holiday; Sat-Sun 9:00-23:00`;
- Google Maps, `1: 9 AM–5 PM|…|7: Closed`, where 1 is Sunday (on the 188 places that also have HudHud hours and a
  closed day, 184 match only with 1 = Sunday), the same with day names, and `{"الأحد": "9ص–11م", …}`.
Days keep the order their source lists them in; a closed day is left out, as hours() leaves it out; a span is written
as given (a close at midnight stays «00:00») except in HudHud JSON as above and «Open 24 hours» as «00:00 - 24:00».

A value is rewritten only when every part of it is read; otherwise it stays exactly as it is, never guessed. A value
that holds no hours at all (every day empty, «Refused to provide information», `{"regular_hours": []}`, a bare time
zone) becomes empty, so the directory shows «غير متاح» rather than a placeholder. No other column changes; the script
refuses to write if one does.

    python3 normalize_hours.py --targets T.parquet --out T_hours.parquet
"""
import argparse
import ast
import collections
import json
import os
import re
import sys

import duckdb

from hudhud_fill import DAYS, hours, text

SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
URBI = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
ARABIC = {'الأحد': 'Sun', 'الاثنين': 'Mon', 'الثلاثاء': 'Tue', 'الأربعاء': 'Wed', 'الخميس': 'Thu', 'الجمعة': 'Fri', 'السبت': 'Sat'}
NO_HOURS = {'refused to provide information', 'custom_hours', 'asia/riyadh'}
ALL_DAY = re.compile(r'^(open 24 hours|نعمل على مدار 24 ساعة)$', re.I)
CLOSED = re.compile(r'^(closed|holiday|مغلق)$', re.I)
EMPTY_DAY = re.compile(r'^(\{\}|-|)$')
H24 = re.compile(r'^(\d{1,2}):(\d{2}) ?- ?(\d{1,2}):(\d{2})$')
H12 = re.compile(r'^(\d{1,2})(?::(\d{2}))? ?(AM|PM|ص|م)? ?[–-] ?(\d{1,2})(?::(\d{2}))? ?(AM|PM|ص|م)$', re.I)
SPAN = r'\d{2}:\d{2} - \d{2}:\d{2}'
READABLE = re.compile(rf'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat): {SPAN}(, {SPAN})*( \| (Sun|Mon|Tue|Wed|Thu|Fri|Sat): {SPAN}(, {SPAN})*)*$')


class Unread(Exception):
    """A part of the value could not be read; the value stays as it is."""


def clock(h, m='00', limit=24):
    h, m = int(h), int(m or 0)
    if h > limit or m > 59 or (h == 24 and m):
        raise Unread
    return f'{h:02d}:{m:02d}'


def twelve(h, m, suffix):
    h = int(h)
    if not 1 <= h <= 12:
        raise Unread
    return clock(h % 12 + (12 if suffix.upper() in ('PM', 'م') else 0), m)


def spans(body):
    """A day's hours as a list of «HH:MM - HH:MM» (empty for a closed day), or None for a day with no hours given."""
    body = re.sub(r'[ \xa0\s]+', ' ', body).strip()
    if EMPTY_DAY.match(body.replace(' ', '')):
        return None
    if CLOSED.match(body):
        return []
    if ALL_DAY.match(body):
        return ['00:00 - 24:00']
    out = []
    for span in re.split(r', ?', body):
        m = H24.match(span)
        if m:
            start, end = clock(m[1], m[2]), clock(m[3], m[4])
            if start == end:
                raise Unread  # an equal pair outside HudHud JSON has no stated meaning: none, or all day
            out.append(f'{start} - {end}')
            continue
        m = H12.match(span)
        if not m:
            raise Unread
        # Google writes the start's AM/PM only when it differs from the end's («9–11 PM» is 21:00 to 23:00)
        start, end = twelve(m[1], m[2], m[3] or m[6]), twelve(m[4], m[5], m[6])
        if start == end:
            raise Unread
        out.append(f'{start} - {end}')
    return out


def join(days):
    """[(day, spans or None)] in the readable form; None when no day has hours given; Unread when only closed days."""
    if all(s is None for _, s in days):
        return None
    parts = [f"{day}: {', '.join(s)}" for day, s in days if s]
    if not parts:
        raise Unread  # closed every day is not a format question
    return ' | '.join(parts)


def hudhud(days):
    """HudHud's list of days through hours(), only when hours() reads every span of it.

    A time written «2:00» or «23:00\\t» is the same time written «02:00» / «23:00»; anything else stays unread."""
    if not isinstance(days, list):
        raise Unread
    if days and all(isinstance(d, dict) and 'media_url' in d for d in days):
        return None  # a HudHud media list landed in the hours column: it holds no hours
    for day in days:
        if not isinstance(day, dict) or day.get('day') not in DAYS or not isinstance(day.get('hours') or [], list):
            raise Unread
        for h in day.get('hours') or []:
            if not isinstance(h, dict):
                raise Unread
            for k in ('open', 'close'):
                m = re.match(r'^(\d{1,2}):(\d{2})$', str(h.get(k)).strip())
                if not m:
                    raise Unread
                h[k] = clock(m[1], m[2])
            if h['open'] == h['close'] != '00:00':
                raise Unread
    if not any(day.get('hours') for day in days):
        return None
    return hours(json.dumps(days))


def from_json(v):
    try:
        d = json.loads(v)
    except ValueError:
        try:
            d = ast.literal_eval(v)
        except (ValueError, SyntaxError):
            raise Unread
    if isinstance(d, list):
        return hudhud(d)
    if not isinstance(d, dict):
        raise Unread
    if set(d) == {'timezone', 'regular_hours'}:
        return hudhud(d['regular_hours'])
    if set(d) == {'success', 'data'}:
        inner = ((d['data'] or {}).get('trx') or {}).get('opening_hours')
        return None if inner is None else normalize(inner)
    if d and set(d) <= set(ARABIC):
        return join([(ARABIC[k], spans(str(b))) for k, b in d.items()])
    raise Unread


def labelled(v):
    """`Sun: …; Mon: …`, `Sun: … | Mon: …`, Google's `1: …|2: …` (1 = Sunday) or `Su 09:00-23:00; Mo …`."""
    days = []
    for part in re.split(r' ?\| ?|; ', v):
        m = re.match(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat|[1-7]):(.*)$', part.strip()) or \
            re.match(r'^(Su|Mo|Tu|We|Th|Fr|Sa) (.*)$', part.strip())
        if not m:
            raise Unread
        day = SHORT[int(m[1]) - 1] if m[1].isdigit() else next(d for d in SHORT if d.startswith(m[1]))
        days.append((day, spans(m[2])))
    if len({d for d, _ in days}) != len(days):
        raise Unread
    return join(days)


def ranges(v):
    """Urbi's `Mon-Thu 9:00-23:00, break 13:00-16:00; Fri Holiday; Sat-Sun 9:00-23:00`."""
    days = []
    for part in v.split('; '):
        m = re.match(r'^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:-(Mon|Tue|Wed|Thu|Fri|Sat|Sun))? (.+)$', part.strip())
        if not m:
            raise Unread
        a, b = URBI.index(m[1]), URBI.index(m[2] or m[1])
        body = m[3]
        brk = re.match(r'^(\d{1,2}:\d{2})-(\d{1,2}:\d{2}), break (\d{1,2}:\d{2})-(\d{1,2}:\d{2})$', body)
        if brk:
            o, c, bs, be = (clock(*t.split(':')) for t in brk.groups())
            # a close at or before the opening is after midnight («9:00-1:00, break 14:00-16:00»)
            if not (o < bs < be and (be < c or c < o)):
                raise Unread
            s = [f'{o} - {bs}', f'{be} - {c}']
        else:
            s = spans(body)
            if s is None:
                raise Unread
        days += [(URBI[i % 7], s) for i in range(a, b + (7 if b < a else 0) + 1)]
    if len({d for d, _ in days}) != len(days):
        raise Unread
    return join(days)


def normalize(v):
    """The value in the readable form, None when it holds no hours, or the value itself when any part is not read."""
    t = text(v)
    if not t:
        return None if str(v).strip() in ('[]', '{}') else v
    if t.lower() in NO_HOURS:
        return None
    try:
        if t[0] in '{[':
            return from_json(t)
        if re.match(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat|[1-7]):|^(Su|Mo|Tu|We|Th|Fr|Sa) \d', t):
            return labelled(t)
        if re.match(r'^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(-\w{3})? ', t):
            return ranges(t)
    except Unread:
        pass
    return v


def shape(v):
    """The format a value is in, for the report."""
    t = text(v)
    if not t:
        return 'hudhud_json' if str(v).strip() in ('[]', '{}') else 'empty'
    if READABLE.match(t):
        return 'readable'
    if t.startswith('{"success"'):
        return 'hudhud_api_reply'
    if t.startswith('[{"id"') and 'media_url' in t:
        return 'hudhud_media_list'
    if t[0] in '{[':
        return 'google_json_arabic' if t.startswith('{"' + 'ال') else 'hudhud_json'
    if t.lower() in NO_HOURS:
        return 'no_hours_placeholder'
    if re.match(r'^[1-7]:', t):
        return 'google_numbered_days'
    if re.match(r'^(Su|Mo|Tu|We|Th|Fr|Sa) \d', t):
        return 'two_letter_days'
    if re.match(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat):', t):
        return 'day_names_semicolon' if '; ' in t else 'day_names_pipe_not_readable'
    if re.match(r'^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(-\w{3})? ', t):
        return 'urbi_day_ranges'
    return 'other'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--targets', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    if os.path.abspath(args.out) == os.path.abspath(args.targets) or os.path.exists(args.out):
        sys.exit('refused: --out must be a new file, never the input or an existing snapshot')
    db = duckdb.connect()
    db.execute("SET threads=4")
    db.execute("SET memory_limit='8GB'")
    db.execute(f"create table t as select * from read_parquet('{args.targets}')")
    values = [v for (v,) in db.execute("select distinct working_hours from t where nullif(trim(working_hours), '') is not null").fetchall()]
    new = {v: normalize(v) for v in values}
    db.execute("create table m(old varchar, new varchar)")
    changes = [(o, n) for o, n in new.items() if n != o]
    if changes:  # duckdb refuses an empty batch; a snapshot already readable still gets its copy and report
        db.executemany("insert into m values (?, ?)", changes)
    def counted():
        found = collections.Counter()
        for v, n in db.execute("select working_hours, count(*) from t group by 1").fetchall():
            found[shape(v)] += n
        return found

    before = counted()
    db.execute("update t set working_hours = m.new from m where t.working_hours = m.old")
    after = counted()

    # nothing but working_hours may change, row for row in file order
    changed = db.execute(f"""select count(*) from (select * exclude (working_hours) from read_parquet('{args.targets}')
                             except all select * exclude (working_hours) from t)""").fetchone()[0]
    count = db.execute(f"select (select count(*) from read_parquet('{args.targets}')), (select count(*) from t)").fetchone()
    if changed or count[0] != count[1]:
        sys.exit(f'refused: {changed} rows changed outside working_hours or rows {count} differ')
    db.execute(f"copy t to '{args.out}' (format parquet, compression zstd)")

    rewritten = collections.Counter()
    for (old, n) in db.execute(f"select working_hours, count(*) from read_parquet('{args.targets}') group by 1").fetchall():
        if old in new and new[old] != old:
            rewritten[f"{shape(old)} -> {'empty' if new[old] is None else 'readable'}"] += n
    kept = collections.Counter()
    for v in values:
        if new[v] == v and shape(v) != 'readable':
            kept[shape(v)] += 1
    report = {
        'input': args.targets, 'output': args.out, 'rows': count[1],
        'rows_by_format_before': dict(before.most_common()), 'rows_by_format_after': dict(after.most_common()),
        'rows_rewritten': dict(rewritten.most_common()),
        'distinct_values_kept_unread_by_format': dict(kept.most_common()),
        'kept_unread_examples': [v[:160] for v in values if new[v] == v and shape(v) in ('hudhud_json', 'hudhud_api_reply', 'hudhud_media_list', 'google_json_arabic')][:10],
        'rows_changed_outside_working_hours': changed,
    }
    with open(os.path.splitext(args.out)[0] + '.report.json', 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
