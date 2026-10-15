"""Run: python3 services/targeting-taxonomy/test_taxonomy_search.py  (needs duckdb; uses the repo taxonomy and a tiny synthetic directory)."""
import os, sys, tempfile, unittest
import duckdb
sys.path.insert(0, os.path.dirname(__file__))
import taxonomy_search as ts

TAX = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'qa', 'targeting', 'taxonomy')


class Understand(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.pop('ANTHROPIC_API_KEY', None)   # tests never call the model
        cls.tx = ts.Taxonomy(TAX, '/dev/null')

    def fam(self, q, obj='purchase'): return self.tx.understand(q, obj)

    def test_coffee_buyers(self):
        u = self.fam('ابي جهات ممكن تشتري مني حبوب قهوة', 'marketing')
        self.assertEqual(u['families'], ['bev_coffee_beans'])
        self.assertIn('food.cafe', u['targets']); self.assertIn('hosp.hotel', u['targets'])

    def test_plumbing_shops_not_services(self):
        self.assertEqual(list(self.fam('ادور محلات سباكة')['targets']), ['build.plumbing_supply'])

    def test_gypsum_board_prefix(self):   # «بورد» must not lose its «ب» and become «ورد»
        u = self.fam('ادور محلات مختصة بالواح الجبس بورد')
        self.assertEqual(u['families'], ['fns_gypsum']); self.assertEqual(list(u['targets']), ['build.gypsum'])

    def test_customer_named_by_seller(self):
        self.assertEqual(list(self.fam('أبيع زي موحد للمطاعم', 'marketing')['targets']), ['food.restaurant'])
        self.assertEqual(list(self.fam('أبيع مستلزمات صالونات لمحلات الحلاقة', 'marketing')['targets']), ['beauty.barber'])

    def test_cleaning_goods_vs_service(self):
        self.assertEqual(self.fam('أبيع مواد تنظيف', 'marketing')['families'], ['cln_detergents'])
        self.assertEqual(list(self.fam('أبي شركة نظافة')['targets']), ['biz.cleaning_services'])

    def test_office_chairs(self):
        self.assertEqual(self.fam('أبي كراسي مكتبية')['families'], ['furn_office'])

    def test_unknown_text_falls_back(self):
        self.assertEqual(self.fam('xyzzy')['targets'], {})

    def test_noncommercial_never_targeted(self):
        for q, obj in [('أبيع سجاد', 'marketing'), ('أبيع مواد تنظيف', 'marketing')]:
            self.assertFalse([s for s in self.fam(q, obj)['targets'] if s.startswith(('noncom.', 'unc.'))])


class Search(unittest.TestCase):
    def test_rows_and_reason(self):
        d = tempfile.mkdtemp()
        db = duckdb.connect()
        cols = ('poi_key,name_ar,name_en,city_en,latitude,longitude,phone_norm,phone_kind,has_whatsapp,email,source_count,category,legal_name,brand_name,'
                'secondary_category,category_l3,category_ar,district_ar,district_en,region_ar,region_en,completeness_pct,company_status,lifecycle_state').split(',')
        types = {'latitude': 'double', 'longitude': 'double', 'has_whatsapp': 'boolean', 'source_count': 'integer', 'completeness_pct': 'double'}
        db.execute('create table dir (' + ','.join(f"{c} {types.get(c, 'varchar')}" for c in cols) + ')')
        base = dict.fromkeys(cols); base.update(city_en='Riyadh', latitude=24.7, longitude=46.7, has_whatsapp=False, source_count=1, completeness_pct=10)
        for row in [dict(base, poi_key='a', name_ar='مقهى الصباح', name_en='Sabah Cafe', category='Coffee Shops', category_ar='مقاهي', district_ar='العليا', has_whatsapp=True, phone_norm='966500000000'),
                    dict(base, poi_key='b', name_ar='ChIJabcdefghijklmn', category='Coffee Shops'),
                    dict(base, poi_key='c', name_ar='مسجد', category='Mosques')]:
            db.execute(f"insert into dir values ({','.join('?' * len(cols))})", [row[c] for c in cols])
        db.execute(f"copy dir to '{d}/dir.parquet' (format parquet)")
        db.execute(f"""copy (select * from (values ('a','food.cafe','activity','high',''),('b','food.cafe','activity','high',''),('c','noncom.mosque','activity','high',''))
            t(poi_key,sub_id,source,confidence,evidence)) to '{d}/poi.parquet' (format parquet)""")
        tx = ts.Taxonomy(TAX, f'{d}/poi.parquet')
        r = tx.search(db, f'{d}/dir.parquet', 'أبيع حبوب قهوة', 'Riyadh', 'marketing')
        self.assertEqual([x['poi_key'] for x in r['rows']], ['a'])          # place-id name dropped, mosque never a target
        self.assertIn('احتياج الشراء غير مثبت', r['rows'][0]['reason'])
        self.assertEqual(r['understood']['direction'], 'buyer')


if __name__ == '__main__':
    unittest.main(verbosity=1)
