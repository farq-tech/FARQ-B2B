"""Name-evidence corrections (build_category_corrections): each rule fires only when the name settles it, using
names seen in the 2026-11-11 Riyadh audit."""
import pathlib
import sys
import tempfile
import unittest

import duckdb

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from build_category_corrections import apply, build, correct  # noqa: E402


class FastFoodGenericMealsTests(unittest.TestCase):
    def test_licence_wording_without_a_fast_food_word_is_a_restaurant(self):
        for name_ar, name_en in [
            (None, "His Excellency Lebanon Restaurant to serve meals"),
            ("مطاعم روابي همدان لتقديم الوجبات", None),
            (None, "Ahmed Ayed Muhammad Al -Asmari Foundation for meals"),
        ]:
            self.assertEqual(correct("food.fast_food", "medium", name_ar, name_en),
                             ("food.restaurant", "fast_food_generic_meals"), name_ar or name_en)

    def test_a_company_serving_meals_is_still_a_restaurant(self):
        # chain restaurants hold «شركة … لتقديم الوجبات» licences, so catering would be the worse guess
        self.assertEqual(correct("food.fast_food", "high", "فرع شركة مانتو روز لتقديم الوجبات", None),
                         ("food.restaurant", "fast_food_generic_meals"))

    def test_a_fast_food_word_keeps_it_fast_food(self):
        for name in ("مطعم شاك برجر لتقديم الوجبات", "Pie Damascene fast food", "Broast house to serve meals",
                     "مطعم فلافل لتقديم الوجبات"):
            self.assertIsNone(correct("food.fast_food", "high", name, None), name)

    def test_only_fast_food_rows_and_only_served_ones(self):
        self.assertIsNone(correct("food.restaurant", "high", None, "Tannour Sham Restaurant to serve meals"))
        self.assertIsNone(correct("food.fast_food", "low", None, "Tannour Sham Restaurant to serve meals"))


class LaundryIsCarWashTests(unittest.TestCase):
    def test_car_wash_names_in_laundry_move(self):
        for name_ar, name_en in [("مغسلة النخلة الحمراء للمركبات", "Red Palm Car Wash"),
                                 ("مغسلة خالد", "Khalid Car Wash"),
                                 (None, "Beautiful laundries Abdul Rahman Abu Najafah for auto services")]:
            self.assertEqual(correct("personal.laundry", "high", name_ar, name_en),
                             ("auto.car_wash", "laundry_is_car_wash"), name_ar or name_en)

    def test_car_without_washing_is_left_alone(self):
        self.assertIsNone(correct("personal.laundry", "high", "وسام الأمجاد لتأجير السيارات", "Al Wsam Alamjad Ltajyr Alsyarat"))
        self.assertIsNone(correct("personal.laundry", "high", "اطلس اتاجير السيارات", "Laundry"))

    def test_clothes_words_keep_a_laundry(self):
        self.assertIsNone(correct("personal.laundry", "high", "مغسلة ملابس وسيارات", None))
        self.assertIsNone(correct("personal.laundry", "high", "مغسلة دراي كلين", "cars dry clean"))

    def test_no_reverse_rule_from_the_word_laundry(self):
        # «مغسلة» is machine-translated to "laundry": a car wash named so must stay a car wash
        self.assertIsNone(correct("auto.car_wash", "high", "مغسلة القشيب", "Al Qushaib Laundry"))


class WeakFastFoodNameTests(unittest.TestCase):
    def test_unclassified_burger_pizza_shawarma_shops(self):
        for sub, conf, name in [(None, None, "HALA BURGER"), ("unc.unknown", "low", "شيخ البرغر"),
                                ("food.restaurant", "low", "Little Caesars Pizza"), (None, None, "شاورما عايض")]:
            self.assertEqual(correct(sub, conf, name, None), ("food.fast_food", "weak_fast_food_name"), name)

    def test_suppliers_are_not_shops(self):
        for name in ("برجر مجمد بالجملة", "Pizza boxes supplier", "مصنع شاورما", "افران بيتزا"):
            self.assertIsNone(correct(None, None, name, None), name)

    def test_a_served_label_is_never_overridden_by_this_rule(self):
        self.assertIsNone(correct("food.restaurant", "high", "مطعم برجر مدخن", None))

    def test_empty_name(self):
        self.assertIsNone(correct(None, None, None, None))


class BuildAndApplyTests(unittest.TestCase):
    def test_delta_and_corrected_file_keep_what_they_replaced(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            db = duckdb.connect()
            db.execute("create table t(poi_key varchar, name_ar varchar, name_en varchar)")
            db.executemany("insert into t values (?, ?, ?)", [
                ("a", None, "Hadramout Ruwad Restaurant to serve meals"),
                ("b", "مغسلة خالد", "Khalid Car Wash"),
                ("c", "هاريز بيتزا", None),          # not in the classification at all
                ("d", "صيدلية كنوز", "Kunooz"),
            ])
            db.execute(f"copy t to '{root / 't.parquet'}' (format parquet)")
            db.execute("create table c(poi_key varchar, sub_id varchar, source varchar, confidence varchar, evidence varchar)")
            db.executemany("insert into c values (?, ?, ?, ?, ?)", [
                ("a", "food.fast_food", "name", "medium", "x"),
                ("b", "personal.laundry", "activity", "high", "x"),
                ("d", "health.pharmacy", "activity", "high", "x"),
            ])
            db.execute(f"copy c to '{root / 'c.parquet'}' (format parquet)")
            report = build(str(root / "t.parquet"), str(root / "c.parquet"), str(root / "delta.parquet"))
            self.assertEqual(report["corrections"], {"fast_food_generic_meals": 1, "laundry_is_car_wash": 1, "weak_fast_food_name": 1})
            applied = apply(str(root / "c.parquet"), str(root / "delta.parquet"), str(root / "out.parquet"))
            self.assertEqual(applied["corrected"], 3)
            rows = {r[0]: r[1:] for r in db.execute(
                f"select poi_key, sub_id, confidence, orig_sub_id, orig_confidence, correction from '{root / 'out.parquet'}'").fetchall()}
            db.close()
        self.assertEqual(rows["a"][:4], ("food.restaurant", "medium", "food.fast_food", "medium"))
        self.assertEqual(rows["b"][:4], ("auto.car_wash", "medium", "personal.laundry", "high"))
        self.assertEqual(rows["c"][:4], ("food.fast_food", "medium", None, None))
        self.assertEqual(rows["d"], ("health.pharmacy", "high", None, None, None))
        self.assertTrue(rows["a"][4].endswith(":fast_food_generic_meals"))


if __name__ == "__main__":
    unittest.main()
