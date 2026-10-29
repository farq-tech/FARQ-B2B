"""Recompute the figures in docs/establishment-lifecycle.md («ما تقوله البيانات») from the HudHud CRS/POI-log export.

Read-only: it reads one .xlsx and prints JSON. No third-party packages (the workbook is read with zipfile + ElementTree).

    python3 -I lifecycle_profile.py crs_and_logs_linked_20250828_172259.xlsx > lifecycle_profile.json

Definitions (the document refers to these names):
- log row: one row of the sheet `All_POI_Logs`.
- CR request: one row of the sheet `All_CRs_Data` (one change request).
- transaction: one distinct `transaction_id` in `All_POI_Logs`. It equals the HudHud POI id (`trx.id`) and the CR
  `entity_id`; transactions holding more than BULK_CREATES create rows are a bulk import and are left out of the pairs.
- update pair: two consecutive *approved* log rows of one transaction, ordered by `created_at`, where the later row's
  operation is `update`.
- name changed: the trimmed `name_ar` differs, or the trimmed, lower-cased `name_en` differs.
- shared name word: the two rows' Arabic and English names (lower case, word characters) share at least one word.
- distance: great-circle metres between the pair's coordinates; `unknown` when either side has none.
"""
import collections
import json
import math
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
BULK_CREATES = 50
DISTANCE_BINS = ((1, '0'), (10, '<10'), (50, '<50'), (200, '<200'), (float('inf'), '>=200'))
IDENTITY_FIELDS = ('national_address', 'phone_number', 'brand_id', 'floorno', 'licenseno', 'building_no')


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


def words(row):
    return set(re.findall(r'\w+', f"{row['name_ar']} {row['name_en']}".lower()))


def profile(book):
    logs, crs = book['All_POI_Logs'], book['All_CRs_Data']
    count = collections.Counter
    by_tx = collections.defaultdict(list)
    for row in logs:
        by_tx[row['transaction_id']].append(row)
    bulk = {t for t, rows in by_tx.items() if sum(r['operation'] == 'create' for r in rows) > BULK_CREATES}

    pairs = count()
    for t, rows in by_tx.items():
        if t in bulk:
            continue
        approved = sorted((r for r in rows if r['review_status'] == 'approved'), key=lambda r: number(r['created_at']) or 0)
        for a, b in zip(approved, approved[1:]):
            if b['operation'] != 'update':
                continue
            d = metres(a, b)
            band = 'unknown' if d is None else next(label for limit, label in DISTANCE_BINS if d < limit)
            pairs[(name_changed(a, b), band)] += 1

    multi = {t: rows for t, rows in by_tx.items() if len(rows) > 1 and t not in bulk}
    spread, disjoint = 0, 0
    for rows in multi.values():
        far = [metres(a, b) for i, a in enumerate(rows) for b in rows[i + 1:]]
        spread += max((d for d in far if d is not None), default=0) > 200
        names = [words(r) for r in rows]
        disjoint += any(not (a & b) for i, a in enumerate(names) for b in names[i + 1:] if a and b)

    deletes = [r for r in logs if r['operation'] == 'delete']
    cr_deletes = [c for c in crs if c['operation'] == 'delete']
    excel_day = lambda value: value and __import__('datetime').date.fromordinal(693594 + int(float(value))).isoformat()
    stamps = [number(r['created_at']) for r in logs if number(r['created_at'])]
    return {
        'units': {'log_rows': len(logs), 'cr_requests': len(crs), 'transactions': len(by_tx), 'bulk_transactions_left_out': len(bulk)},
        'log_span': [excel_day(min(stamps)), excel_day(max(stamps))],
        'log_rows_by_operation': dict(count(r['operation'] for r in logs)),
        'transactions_by_log_rows': dict(count(min(len(v), 6) for v in by_tx.values())),
        'delete_log_rows': len(deletes),
        'delete_log_rows_with_duplicate_of_id': sum(bool(r['duplicate_of_id']) for r in deletes),
        'cr_delete_requests': len(cr_deletes),
        'cr_delete_requests_by_previous_status': dict(count(c['prev_log_status'] or '(empty)' for c in cr_deletes)),
        'cr_requests_by_new_status': dict(count(c['last_log_status'] or '(empty)' for c in crs)),
        'cr_requests_with_identity_field': {f: sum(bool(c['last_log_' + f]) for c in crs) for f in IDENTITY_FIELDS},
        'update_pairs': sum(pairs.values()),
        'update_pairs_by_name_change_and_distance': {f"name_changed={k[0]}|{k[1]}": v for k, v in sorted(pairs.items(), key=str)},
        'multi_row_transactions': len(multi),
        'multi_row_transactions_spread_over_200m': spread,
        'multi_row_transactions_with_name_pair_sharing_no_word': disjoint,
        'trx_id_equals_transaction_id': [sum(r['trx.id'] == r['transaction_id'] for r in logs if r['trx.id']), sum(bool(r['trx.id']) for r in logs)],
        'cr_entity_id_equals_transaction_id': [sum(c['entity_id'] == c['last_log_transaction_id'] for c in crs), len(crs)],
    }


if __name__ == '__main__':
    print(json.dumps(profile(sheets(sys.argv[1])), ensure_ascii=False, indent=1))
