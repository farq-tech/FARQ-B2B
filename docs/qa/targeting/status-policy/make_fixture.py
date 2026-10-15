"""Synthetic directory with the production schema (no real records). Usage: make_fixture.py OUT.parquet [closed_key]"""
import ast, sys, duckdb, pathlib
SCHEMA = ast.literal_eval(pathlib.Path(__file__).with_name('schema.txt').read_text())
# (poi_key, company_status, lifecycle_state, has_whatsapp, phone)   — numbers are synthetic and never sent
ROWS = [
    ('s_open', 'open', None, True, '+966500000001'),
    ('s_open_active', 'Active', None, True, '+966500000002'),
    ('s_open_draft', 'open', 'draft', True, '+966500000003'),
    ('s_open_archived', 'open', 'archived', True, '+966500000004'),
    ('s_open_ready', 'open', 'ready to publish', True, '+966500000005'),
    ('s_hidden', 'hidden', None, True, '+966500000006'),
    ('s_null', None, None, True, '+966500000007'),
    ('s_invalid', 'مؤسسة الياسمين', None, True, '+966500000008'),
    ('s_numeric', '1.0', None, True, '+966500000009'),
    ('c_pc1', 'Permanently Closed', None, True, '+966500000010'),
    ('c_pc2', 'permanently closed', 'archived', True, '+966500000011'),
    ('c_pc3', 'permanently_closed', None, True, '+966500000012'),
    ('c_pc4', '  Permanently   Closed ', None, True, '+966500000013'),
    ('c_pc5', 'Closed', 'draft', True, '+966500000014'),
    ('c_pc6', 'cancelled', None, True, '+966500000015'),
    ('c_pc7', 'ملغى', None, True, '+966500000016'),
    ('c_pc8', 'ملغي', None, True, '+966500000017'),
    ('c_lc1', 'open', 'closed', True, '+966500000018'),
    ('c_lc2', 'open', 'permanently_closed', True, '+966500000019'),
    ('t_1', 'Temporarily Closed', None, True, '+966500000020'),
    ('t_2', 'temporary closed', None, True, '+966500000021'),
    ('t_3', 'temporarily_closed', None, True, '+966500000022'),
    ('i_1', 'Inactive', None, True, '+966500000023'),
    ('i_2', 'INACTIVE', None, True, '+966500000024'),
    ('i_3', 'inactive ', None, True, '+966500000025'),
    ('s_nowa', 'open', None, False, '+966110000000'),
    ('s_badmobile', 'open', None, True, '+96650000'),
    ('dupkey', 'open', None, True, '+966500000026'),
    ('dupkey', 'open', None, True, '+966500000027'),
]

def build(out, closed_key=None):
    c = duckdb.connect()
    c.execute('create table t (' + ', '.join(f'"{n}" {ty}' for n, ty in SCHEMA) + ')')
    for i, (k, cs, lc, wa, ph) in enumerate(ROWS):
        if k == closed_key: cs = 'Permanently Closed'
        vals = {n: None for n, _ in SCHEMA}
        vals.update(poi_key=k, name_ar=f'مؤسسة سباكة اختبار {i}', name_en=f'Test plumbing {i}', category='Plumbing', category_ar='سباكة',
                    company_status=cs, lifecycle_state=lc, region_en='Riyadh', city_en='Riyadh', district_en='Test', district_ar='اختبار',
                    latitude=24.7 + i / 1000, longitude=46.7 + i / 1000, phone_norm=ph, phone_raw=ph,
                    phone_kind='mobile' if ph.startswith('+9665') else 'landline', has_whatsapp=wa, sources=['fixture'], source_count=1,
                    completeness_pct=50.0, search_text=f'مؤسسة سباكة اختبار {i} plumbing سباكه')
        c.execute('insert into t values (' + ','.join('?' for _ in SCHEMA) + ')', [vals[n] for n, _ in SCHEMA])
    c.execute(f"copy t to '{out}' (format parquet)")

if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
