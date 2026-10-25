# -*- coding: utf-8 -*-
"""
One status / eligibility policy for search, map and every WhatsApp send path.

The original values are never rewritten: callers get the normalized class *next to*
company_status / lifecycle_state. Python (normalize) and SQL (CLASS_SQL) implement the same
rules; tests assert they agree.

Owner rules (2026-10-15):
  * closed_permanent          -> hidden from search, map and campaigns
  * closed_temporary, inactive -> may be shown (labelled), never in campaigns
  * empty / invalid / unknown / hidden / draft / archived / any other lifecycle -> not eligible
    to send by default; their *display* stays as it is today until reviewed
  * Atlas campaign calls may explicitly allow unknown_empty only; known closed,
    inactive, hidden and invalid states remain blocked.
  * open alone is not enough to send; has_whatsapp / mobile format is not proof of WhatsApp
  * no environment variable can widen eligibility (constants only, changed by code review)
"""
import re

# ---- normalization -------------------------------------------------------------------------------
_WS = re.compile(r'[\s_\-]+')                    # spaces, underscore, hyphen -> one space

def _canon(v):
    return _WS.sub(' ', str(v or '').replace('\u0640', '')).strip().lower()   # tatweel removed, as in SQL

CLOSED_PERMANENT = frozenset({'permanently closed', 'closed', 'cancelled', 'canceled', 'ملغي', 'ملغى', 'مغلق نهائيا', 'مغلق نهائياً'})
CLOSED_TEMPORARY = frozenset({'temporary closed', 'temporarily closed', 'مغلق مؤقتا', 'مغلق مؤقتاً'})
INACTIVE = frozenset({'inactive', 'غير نشط'})
OPEN = frozenset({'open', 'active', 'approved', 'success', 'مفتوح', 'نشط'})
HIDDEN = frozenset({'hidden'})
LIFECYCLE_CLOSED = frozenset({'closed', 'permanently closed'})

def normalize(company_status, lifecycle_state=None):
    """-> dict(status_original, status_source, status_normalized, normalization_rule, status_confidence)."""
    cs, lc = _canon(company_status), _canon(lifecycle_state)
    out = {'status_original': company_status, 'status_source': 'company_status'}
    if lc in LIFECYCLE_CLOSED:
        return {**out, 'status_original': lifecycle_state, 'status_source': 'lifecycle_state', 'status_normalized': 'closed_permanent', 'normalization_rule': 'lifecycle_closed', 'status_confidence': 'high'}
    for cls, values, conf in (('closed_permanent', CLOSED_PERMANENT, 'high'), ('closed_temporary', CLOSED_TEMPORARY, 'high'),
                              ('inactive', INACTIVE, 'low'), ('open', OPEN, 'medium'), ('hidden', HIDDEN, 'unresolved')):
        if cs in values:
            return {**out, 'status_normalized': cls, 'normalization_rule': 'value:' + cs, 'status_confidence': conf}
    if cs == '':
        return {**out, 'status_normalized': 'unknown_empty', 'normalization_rule': 'empty', 'status_confidence': 'none'}
    return {**out, 'status_normalized': 'unknown_invalid', 'normalization_rule': 'unrecognised_value', 'status_confidence': 'none'}

# ---- the same rules in DuckDB SQL ---------------------------------------------------------------
def _lit(values):
    # literals come only from the frozensets above (never from requests or the environment)
    return '(' + ','.join("'" + v.replace("'", "''") + "'" for v in sorted(values)) + ')'

def _canon_sql(col):
    # plain replace() instead of a regex: same result as _canon() for runs of up to 8 separators, ~3x cheaper per row
    x = f"replace(replace(replace(replace(coalesce({col},''),'_',' '),'-',' '),'\u0640',''),chr(9),' ')"
    for _ in range(3): x = f"replace({x},'  ',' ')"
    return f"lower(trim({x}))"

CS, LC = _canon_sql('company_status'), _canon_sql('lifecycle_state')
CLASS_SQL = f"""(case
  when {LC} in {_lit(LIFECYCLE_CLOSED)} then 'closed_permanent'
  when {CS} in {_lit(CLOSED_PERMANENT)} then 'closed_permanent'
  when {CS} in {_lit(CLOSED_TEMPORARY)} then 'closed_temporary'
  when {CS} in {_lit(INACTIVE)} then 'inactive'
  when {CS} in {_lit(OPEN)} then 'open'
  when {CS} in {_lit(HIDDEN)} then 'hidden'
  when {CS} = '' then 'unknown_empty'
  else 'unknown_invalid' end)"""

