"""A labelling sample of the places that are still «غير متاح» after merge_classification.py.

The remaining places are mostly licence-only names with no source category, or a low-confidence directory category the
model did not confirm. Neither the name model nor the raw categories can be measured on them, because the surveyor labels
come from a different kind of place. A team-labelled sample drawn from these rows gives both the true accuracy of each
raw category on them and training rows of the right kind (docs/atlas-classification-policy.md).

The sample is stratified: half from rows with a raw directory category (spread across categories), half from rows with
none. The workbook has a dropdown of the 25 main categories, an optional sub_id, and «لا يمكن التحديد» for names that
say nothing. It never overwrites an existing file.

    python3 labeling_sample.py --merged merged.parquet --targets targets.parquet --taxonomy farq_taxonomy.json \
        --estimates poi_estimates.parquet --out labeling_sample.xlsx
"""
import argparse
import json
import os

import duckdb
from openpyxl import Workbook
from openpyxl.worksheet.datavalidation import DataValidation

NO_CATEGORY = ('Unclassified', 'Company (activity unknown)', 'Shop (activity unknown)')
CANNOT_TELL = 'لا يمكن التحديد'
COLUMNS = ['poi_key', 'name_ar', 'name_en', 'license_name', 'tradename', 'description', 'city', 'raw_category',
           'model_main', 'label_main', 'label_sub_id', 'notes']


def draw(db, size, seed):
    """Rows still without a category, half with a raw category (at least a few per category) and half without."""
    nocat = ', '.join(f"'{c}'" for c in NO_CATEGORY)
    db.execute(f"""create temp table pool as
        select t.poi_key, t.name_ar, nullif(t.name_en, 'NULL') name_en, t.source_license_name license_name, t.tradename,
               left(t.description_ar, 200) description, t.city_ar city,
               case when t.category is null or t.category in ({nocat}) then null else t.category end raw_category,
               e.cls_main_top model_main
        from m join t using (poi_key) left join e using (poi_key)
        where m.final_source = 'none' and not coalesce(m.invalid_name, false)""")
    half = size // 2
    cats = db.execute('select count(distinct raw_category) from pool').fetchone()[0] or 1
    # each category gets a floor share, the rest is proportional, so large categories do not hide the small ones
    floor = max(1, half // (4 * cats))
    with_cat = db.execute(f"""
        select * exclude (rk, n) from (
          select *, row_number() over (partition by raw_category order by hash(poi_key || '{seed}')) rk,
                 count(*) over (partition by raw_category) n
          from pool where raw_category is not null)
        where rk <= {floor} + ceil(({half} - {floor} * {cats}) * n / (select count(*) from pool where raw_category is not null))
        order by hash(poi_key || '{seed}') limit {half}""").fetchall()
    without = db.execute(f"""select * from pool where raw_category is null
        order by hash(poi_key || '{seed}') limit {size - len(with_cat)}""").fetchall()
    return with_cat + without


def write(rows, mains, path):
    wb = Workbook()
    ws = wb.active
    ws.title = 'sample'
    ws.sheet_view.rightToLeft = True
    ws.append(COLUMNS)
    for r in rows:
        ws.append(list(r) + [None, None, None])
    lists = wb.create_sheet('mains')
    for name in mains + [CANNOT_TELL]:
        lists.append([name])
    dv = DataValidation(type='list', formula1=f'=mains!$A$1:$A${len(mains) + 1}', allow_blank=True)
    ws.add_data_validation(dv)
    col = chr(ord('A') + COLUMNS.index('label_main'))
    dv.add(f'{col}2:{col}{len(rows) + 1}')
    ws.freeze_panes = 'B2'
    wb.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--merged', required=True, help='merge_classification.py output')
    ap.add_argument('--targets', required=True)
    ap.add_argument('--taxonomy', required=True)
    ap.add_argument('--estimates', required=True, help='classify_poi.py output (for cls_main_top)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--size', type=int, default=1600)
    ap.add_argument('--seed', default='2026-10-30')
    a = ap.parse_args()
    if os.path.exists(a.out):
        raise SystemExit(f'{a.out} exists; refusing to overwrite')
    db = duckdb.connect()
    db.execute(f"create view m as select * from read_parquet('{a.merged}')")
    db.execute(f"create view t as select * from read_parquet('{a.targets}')")
    db.execute(f"create view e as select * from read_parquet('{a.estimates}')")
    mains = list(dict.fromkeys(s['main_ar'] for s in json.load(open(a.taxonomy, encoding='utf-8'))['subs']))
    rows = draw(db, a.size, a.seed)
    write(rows, mains, a.out)
    print(json.dumps({'rows': len(rows), 'with_raw_category': sum(r[7] is not None for r in rows),
                      'mains': len(mains), 'out': a.out}, ensure_ascii=False))


if __name__ == '__main__':
    main()
