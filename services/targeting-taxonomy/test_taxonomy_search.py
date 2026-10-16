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


    def test_specialty_names_its_subcategory(self):   # «شريط بيوتيل» alone: the specialty gives the subcategory
        u = self.fam('أبي شريط بيوتيل')
        self.assertIn('build.insulation', u['targets']); self.assertIn('build.insulation.butyl_tape', u['specialties'])

    def test_specialty_does_not_widen_an_understood_request(self):   # «جبس بورد» stays building gypsum, never mining
        self.assertNotIn('energy.mining', self.fam('ادور محلات مختصة بالواح الجبس بورد')['targets'])

    def test_onboarding_suggestions(self):
        main = self.tx.subs['build.insulation']['main_id']   # the supplier picks his sector first
        got = {x['specialty_id'] for x in self.tx.suggest_specialties('ممبرين، شريط بيوتيل، فوم رش', main)}
        self.assertIn('build.insulation.butyl_tape', got); self.assertIn('build.insulation.bitumen_membrane', got)
        self.assertTrue(all(self.tx.subs[self.tx.specs[x]['sub_id']]['main_id'] == main for x in got))

    def test_service_radius_defaults(self):
        self.assertEqual(ts.service_radius('ind.plastic', ''), 1000)
        self.assertGreater(ts.service_radius('build.insulation', 'wholesale|retail'), ts.service_radius('food.cafe', 'retail'))


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
        db.execute(f"""copy (select 'c' poi_key, '+966500000001' phone, 'mobile' phone_kind, true has_whatsapp, 'directory_twin' phone_source, 'x' phone_source_name
            union all select 'a', '+966511111111', 'mobile', true, 'directory_twin', 'x') to '{d}/overlay.parquet' (format parquet)""")
        os.makedirs(f'{d}/enrich', exist_ok=True)
        db.execute(f"copy (select 'hh:9' poi_key, 'delete' last_operation, 'approved' last_review_status) to '{d}/enrich/hudhud_logs_status.parquet' (format parquet)")
        tx = ts.Taxonomy(TAX, f'{d}/poi.parquet', f'{d}/overlay.parquet')
        r = tx.search(db, f'{d}/dir.parquet', 'أبيع حبوب قهوة', 'Riyadh', 'marketing')
        self.assertEqual([x['poi_key'] for x in r['rows']], ['a'])          # place-id name dropped, mosque never a target
        self.assertIn('احتياج الشراء غير مثبت', r['rows'][0]['reason'])
        self.assertEqual(r['understood']['direction'], 'buyer')
        self.assertEqual(r['rows'][0]['phone'], '966500000000')                # an existing number is never replaced
        self.assertNotIn('phone_source', r['rows'][0])

    def test_hudhud_deleted_ranked_last_and_not_sendable(self):
        d = tempfile.mkdtemp(); db = duckdb.connect(); os.makedirs(f'{d}/enrich')
        base = "null::varchar name_en, 'Riyadh' city_en, 24.7 latitude, 46.7 longitude, '966500000001' phone_norm, 'mobile' phone_kind, true has_whatsapp, null::varchar email, 1 source_count, 'Coffee Shops' category, null::varchar legal_name, null::varchar brand_name, null::varchar secondary_category, null::varchar category_l3, 'مقاهي' category_ar, null::varchar district_en, null::varchar region_ar, null::varchar region_en, 10.0 completeness_pct, null::varchar company_status, null::varchar lifecycle_state"
        db.execute(f"copy (select 'hh:1' poi_key, 'مقهى أ' name_ar, 'أ' district_ar, {base} union all select 'hh:9', 'مقهى ب', 'ب', {base}) to '{d}/dir.parquet' (format parquet)")
        db.execute(f"copy (select * from (values ('hh:1','food.cafe','activity','high',''),('hh:9','food.cafe','activity','high','')) t(poi_key,sub_id,source,confidence,evidence)) to '{d}/poi.parquet' (format parquet)")
        db.execute(f"copy (select 'hh:9' poi_key, 'delete' last_operation, 'approved' last_review_status) to '{d}/enrich/hudhud_logs_status.parquet' (format parquet)")
        rows = ts.Taxonomy(TAX, f'{d}/poi.parquet').search(db, f'{d}/dir.parquet', 'أبيع حبوب قهوة', 'Riyadh', 'marketing')['rows']
        self.assertEqual([r['poi_key'] for r in rows], ['hh:1', 'hh:9'])
        self.assertTrue(rows[1]['hudhud_deleted']); self.assertFalse(rows[1]['sendable']); self.assertNotIn('hudhud_deleted', rows[0])

    def test_overlay_fills_missing_number(self):
        d = tempfile.mkdtemp(); db = duckdb.connect()
        db.execute(f"""copy (select 'z' poi_key, 'مقهى النخيل' name_ar, null::varchar name_en, 'Riyadh' city_en, 24.7 latitude, 46.7 longitude, null::varchar phone_norm,
            null::varchar phone_kind, false has_whatsapp, null::varchar email, 1 source_count, 'Coffee Shops' category, null::varchar legal_name, null::varchar brand_name,
            null::varchar secondary_category, null::varchar category_l3, 'مقاهي' category_ar, 'النخيل' district_ar, null::varchar district_en, null::varchar region_ar,
            null::varchar region_en, 10.0 completeness_pct, null::varchar company_status, null::varchar lifecycle_state) to '{d}/dir.parquet' (format parquet)""")
        db.execute(f"copy (select 'z' poi_key, 'food.cafe' sub_id, 'activity' as source, 'high' as confidence, '' as evidence) to '{d}/poi.parquet' (format parquet)")
        db.execute(f"copy (select 'z' poi_key, '+966522222222' phone, 'mobile' phone_kind, true has_whatsapp, 'directory_twin' phone_source, 'نسخة أخرى' phone_source_name) to '{d}/o.parquet' (format parquet)")
        row = ts.Taxonomy(TAX, f'{d}/poi.parquet', f'{d}/o.parquet').search(db, f'{d}/dir.parquet', 'أبيع حبوب قهوة', 'Riyadh', 'marketing')['rows'][0]
        self.assertEqual((row['phone'], row['has_whatsapp'], row['phone_source']), ('+966522222222', True, 'directory_twin'))


if __name__ == '__main__':
    unittest.main(verbosity=1)