# Search / map / tiles / facets / counts: only permanently closed records are removed.
# SEARCH_SQL is the readable rule (used in tests and analysis); search_sql() compiles the same rule into a plain
# value list from the data once at start-up (the CASE above on every row costs ~1 s per Riyadh scan).
SEARCH_SQL = f"{CLASS_SQL} <> 'closed_permanent'"

def _lit_raw(values):
    return '(' + ','.join("'" + str(v).replace("'", "''") + "'" for v in values) + ')'

def search_sql(conn, path):
    """Exact equivalent of SEARCH_SQL for one data file, built with normalize() over its distinct values."""
    cs = [v for (v,) in conn.execute("select distinct company_status from read_parquet(?)", [path]).fetchall()
          if v is not None and normalize(v)['status_normalized'] == 'closed_permanent']
    lc = [v for (v,) in conn.execute("select distinct lifecycle_state from read_parquet(?)", [path]).fetchall()
          if v is not None and _canon(v) in LIFECYCLE_CLOSED]
    parts = ([f"coalesce(company_status,'') not in {_lit_raw(cs)}"] if cs else []) + ([f"coalesce(lifecycle_state,'') not in {_lit_raw(lc)}"] if lc else [])
    return '(' + ' and '.join(parts) + ')' if parts else 'true'

# ---- send eligibility (owner decision 2026-10-15: «نرسل لأي محل متحقق من واتساب حقه ومفتوح أو مغلق مؤقتاً») ----
# Nothing here reads the environment: changing eligibility needs a code change and review.
SEND_CLASSES = frozenset({'open', 'closed_temporary'})
CHECK_LIFECYCLE = False                     # owner: record stage is not a condition
SEND_LIFECYCLE = frozenset()                # used only if CHECK_LIFECYCLE is turned on again
REQUIRE_VERIFIED_WHATSAPP = True            # has_whatsapp / mobile format are not verification
ACCEPT_SOURCE_FLAG = True                   # owner 2026-10-15 interim: the sources' has_whatsapp flag counts until real verification exists
REQUIRE_CONTACT_BASIS = False               # owner: not a condition
MOBILE = re.compile(r'^9665[0-9]{8}$')

def whatsapp_state(row):
    """whatsapp_verification_state. The directory has no verification source or date today."""
    if row.get('whatsapp_verified_at') and row.get('whatsapp_verification_source'):
        return 'verified'
    return 'source_flag_unverified' if row.get('has_whatsapp') else 'not_available'

def mobile_of(row):
    n = re.sub(r'[^0-9]', '', str(row.get('phone_norm') or ''))
    if n.startswith('00'):
        n = n[2:]
    if len(n) == 10 and n.startswith('05'):
        n = '966' + n[1:]
    elif len(n) == 9 and n.startswith('5'):
        n = '966' + n
    return n if MOBILE.match(n) else None

def send_reasons(row, allow_unknown_empty_status=False):
    """Every reason a directory record may not be messaged (empty list = eligible).

    The empty-status exception is off by default and is passed only by Atlas's
    authenticated campaign route. It never permits a known closed or invalid state.
    """
    st = normalize(row.get('company_status'), row.get('lifecycle_state'))
    reasons = []
    unknown_empty_allowed = allow_unknown_empty_status and st['status_normalized'] == 'unknown_empty'
    if st['status_normalized'] not in SEND_CLASSES and not unknown_empty_allowed: reasons.append('status:' + st['status_normalized'])
    lc = _canon(row.get('lifecycle_state'))
    if CHECK_LIFECYCLE and lc not in SEND_LIFECYCLE: reasons.append('lifecycle:' + (lc or 'empty'))
    wa = whatsapp_state(row)
    if wa == 'not_available': reasons.append('whatsapp:not_available')
    elif REQUIRE_VERIFIED_WHATSAPP and wa != 'verified' and not (ACCEPT_SOURCE_FLAG and wa == 'source_flag_unverified'):
        reasons.append('whatsapp:' + wa)
    if REQUIRE_CONTACT_BASIS and not row.get('contact_basis'): reasons.append('basis:not_recorded')
    if not mobile_of(row): reasons.append('contact:invalid_mobile')
    return reasons

def send_decision(row, allow_unknown_empty_status=False):
    """-> (eligible, first_reason_or_'eligible')."""
    r = send_reasons(row, allow_unknown_empty_status=allow_unknown_empty_status)
    return (not r), (r[0] if r else 'eligible:' + whatsapp_state(row))

def mask(number):
    d = re.sub(r'[^0-9]', '', str(number or ''))
    return (d[:4] + '****' + d[-2:]) if len(d) >= 8 else ('****' if d else '')
