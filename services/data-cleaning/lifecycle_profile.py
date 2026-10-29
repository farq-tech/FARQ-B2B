"""Recompute the figures in docs/establishment-lifecycle.md (section 1) from the HudHud CRS/POI-log export.

Read-only: it reads one .xlsx and prints JSON (aggregate counts only, no business rows). No third-party packages.

    python3 -I lifecycle_profile.py crs_and_logs_linked_20250828_172259.xlsx > ../../docs/establishment-lifecycle-figures.json

Every figure carries its unit, its denominator and what it leaves out. Definitions (the document uses these names):
- log row: one row of the sheet `All_POI_Logs`.
- CR request: one row of the sheet `All_CRs_Data`.
- transaction: one distinct, non-empty `transaction_id` in `All_POI_Logs`; it equals the HudHud POI id. Rows with an
  empty `transaction_id` belong to no transaction and are counted apart.
- update pair: two consecutive approved log rows of one transaction, ordered by `created_at`, the later one an
  `update`.
- name changed: the trimmed `name_ar` differs, or the trimmed, lower-cased `name_en` differs (raw text, before the
  normalisation below).
- distance: great-circle metres between the two rows' coordinates; `unknown` when either side has none.
- name words (per language): Arabic from `name_ar`, English from `name_en`, after normalisation:
    Arabic  - drop diacritics and tatweel; أ إ آ ٱ -> ا, ى -> ي, ة -> ه, ؤ -> و, ئ -> ي; Arabic-Indic digits -> 0-9;
              split on anything that is not a letter or digit; drop a leading «ال» from words longer than 4 letters.
    English - lower case; split on anything that is not a-z or 0-9.
  Words shorter than 2 characters, digits-only words and GENERIC words are left out.
- specific shared word: the two rows share at least one name word in the same language.
- comparable pair: in at least one language, both rows have at least one name word.
- names disjoint: a comparable pair that shares no specific word in any language. It is a screening signal for review,
  never evidence of identity, and sharing a word is never evidence either.
"""
import collections
import datetime
import json
import math
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
DISTANCE_BINS = ((1, '0'), (10, '<10'), (50, '<50'), (200, '<200'), (float('inf'), '>=200'))
IDENTITY_FIELDS = ('national_address', 'phone_number', 'brand_id', 'floorno', 'licenseno', 'building_no')

# activity, legal-form and naming words that many unrelated businesses share (after normalisation)
GENERIC_AR = frozenset('''
مطعم مطاعم مقهي مقاهي كافيه كوفي صيدليه صيدليات بقاله تموينات سوبرماركت ماركت هايبر مركز مراكز مؤسسه شركه شركات
محل محلات معرض معارض مكتب مكاتب فرع للتجاره تجاره التجاريه تجاريه العامه عامه الاهليه للمقاولات مقاولات ورشه مغسله
صالون حلاق حلاقه مخبز مخابز عياده عيادات مجمع مستودع مصنع خدمات للخدمات المحدوده محدوده مساهمه وشركاه وشريكه
ابو ام بن بنت عبد ال الشيخ السعوديه سعودي العربيه الرياض جده الدمام
'''.split())
GENERIC_EN = frozenset('''
restaurant restaurants cafe coffee pharmacy grocery supermarket market hyper center centre company co est establishment
trading shop store stores branch office showroom workshop laundry salon barber bakery clinic complex warehouse factory
services service the and for of al el llc ltd limited saudi arabia riyadh jeddah dammam
'''.split())
# compared after «ال» is dropped too, so «الرياض» and «رياض» are both generic
GENERIC_AR = GENERIC_AR | {w[2:] for w in GENERIC_AR if w.startswith('ال') and len(w) > 4}
AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
AR_LETTERS = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي'})


