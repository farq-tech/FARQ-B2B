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

    def test_broken_plural_names_the_trade(self):   # owner report 2026-10-16: «لواصق» went to rubber and industrial-supply shops
        u = self.fam('لواصق')
        self.assertIn('build.construction_chemicals', u['targets']); self.assertIn('build.hardware_tools', u['targets'])
        self.assertNotIn('ind.rubber', u['targets']); self.assertNotIn('ind.industrial_supplies', u['targets'])
        self.assertIn('ind.rubber', u['fallback_targets'])

    def test_specialty_anchors_before_family(self):   # the most specific level the request names decides the targets
        for q, sub in [('شريط بيوتيل', 'build.insulation'), ('غراء', 'build.hardware_tools'), ('ممبرين', 'build.insulation')]:
            u = self.fam(q)
            self.assertEqual(u['anchor'], 'specialty', q); self.assertIn(sub, u['targets'], q)
            self.assertNotIn('ind.rubber', u['targets'], q)

    def test_trade_word_keeps_the_lead(self):   # «سباك» is a trade, not the sanitary-shop specialty that mentions it
        u = self.fam('سباك')
        self.assertIn('contract.plumbing', u['targets']); self.assertNotIn('build.general_materials', u['targets'])

    def test_seller_specialty_targets_its_buyers(self):
        u = self.fam('شريط بيوتيل', 'marketing')
        self.assertIn('contract.waterproofing', u['targets']); self.assertNotIn('build.insulation', u['targets'])

    def test_onboarding_suggestions(self):
        main = self.tx.subs['build.insulation']['main_id']   # the supplier picks his sector first
        got = {x['specialty_id'] for x in self.tx.suggest_specialties('ممبرين، شريط بيوتيل، فوم رش', main)}
        self.assertIn('build.insulation.butyl_tape', got); self.assertIn('build.insulation.bitumen_membrane', got)
        self.assertTrue(all(self.tx.subs[self.tx.specs[x]['sub_id']]['main_id'] == main for x in got))

    def test_service_radius_defaults(self):
        self.assertEqual(ts.service_radius('ind.plastic', ''), 1000)
        self.assertGreater(ts.service_radius('build.insulation', 'wholesale|retail'), ts.service_radius('food.cafe', 'retail'))

    def test_boq_fasteners_do_not_match_food_nuts(self):
        u = self.fam('SS 316 Bolt & Nut M24 X 150')
        self.assertEqual(u['families'], ['tool_fasteners'])
        self.assertEqual(u['targets'], {'build.fasteners': 3.0})

    def test_boq_valves_do_not_match_bottled_water(self):
        u = self.fam('صمام مياه 300 مم air release valve flow sensor')
        self.assertEqual(u['families'], ['mep_pipes_fittings'])
        self.assertEqual(u['targets'], {'build.pipes_fittings': 3.0})

    def test_boq_exhaust_fan_is_ventilation_supply(self):
        u = self.fam('مروحة شفط 25x25 exhaust fan')
        self.assertEqual(u['families'], ['mep_ducts_ventilation'])
        self.assertEqual(u['targets'], {'build.hvac_supply': 3.0})

    def test_boq_lighting_does_not_match_ceiling_or_auto_lighting(self):
        u = self.fam('لوحة LED فيليبس 60x60 34W')
        self.assertEqual(u['families'], ['mep_lighting'])
        self.assertEqual(u['targets'], {'build.lighting_supply': 3.0})

    def test_boq_electrical_sockets_and_conduits_stay_electrical(self):
        socket = self.fam('مقبس كهربائي 16A')
        conduit = self.fam('مواسير PVC duct bank كهرباء')
        self.assertEqual(socket['targets'], {'build.electrical_supply': 3.0})
        self.assertEqual(conduit['targets'], {'build.electrical_supply': 3.0})

    def test_boq_tanks_keep_the_existing_product_family_match(self):
        u = self.fam('خزان GRP 30 متر مكعب')
        self.assertEqual(u['families'], ['mep_water_tanks'])
        self.assertEqual(list(u['targets']), ['build.pumps_tanks'])

    def test_attached_boq_pr_fasteners_never_cross_into_food_or_auto(self):
        for line in (
            'SS 316 Bolt & Nut, M24 x 150', 'SS 316 Bolts & Nuts, M24 x 120',
            'SS 316 washer, M24', 'SS 316 Bolt, M18 x 100', 'SS 316 Nut, M18',
            'SS 316 washer, M18', 'SS 316 Bolt, M16 x 120', 'SS 316 Nut, M16',
            'SS 316 washer, M16', 'SS 316 Bolt, M16 x 100',
        ):
            u = self.fam(line)
            self.assertEqual(u['families'], ['tool_fasteners'], line)
            self.assertEqual(u['targets'], {'build.fasteners': 3.0}, line)

    def test_attached_electrical_pr_items_stay_in_electrical_supply(self):
        for line in ('3 pin duplex socket', '3 pin socket', '16A male socket'):
            u = self.fam(line)
            self.assertEqual(u['targets'], {'build.electrical_supply': 3.0}, line)
        u = self.fam('25x25 exhaust fan')
        self.assertEqual(u['targets'], {'build.hvac_supply': 3.0})

    def test_attached_philips_luminaires_and_accessories_never_become_auto_batteries(self):
        lines = (
            'Philips WT065C G3 LED48S/840 PSU L1200 BN',
            'VIVA emergency battery for 120cm', 'Philips panel 60x60 34W 6.5K',
            'VIVA emergency battery for 60x60', 'Philips D/L2000L18W6.5K D200',
            'Philips frame surface D200', 'Philips exit up/down/L&R 2.2W 7K',
            'Philips exit down 2.2W 7K', 'Philips emergency bulkhead 3.5W 6.5K',
            'Philips DNO69B LED21/865 PSU GM1',
        )
        for line in lines:
            u = self.fam(line)
            self.assertEqual(u['families'], ['mep_lighting'], line)
            self.assertEqual(u['targets'], {'build.lighting_supply': 3.0}, line)

    def test_attached_water_and_irrigation_items_are_scoped_to_relevant_suppliers(self):
        expected = {
            'UPS for access control gates': {'elec.it_networking_supply': 3.0, 'build.electrical_supply': 2.0},
            '300 mm gate valve with surface box': {'build.pipes_fittings': 3.0},
            'potable water connection': {'contract.plumbing': 3.0},
            'water meter shade': {'build.metal_fabrication': 3.0},
            'air release valve ARV': {'build.pipes_fittings': 3.0},
            'GRP holding tank 30 m3': {'build.pumps_tanks': 3.0},
            'GRP holding tank 90 m3': {'build.pumps_tanks': 3.0},
            'flow sensor valve 50mm': {'build.pipes_fittings': 3.0},
            'master valve 50mm': {'build.pipes_fittings': 3.0},
            'backflow preventer 50mm': {'build.pipes_fittings': 3.0},
            'irrigation washout with chamber': {'build.pipes_fittings': 3.0, 'build.landscaping_supply': 2.0},
            'irrigation air release valve ARV': {'build.pipes_fittings': 3.0, 'build.landscaping_supply': 2.0},
            'irrigation flow sensor valve with box 50mm': {'build.pipes_fittings': 3.0, 'build.landscaping_supply': 2.0},
            'irrigation master valve with box 50mm': {'build.pipes_fittings': 3.0, 'build.landscaping_supply': 2.0},
            'irrigation backflow preventer with box 50mm': {'build.pipes_fittings': 3.0, 'build.landscaping_supply': 2.0},
        }
        for line, targets in expected.items():
            self.assertEqual(self.fam(line)['targets'], targets, line)

    def test_attached_civil_and_hvac_boq_items_do_not_cross_families(self):
        expected = {
            'low voltage concrete encased PVC duct bank 2x3x110mm': {'build.electrical_supply': 3.0},
            'handhole type A': {'build.electrical_supply': 3.0},
            'communication duct bank 10x50mm': {'elec.it_networking_supply': 3.0, 'build.electrical_supply': 2.0},
            'interlock block paver 200x100x80mm': {'build.interlock_pavers': 3.0, 'ind.concrete_products': 2.0},
            'concrete access ramp': {'build.ready_mix': 3.0, 'contract.civil_infra': 2.0},
            'chainlink swing security gate double leaf': {'build.metal_fabrication': 3.0},
            'sand trap louver 2280x2280mm': {'build.hvac_supply': 3.0},
            'cast iron soil waste vent drain pipes 32mm': {'build.pipes_fittings': 3.0, 'build.plumbing_supply': 2.0},
            'roof mounted upblast exhaust fan': {'build.hvac_supply': 3.0},
            'concrete screed 50mm slab on grade': {'build.ready_mix': 3.0, 'contract.civil_infra': 2.0},
            '300mm thick rigid concrete slab': {'build.ready_mix': 3.0, 'contract.civil_infra': 2.0},
            'surface preparation with power floating on slab on grade': {'contract.civil_infra': 3.0, 'contract.general': 2.0},
        }
        for line, targets in expected.items():
            self.assertEqual(self.fam(line)['targets'], targets, line)

    def test_every_canonical_product_family_label_resolves_to_only_its_sellers(self):
        checked = 0
        for family_id, family in self.tx.families.items():
            expected = {sub: (3.0 if strength >= 2 else 2.0)
                        for sub, strength in self.tx.rel['sells'].get(family_id, []) if self.tx._sub_ok(sub)}
            for field in ('family_ar', 'family_en'):
                label = (family.get(field) or '').strip()
                if not label:
                    continue
                result = self.fam(label)
                self.assertEqual(result['families'], [family_id], f'{family_id}: {field}={label!r}')
                self.assertEqual(result['targets'], expected, f'{family_id}: {field}={label!r}')
                self.assertEqual(result['source'], 'exact_family', f'{family_id}: {field}={label!r}')
                wrapped = self.fam(f'ابي موردين {label}')
                self.assertEqual(wrapped['families'], [family_id], f'{family_id}: wrapped {field}={label!r}')
                self.assertEqual(wrapped['targets'], expected, f'{family_id}: wrapped {field}={label!r}')
                checked += 1
        self.assertEqual(checked, 700)

    def test_every_product_example_is_exactly_resolved_or_explicitly_ambiguous(self):
        checked = 0
        for family_id, family in self.tx.families.items():
            expected = {sub: (3.0 if strength >= 2 else 2.0)
                        for sub, strength in self.tx.rel['sells'].get(family_id, []) if self.tx._sub_ok(sub)}
            for field in ('examples_ar', 'examples_en'):
                for example in (family.get(field) or '').split('|'):
                    example = example.strip()
                    if len(ts.norm(example)) < 3:
                        continue
                    query = f'ابي موردين {example}'
                    result = self.fam(query)
                    phrase = ts.norm(example)
                    canonical_ids = set(self.tx.family_labels.get(phrase, ()))
                    example_ids = set(self.tx.example_labels.get(phrase, ()))
                    ids = canonical_ids or example_ids
                    expected_family = next(iter(canonical_ids)) if len(canonical_ids) == 1 else family_id
                    expected = {sub: (3.0 if strength >= 2 else 2.0)
                                for sub, strength in self.tx.rel['sells'].get(expected_family, []) if self.tx._sub_ok(sub)}
                    named, _ = self.tx.subs_in(phrase)
                    one_word_conflict = (not canonical_ids and len(phrase.split()) == 1 and bool(set(named) - expected.keys()))
                    if not canonical_ids and (len(example_ids) > 1 or one_word_conflict):
                        self.assertEqual(result['targets'], {}, f'ambiguous alias should not recommend: {example!r}')
                        self.assertEqual(result['source'], 'ambiguous_exact_example', example)
                    else:
                        self.assertEqual(result['families'], [expected_family], f'{family_id}: {field}={example!r}')
                        self.assertTrue(result['targets'], f'{family_id}: {field}={example!r}')
                        self.assertTrue(set(result['targets']).issubset(expected), f'{family_id}: {field}={example!r}')
                        self.assertIn(result['source'], ('exact_family', 'exact_example'), f'{family_id}: {field}={example!r}')
                    checked += 1
        self.assertEqual(checked, 3308)


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
