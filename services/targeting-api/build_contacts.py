# -*- coding: utf-8 -*-
"""Contact normalisation + WhatsApp state for Atlas targets (improvement #9).

Goal: raise real *contactability* of the Farq directory without inventing a
single digit. Two things happen here, both over the release's own phone columns:

  1. ``phone_norm`` is filled where it is empty, from the other phone columns
     (``phone_landline`` today), using strict Saudi number normalisation.
  2. ``phone_norm`` is *improved* where the primary number is not a mobile but a
     secondary number in ``extra_phones`` is a real Saudi mobile — so the POI
     becomes reachable on the Atlas WhatsApp send path. The landline is not a
     dialable WhatsApp target; the mobile from the same record is.

Nothing is fabricated: a bare 7-digit local number, an emergency code like
``997`` or a number range is rejected rather than guessed into a full number.

``whatsapp_state`` is derived exactly as :mod:`status_policy` defines it
(verified / source_flag_unverified / not_available): verification needs a
source + date the directory does not have yet, so the strongest state today is
``source_flag_unverified`` (the sources' ``has_whatsapp`` flag), and only a real
Saudi mobile can carry it to the send path.

The module is import-safe (pure functions, no I/O at import) and also runnable:
``python build_contacts.py [BASE.parquet] [OUT.parquet]`` writes the delta.
"""
import re
import sys

# ---- Saudi number normalisation ----------------------------------------------------------------
# A mobile in E.164 digits: 966 + 5XXXXXXXX  (status_policy.MOBILE, kept identical here).
MOBILE = re.compile(r'^9665[0-9]{8}$')
# Geographic landline: 966 + real 2-digit area code + 7-digit subscriber.
# Real KSA area codes (post-2015 renumbering): 11 12 13 14 16 17.
LANDLINE = re.compile(r'^966(?:11|12|13|14|16|17)[0-9]{7}$')
# Unified / toll business numbers already used across the directory (920xxxxxxx, 800xxxxxxxx).
UNIFIED = re.compile(r'^966(?:9200[0-9]{5}|800[0-9]{7})$')


def normalize_saudi(raw):
    """Normalise one raw phone string to (digits, kind) or (None, None).

    kind is 'mobile', 'landline' or 'unified'. Only complete, well-formed Saudi
    numbers are accepted; anything that would require inventing missing digits
    (bare local numbers, ranges, short codes) returns (None, None).
    """
    if raw is None:
        return None, None
    n = re.sub(r'[^0-9]', '', str(raw))
    if not n:
        return None, None
    if n.startswith('00'):            # international prefix 00966...
        n = n[2:]
    if len(n) == 10 and n[0] == '0':  # national trunk 0 (05..., 011...)
        n = n[1:]
    if len(n) == 9:                   # bare national significant number
        n = '966' + n
    if MOBILE.match(n):
        return n, 'mobile'
    if LANDLINE.match(n):
        return n, 'landline'
    if UNIFIED.match(n):
        return n, 'unified'
    return None, None


def is_mobile(num):
    """True iff ``num`` is a Saudi mobile (WhatsApp-reachable)."""
    return bool(num and MOBILE.match(num))


def split_extra(extra):
    """Split an ``extra_phones`` cell into candidate tokens."""
    if not extra:
        return []
    return [tok for tok in re.split(r'[;,\s/|]+', str(extra)) if tok]


def whatsapp_state(has_whatsapp, whatsapp_verified_at=None, whatsapp_verification_source=None):
    """whatsapp_verification_state, same rule as status_policy.whatsapp_state.

    verified only with a source + date (none in the directory today); otherwise
    the sources' flag gives 'source_flag_unverified', else 'not_available'.
    """
    if whatsapp_verified_at and whatsapp_verification_source:
        return 'verified'
    return 'source_flag_unverified' if has_whatsapp else 'not_available'


def contact_delta(row):
    """Decide the contact improvement for one directory row.

    ``row`` is a mapping with at least: phone_norm, phone_landline,
    extra_phones, has_whatsapp. Returns a dict matching the delta schema
    (poi_key, phone_norm_fill, has_whatsapp, whatsapp_state, contact_source)
    when the row is added/improved, or None when nothing changes.
    """
    primary = (row.get('phone_norm') or '').strip()
    pnum, _pkind = normalize_saudi(primary)
    has_wa = bool(row.get('has_whatsapp'))
    wa_state = whatsapp_state(has_wa)

    # 1. Primary is not a Saudi mobile -> surface a mobile from extra_phones.
    if not is_mobile(pnum):
        for tok in split_extra(row.get('extra_phones')):
            num, kind = normalize_saudi(tok)
            if kind == 'mobile':
                return {
                    'poi_key': row.get('poi_key'),
                    'phone_norm_fill': num,
                    'has_whatsapp': has_wa,
                    'whatsapp_state': wa_state,
                    'contact_source': 'extra_phones:mobile',
                }

    # 2. phone_norm empty -> fill from phone_landline (strict).
    if not primary:
        num, kind = normalize_saudi(row.get('phone_landline'))
        if num:
            return {
                'poi_key': row.get('poi_key'),
                'phone_norm_fill': num,
                'has_whatsapp': has_wa,
                'whatsapp_state': whatsapp_state(has_wa) if kind == 'mobile' else 'not_available',
                'contact_source': 'phone_landline:' + kind,
            }

    return None


# ---- builder (run as a script) ------------------------------------------------------------------
DEFAULT_BASE = '/Volumes/farq/release_build/atlas-2026-11-02-v8-unified/targets.parquet'
DEFAULT_OUT = ('/private/tmp/claude-501/-Users-m4pro-FARQ-B2B/'
               '4d8ec590-15eb-4dfe-b0a1-9b98dc411188/scratchpad/v10/deltas/contacts.parquet')
TEMP_DIR = '/Volumes/farq/_duckdb_tmp'


def build(base=DEFAULT_BASE, out=DEFAULT_OUT, temp_dir=TEMP_DIR):
    """Read the release parquet read-only and write the contacts delta."""
    import duckdb  # local import: the module stays import-safe without duckdb installed
    con = duckdb.connect()
    if temp_dir:
        con.execute("PRAGMA temp_directory=?", [temp_dir])
    rows = con.execute(
        "select poi_key, phone_norm, phone_landline, extra_phones, has_whatsapp "
        "from read_parquet(?) "
        "where (phone_norm is null or trim(phone_norm)='') "
        "   or (extra_phones is not null and trim(extra_phones)<>'')",
        [base],
    ).fetchall()
    cols = ['poi_key', 'phone_norm', 'phone_landline', 'extra_phones', 'has_whatsapp']
    deltas = []
    for r in rows:
        d = contact_delta(dict(zip(cols, r)))
        if d:
            deltas.append(d)
    con.execute(
        "create table d (poi_key varchar, phone_norm_fill varchar, has_whatsapp boolean, "
        "whatsapp_state varchar, contact_source varchar)"
    )
    con.executemany(
        "insert into d values (?,?,?,?,?)",
        [(d['poi_key'], d['phone_norm_fill'], d['has_whatsapp'], d['whatsapp_state'], d['contact_source'])
         for d in deltas],
    )
    con.execute("copy d to ? (format parquet)", [out])
    return len(deltas)


if __name__ == '__main__':
    base = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BASE
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    n = build(base, out)
    print(f"wrote {n} delta rows -> {out}")