def sheets(path):
    """{sheet name: list of row dicts keyed by the header row}."""
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        shared = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m']))
                  for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}

    def column(ref):
        n = 0
        for ch in ref:
            if not ch.isalpha():
                break
            n = n * 26 + ord(ch.upper()) - 64
        return n - 1

    out = {}
    for sheet in ET.fromstring(z.read('xl/workbook.xml')).find('m:sheets', NS):
        target = rels[sheet.get('{%s}id' % NS['r'])].lstrip('/')
        rows, header = [], None
        with z.open(target if target.startswith('xl/') else 'xl/' + target) as handle:
            for _, el in ET.iterparse(handle):
                if el.tag != '{%s}row' % NS['m']:
                    continue
                cells = {}
                for c in el.findall('m:c', NS):
                    v = c.find('m:v', NS)
                    cells[column(c.get('r'))] = (shared[int(v.text)] if c.get('t') == 's' and v is not None
                                                 else v.text if v is not None
                                                 else ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m'])))
                el.clear()
                values = [cells.get(i, '') for i in range(max(cells) + 1)] if cells else []
                if header is None:
                    header = values
                else:
                    rows.append(dict(zip(header, values + [''] * (len(header) - len(values)))))
        out[sheet.get('name')] = rows
    return out


def number(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def metres(a, b):
    la1, lo1, la2, lo2 = (number(a['latitude']), number(a['longitude']), number(b['latitude']), number(b['longitude']))
    if None in (la1, lo1, la2, lo2):
        return None
    k = math.pi / 180
    h = math.sin((la2 - la1) * k / 2) ** 2 + math.cos(la1 * k) * math.cos(la2 * k) * math.sin((lo2 - lo1) * k / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def name_changed(a, b):
    return ((a['name_ar'] or '').strip() != (b['name_ar'] or '').strip()
            or (a['name_en'] or '').strip().lower() != (b['name_en'] or '').strip().lower())


def arabic_words(text):
    text = ''.join(ch for ch in unicodedata.normalize('NFKD', text or '') if unicodedata.category(ch) != 'Mn')
    text = text.replace('ـ', '').translate(AR_LETTERS).translate(AR_DIGITS)
    words = set()
    for word in re.split(r'[^\w]+', text):
        word = re.sub(r'[A-Za-z_]', '', word)
        if word in GENERIC_AR:
            continue
        if word.startswith('ال') and len(word) > 4:
            word = word[2:]
        if len(word) >= 2 and not word.isdigit() and word not in GENERIC_AR:
            words.add(word)
    return words


def english_words(text):
    return {w for w in re.split(r'[^a-z0-9]+', (text or '').lower()) if len(w) >= 2 and not w.isdigit() and w not in GENERIC_EN}


def name_relation(a, b):
    """'shared', 'disjoint' or 'not_comparable' for two log rows (see module docstring)."""
    comparable = False
    for words in (arabic_words, english_words):
        field = 'name_ar' if words is arabic_words else 'name_en'
        wa, wb = words(a[field]), words(b[field])
        if wa and wb:
            comparable = True
            if wa & wb:
                return 'shared'
    return 'disjoint' if comparable else 'not_comparable'


def any_word_disjoint_v3(a, b):
    """The rule of the version-3 document (any shared word, no normalisation), kept to reconcile its figure."""
    wa = set(re.findall(r'\w+', f"{a['name_ar']} {a['name_en']}".lower()))
    wb = set(re.findall(r'\w+', f"{b['name_ar']} {b['name_en']}".lower()))
    return bool(wa and wb and not wa & wb)


def profile(book):
    logs, crs = book['All_POI_Logs'], book['All_CRs_Data']
    count = collections.Counter
    no_id = [r for r in logs if not r['transaction_id']]
    by_tx = collections.defaultdict(list)
    for row in logs:
        if row['transaction_id']:
            by_tx[row['transaction_id']].append(row)

    pairs = count()
    for rows in by_tx.values():
        approved = sorted((r for r in rows if r['review_status'] == 'approved'), key=lambda r: number(r['created_at']) or 0)
        for a, b in zip(approved, approved[1:]):
            if b['operation'] != 'update':
                continue
            d = metres(a, b)
            band = 'unknown' if d is None else next(label for limit, label in DISTANCE_BINS if d < limit)
            pairs[(name_changed(a, b), band)] += 1

    multi = {t: rows for t, rows in by_tx.items() if len(rows) > 1}
    spread, disjoint_v3, relation, blocked, linked_by_kind = 0, 0, count(), 0, count()
    for rows in multi.values():
        far = [metres(a, b) for i, a in enumerate(rows) for b in rows[i + 1:]]
        is_far = max((d for d in far if d is not None), default=0) > 200
        spread += is_far
        disjoint_v3 += any(any_word_disjoint_v3(a, b) for i, a in enumerate(rows) for b in rows[i + 1:])
        relations = {name_relation(a, b) for i, a in enumerate(rows) for b in rows[i + 1:]}
        kind = 'disjoint' if 'disjoint' in relations else 'shared' if 'shared' in relations else 'not_comparable'
        relation[kind] += 1
        blocked += is_far or kind == 'disjoint'
        if not (is_far or kind == 'disjoint'):
            linked_by_kind[kind] += 1

    deletes = [r for r in logs if r['operation'] == 'delete']
    cr_deletes = [c for c in crs if c['operation'] == 'delete']
    stamps = [number(r['created_at']) for r in logs if number(r['created_at'])]
    day = lambda serial: (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(serial))).isoformat()
    figure = lambda value, unit, denominator=None, excludes=None: {k: v for k, v in (('value', value), ('unit', unit), ('denominator', denominator), ('excludes', excludes)) if v is not None}
    rows_with_tx = len(logs) - len(no_id)
    return {
        'log_rows': figure(len(logs), 'log row'),
        'log_rows_without_transaction_id': figure(len(no_id), 'log row', len(logs)),
        'log_rows_without_transaction_id_by_operation_and_review': {f'{k[0]}|{k[1]}': v for k, v in count((r['operation'], r['review_status']) for r in no_id).items()},
        'log_span': [day(min(stamps)), day(max(stamps))],
        'log_rows_by_operation': {k: figure(v, 'log row', len(logs)) for k, v in count(r['operation'] for r in logs).items()},
        'transactions': figure(len(by_tx), 'transaction', excludes='rows without transaction_id'),
        'transactions_by_rows': {('6+' if k == 6 else str(k)): v for k, v in sorted(count(min(len(v), 6) for v in by_tx.values()).items())},
        'multi_row_transactions': figure(len(multi), 'transaction', len(by_tx)),
        'trx_id_equals_transaction_id': figure(sum(r['trx.id'] == r['transaction_id'] for r in logs if r['trx.id']), 'log row', sum(bool(r['trx.id']) for r in logs)),
        'cr_requests': figure(len(crs), 'CR request'),
        'cr_entity_id_equals_transaction_id': figure(sum(c['entity_id'] == c['last_log_transaction_id'] for c in crs), 'CR request', len(crs)),
        'delete_log_rows_with_duplicate_of_id': figure(sum(bool(r['duplicate_of_id']) for r in deletes), 'log row', len(deletes)),
        'cr_delete_requests_by_previous_status': {k: figure(v, 'CR request', len(cr_deletes)) for k, v in count(c['prev_log_status'] or '(empty)' for c in cr_deletes).items()},
        'cr_requests_by_new_status': {k: figure(v, 'CR request', len(crs)) for k, v in count(c['last_log_status'] or '(empty)' for c in crs).items()},
        'cr_requests_with_identity_field': {f: figure(sum(bool(c['last_log_' + f]) for c in crs), 'CR request', len(crs)) for f in IDENTITY_FIELDS},
        'update_pairs': figure(sum(pairs.values()), 'update pair', excludes='rows without transaction_id; unapproved rows'),
        'update_pairs_by_name_change_and_distance': {f'name_changed={k[0]}|{k[1]}': v for k, v in sorted(pairs.items(), key=str)},
        'update_pairs_name_changed': figure(sum(v for k, v in pairs.items() if k[0]), 'update pair', sum(pairs.values())),
        'update_pairs_moved_over_50m': figure(sum(v for k, v in pairs.items() if k[1] in ('<200', '>=200')), 'update pair', sum(pairs.values())),
        'multi_row_transactions_spread_over_200m': figure(spread, 'transaction', len(multi)),
        'multi_row_transactions_names_disjoint_v3_any_word': figure(disjoint_v3, 'transaction', len(multi), 'v3 rule, kept for reconciliation'),
        'multi_row_transactions_by_name_relation': {k: figure(v, 'transaction', len(multi)) for k, v in relation.items()},
        'same_source_poi_would_link': figure(len(multi) - blocked, 'transaction', len(multi), 'transactions with names disjoint or spread over 200 m (blocked to review)'),
        'same_source_poi_blocked_to_review': figure(blocked, 'transaction', len(multi)),
        'same_source_poi_would_link_by_stratum': {('a_comparable' if k == 'shared' else 'b_not_comparable'): figure(v, 'transaction', len(multi) - blocked) for k, v in linked_by_kind.items()},
        'not_measurable_here': ['closed-then-reopened blocker: the POI logs carry no status field; CR requests do (693 only)'],
    }


if __name__ == '__main__':
    print(json.dumps(profile(sheets(sys.argv[1])), ensure_ascii=False, indent=1))
