# -*- coding: utf-8 -*-
"""Name-evidence corrections to the served classification (poi_taxonomy.parquet), so a picked specialty counts the
shops it names (owner 2026-11-11: the specialty is the unit of every figure).

The 2026-11-11 audit of Riyadh hand-checked 50 businesses in 5 specialties: 40 were right, and fast food was the weak
one (3 of 10). Three narrow rules follow from what was wrong. Each one fires only on the business's own name, and
only when the name says so without doubt; anything less leaves the row as it is.

1. ``fast_food_generic_meals``: a «وجبات سريعة» row whose name is the generic licence wording «… لتقديم الوجبات» /
   "… to serve meals" and carries no fast-food word (burger, pizza, shawarma, broast, falafel, sandwich …) is a
   restaurant of unknown kind, not fast food. It moves to ``food.restaurant``; a company's name («شركة … لتقديم
   الوجبات») goes there too, because chain restaurants hold such licences and catering would be the worse guess.
2. ``laundry_is_car_wash``: a «مغسلة ملابس» row whose name speaks of cars («سيارات», «للمركبات», "car wash") and of no
   clothes or rental, and also of washing (so «لتأجير السيارات» is left alone), is a car wash. It moves to ``auto.car_wash``.
   The reverse rule is NOT applied, because "laundry" is the machine translation of «مغسلة» and appears in hundreds
   of real car-wash names.
3. ``weak_fast_food_name``: a business with no served activity (no row, ``unc.*``, or low confidence) whose name holds
   one of the three fast-food shop words (برجر/burger, بيتزا/pizza, شاورما/shawarma) and no supplier word (frozen,
   factory, boxes, ovens, supplies …) is a fast-food shop, so it gets ``food.fast_food`` at medium confidence.

The output is a delta ``[poi_key, sub_id_before, sub_id, rule]``. :func:`apply` writes a new classification file from
the release one plus the delta, and keeps what each changed row replaced (``orig_sub_id``, ``orig_confidence``) with the
rule as evidence, so every edit is explained and can be undone row by row. The release file itself is never written.

Run directly:
    python build_category_corrections.py --targets <targets.parquet> --taxonomy <poi_taxonomy.parquet> \\
        --out <delta.parquet> [--apply <poi_taxonomy.corrected.parquet>]
"""

from __future__ import annotations

import argparse
import json
import re
from typing import Optional, Tuple

VERSION = "category_corrections_2026_11_11_v1"
SERVED = ("high", "medium")

_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي", "ـ": None})
_MARKS = re.compile(r"[ً-ْ]")


def fold(*names: Optional[str]) -> str:
    """Names joined, lower-cased, Arabic letter variants folded, punctuation to spaces, padded with spaces."""
    text = " ".join(name for name in names if name)
    text = _MARKS.sub("", text.lower()).translate(_FOLD)
    return " " + re.sub(r"[^a-z0-9ء-ي]+", " ", text).strip() + " "


def _rx(*words: str) -> re.Pattern:
    return re.compile("|".join(words))


GENERIC_MEALS = _rx(r"لتقديم الوجبات", r"تقديم الوجبات", r"لتقديم وجبات", r"تقديم وجبات",
                    r" serve meals", r" serving meals", r" for meals ", r" provide meals", r" providing meals")
FAST_FOOD_WORDS = _rx(r"برجر", r"برغر", r"burger", r"بيتزا", r"pizza", r"شاورما", r"شاورمه", r"shawarma", r"shawerma",
                      r"بروست", r"broast", r"فلافل", r"falafel", r"سندويش", r"ساندويش", r"sandwich", r"وجبات سريعه",
                      r"fast food", r"كبده", r"هوت دوق", r"hot ?dog", r"فطاير", r"فطائر", r" pie", r"تشكن", r"chicken",
                      r"دجاج", r"كرسبي", r"crisp", r"wings", r"بطاطس", r"fries", r"زنجر", r"zinger", r"تاكو", r"taco",
                      r"نودلز", r"noodle", r" فول ", r" foul ", r"مشويات سريعه", r"تكا")
WASH_WORDS = _rx(r"مغسل", r"مغاسل", r"غسيل", r"غسل", r"wash", r"laundr", r"clean", r"كلين", r"تلميع", r"polish")
RENTAL_WORDS = _rx(r"تاجير", r"اتاجير", r"rent", r"lease", r"ليموزين", r"limousine")
CAR_WORDS = _rx(r"سيار", r"مركبات", r"المركبه", r"car ?wash", r" cars? ", r" auto ", r"vehicle")
CLOTHES_WORDS = _rx(r"ملابس", r"ثياب", r"ثوب", r"عبايات", r"اشمغه", r"شماغ", r"دراي ?كلين", r"dry ?clean", r"clothes",
                    r"للكي", r" كي ", r"ironing", r"سجاد", r"بطانيات", r"carpet")
SHOP_WORDS = _rx(r"برجر", r"برغر", r"burger", r"بيتزا", r"pizza", r"شاورما", r"شاورمه", r"shawarma", r"shawerma")
SUPPLIER_WORDS = _rx(r"مجمد", r"frozen", r"مصنع", r"factory", r"علب", r"boxes", r"packag", r"تغليف", r"معدات",
                     r"equipment", r"افران", r"oven", r"توريد", r"supplies", r"supplier", r"جمله", r"wholesale",
                     r"مستلزمات", r"مكاين", r"مكائن", r"machine")


def _weak(sub_id: Optional[str], confidence: Optional[str]) -> bool:
    return not sub_id or sub_id.startswith("unc.") or (confidence or "").lower() not in SERVED


def correct(sub_id: Optional[str], confidence: Optional[str], name_ar: Optional[str],
            name_en: Optional[str]) -> Optional[Tuple[str, str]]:
    """``(new_sub_id, rule)`` when the name settles a better activity without doubt, else ``None``."""
    name = fold(name_ar, name_en)
    if name.strip() == "":
        return None
    served = not _weak(sub_id, confidence)
    if served and sub_id == "food.fast_food" and GENERIC_MEALS.search(name) and not FAST_FOOD_WORDS.search(name):
        return "food.restaurant", "fast_food_generic_meals"
    if (served and sub_id == "personal.laundry" and CAR_WORDS.search(name) and WASH_WORDS.search(name)
            and not CLOTHES_WORDS.search(name) and not RENTAL_WORDS.search(name)):
        return "auto.car_wash", "laundry_is_car_wash"
    if not served and SHOP_WORDS.search(name) and not SUPPLIER_WORDS.search(name):
        return "food.fast_food", "weak_fast_food_name"
    return None


def build(targets_path: str, taxonomy_path: str, out_path: str) -> dict:
    """Write the delta for every business the rules correct; returns counts only."""
    import duckdb

    db = duckdb.connect()
    db.execute("""create table cur as select poi_key, any_value(sub_id) sub_id, any_value(confidence) confidence
                  from read_parquet(?) group by poi_key""", [taxonomy_path])
    # names come from the directory; a business absent from the classification still counts as weak (rule 3)
    rows = db.execute("""select t.poi_key, c.sub_id, c.confidence, any_value(t.name_ar), any_value(t.name_en)
                         from read_parquet(?) t left join cur c using (poi_key)
                         where t.poi_key is not null group by t.poi_key, c.sub_id, c.confidence""",
                      [targets_path]).fetchall()
    delta = []
    for key, sub_id, confidence, name_ar, name_en in rows:
        hit = correct(sub_id, confidence, name_ar, name_en)
        if hit:
            delta.append((key, sub_id, hit[0], hit[1]))
    db.execute("create table delta(poi_key varchar, sub_id_before varchar, sub_id varchar, rule varchar)")
    db.executemany("insert into delta values (?, ?, ?, ?)", delta)
    db.execute(f"copy delta to '{out_path}' (format parquet, compression zstd)")
    report = {"version": VERSION, "businesses": len(rows),
              "corrections": dict(db.execute("select rule, count(*) from delta group by 1 order by 2 desc").fetchall())}
    db.close()
    return report


def apply(taxonomy_path: str, delta_path: str, out_path: str) -> dict:
    """The release classification with the delta applied: one served row per corrected business, keeping what it
    replaced; every other row copied as it is."""
    import duckdb

    db = duckdb.connect()
    db.execute("create table orig as select * from read_parquet(?)", [taxonomy_path])
    db.execute("create table delta as select * from read_parquet(?)", [delta_path])
    columns = [row[0] for row in db.execute("describe orig").fetchall()]
    keep = ", ".join(f"o.{column}" for column in columns)
    db.execute(f"""create table out as
        select {keep}, null::varchar orig_sub_id, null::varchar orig_confidence, null::varchar correction
        from orig o where o.poi_key not in (select poi_key from delta)
        union all by name
        select d.poi_key, d.sub_id, 'name_correction' as source, 'medium' as confidence,
               d.rule as evidence, c.sub_id orig_sub_id, c.confidence orig_confidence, '{VERSION}:' || d.rule correction
        from delta d left join (select poi_key, any_value(sub_id) sub_id, any_value(confidence) confidence
                                from orig group by poi_key) c using (poi_key)""")
    partial = out_path + ".partial"
    db.execute(f"copy out to '{partial}' (format parquet, compression zstd)")
    import os
    os.replace(partial, out_path)
    report = {"rows_before": db.execute("select count(*) from orig").fetchone()[0],
              "rows_after": db.execute("select count(*) from out").fetchone()[0],
              "corrected": db.execute("select count(*) from delta").fetchone()[0]}
    db.close()
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--targets", required=True)
    parser.add_argument("--taxonomy", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--apply", help="also write the corrected classification here")
    args = parser.parse_args(argv)
    report = build(args.targets, args.taxonomy, args.out)
    if args.apply:
        report["apply"] = apply(args.taxonomy, args.out, args.apply)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
