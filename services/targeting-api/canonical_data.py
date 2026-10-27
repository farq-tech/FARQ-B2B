"""Canonical city and district names for the served directory snapshot.

The directory is assembled from several sources, so one city can arrive under more
than one English spelling («Mecca» next to «Makkah Al Mukarramah», some rows with
no Arabic name) and a district label can be another spelling of an official
district, carry a «حي» prefix, or be a leftover that is no district at all (a
serialised object, «False», a street in Latin letters). Served as-is, a city shows
twice in the city picker with its counts split, and a district's establishments
fall outside the official polygon the map draws.

prepare() writes a canonical copy of the parquet assets into a scratch directory
(never into the mounted data volume, which may be read-only and manifest-verified)
and returns the paths the service should read. A file is rewritten only when its
source changes; any failure falls back to the original file so the service still
starts. The English city spellings follow the targeting service's CITIES table and
the official district atlas; data-cleaning/city_names.py carries the same alias
table for rebuilds of the snapshot itself.
"""
import json
import logging
import os
import re

import duckdb

LOGGER = logging.getLogger('farq.targeting')
VERSION = 1   # bump when the rules below change so cached copies are rebuilt

# key -> (English, Arabic); keep in step with services/data-cleaning/city_names.py
CITY_ALIAS = {
 'riyadh': ('Riyadh', 'الرياض'), 'jeddah': ('Jeddah', 'جدة'), 'jiddah': ('Jeddah', 'جدة'),
 'mecca': ('Makkah Al Mukarramah', 'مكة المكرمة'), 'makkah': ('Makkah Al Mukarramah', 'مكة المكرمة'), 'makkahmukarramah': ('Makkah Al Mukarramah', 'مكة المكرمة'), 'mekkah': ('Makkah Al Mukarramah', 'مكة المكرمة'),
 'medina': ('Al Madinah Al Munawwarah', 'المدينة المنورة'), 'madinah': ('Al Madinah Al Munawwarah', 'المدينة المنورة'), 'madinahmunawwarah': ('Al Madinah Al Munawwarah', 'المدينة المنورة'), 'madina': ('Al Madinah Al Munawwarah', 'المدينة المنورة'),
 'dammam': ('Dammam', 'الدمام'), 'khobar': ('Al Khobar', 'الخبر'), 'dhahran': ('Dhahran', 'الظهران'),
 'hofuf': ('Al Ahsa', 'الأحساء'), 'ahsa': ('Al Ahsa', 'الأحساء'), 'hasa': ('Al Ahsa', 'الأحساء'), 'mubarraz': ('Al Mubarraz', 'المبرز'),
 'taif': ('Al Taif', 'الطائف'), 'yanbu': ('Yanbu', 'ينبع'), 'jubayl': ('Al Jubail', 'الجبيل'), 'jubail': ('Al Jubail', 'الجبيل'),
 'hail': ('Hail', 'حائل'), 'tabuk': ('Tabuk', 'تبوك'), 'buraydah': ('Buraydah', 'بريدة'), 'buraidah': ('Buraydah', 'بريدة'),
 'khamismushayt': ('Khamis Mushayt', 'خميس مشيط'), 'khamismushait': ('Khamis Mushayt', 'خميس مشيط'), 'abha': ('Abha', 'أبها'),
 'jizan': ('Jazan', 'جازان'), 'jazan': ('Jazan', 'جازان'), 'gizan': ('Jazan', 'جازان'), 'arar': ('Arar', 'عرعر'), 'sakaka': ('Sakaka', 'سكاكا'),
 'najran': ('Najran', 'نجران'), 'qatif': ('Qatif', 'القطيف'), 'bishah': ('Bisha', 'بيشة'), 'bisha': ('Bisha', 'بيشة'),
 'hafarbatin': ('Hafar Al Batin', 'حفر الباطن'), 'unaizah': ('Unaizah', 'عنيزة'), 'unayzah': ('Unaizah', 'عنيزة'),
 'diriyah': ('Diriyah', 'الدرعية'), 'kharj': ('Al Kharj', 'الخرج'), 'baha': ('Al Bahah', 'الباحة'), 'bahah': ('Al Bahah', 'الباحة'),
 'qunfudhah': ('Al Qunfudhah', 'القنفذة'), 'majmaah': ('Al Majmaah', 'المجمعة'), 'zulfi': ('Az Zulfi', 'الزلفي'), 'khafji': ('Al Khafji', 'الخفجي'),
 'rastannurah': ('Ras Tanura', 'رأس تنورة'), 'ula': ('AlUla', 'العلا'), 'rabigh': ('Rabigh', 'رابغ'), 'qurayyat': ('Al Qurayyat', 'القريات'),
}
ARTICLES = r'^(al|el|ad|ar|as|at|az|an|ash|adh|ath|aj)[\s\-]+'
AR_LETTERS = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي'})
NOT_A_DISTRICT = {'', 'false', 'true', 'none', 'null', 'nan', 'n/a'}
FILES = ('targets.parquet', 'trade_clusters.parquet', 'street_density.parquet')


def city_key(name):
    s = (name or '').lower().strip()
    s = re.sub(r"[`'’ʼ]", '', s)
    s = re.sub(ARTICLES, '', s)
    s = re.sub(r'\b(al|el|ad|ar|as|at|az|an|ash|adh)[\s\-]+', '', s)
    s = re.sub(r'\b(city|governorate|province|region)\b', '', s)
    return re.sub(r'[^a-z؀-ۿ]+', '', s)


def canonical_city(name):
    """(English, Arabic) for a known spelling, else None: unknown cities are served as they are."""
    return CITY_ALIAS.get(city_key(name))


def district_key(name):
    s = (name or '').translate(AR_LETTERS)
    s = re.sub(r'[ً-ْـ]', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def clean_district(raw):
    """The district label without noise, or None when the value is not a district name at all."""
    s = re.sub(r'\s+', ' ', (raw or '')).strip()
    if s.lower() in NOT_A_DISTRICT or s[0] in '{[' or re.fullmatch(r'[\d\s.,،\-]+', s) or not re.search(r'[؀-ۿ]', s):
        return None
    return re.sub(r'^(حي|حى|حيّ)\s+', '', s) or None


def official_districts(geojson_path):
    """(city_en, spelling key) -> official Arabic spelling from the district atlas."""
    try:
        with open(geojson_path, encoding='utf-8') as handle:
            features = json.load(handle).get('features') or []
    except (OSError, ValueError):
        return {}
    official = {}
    for feature in features:
        props = feature.get('properties') or {}
        name, city = props.get('ar') or props.get('district_ar'), props.get('city_en')
        if name and city:
            official.setdefault((city, district_key(name)), name)
    return official


def _source_signature(path):
    stat = os.stat(path)
    return {'version': VERSION, 'size': stat.st_size, 'mtime': stat.st_mtime}


def _fresh(out, signature):
    try:
        with open(out + '.source.json', encoding='utf-8') as handle:
            return os.path.isfile(out) and json.load(handle) == signature
    except (OSError, ValueError):
        return False


def canonicalize_file(src, out, official):
    """Rewrite one parquet asset with canonical city and district values; returns the row count."""
    db = duckdb.connect()
    try:
        db.execute("SET threads=2; SET memory_limit='1GB'")
        columns = {row[0] for row in db.execute('describe select * from read_parquet(?)', [src]).fetchall()}
        replace = []
        joins = ''
        city_expr = 't.city_en'
        if 'city_en' in columns:
            cities = [row[0] for row in db.execute('select distinct city_en from read_parquet(?) where city_en is not null', [src]).fetchall()]
            db.execute('create temp table city_map (raw varchar, en varchar, ar varchar)')
            db.executemany('insert into city_map values (?, ?, ?)', [(raw, *canonical_city(raw)) for raw in cities if canonical_city(raw)])
            joins += ' left join city_map c on c.raw = t.city_en'
            city_expr = 'coalesce(c.en, t.city_en)'
            replace.append(f'{city_expr} as city_en')
            if 'city_ar' in columns:
                replace.append('coalesce(c.ar, t.city_ar) as city_ar')
        if 'district_ar' in columns:
            pairs = db.execute(f'select distinct {city_expr}, t.district_ar from read_parquet(?) t{joins} where t.district_ar is not null', [src]).fetchall()
            rows = []
            for city, raw in pairs:
                cleaned = clean_district(raw)
                rows.append((city, raw, official.get((city, district_key(cleaned)), cleaned) if cleaned else None))
            db.execute('create temp table district_map (city varchar, raw varchar, clean varchar)')
            db.executemany('insert into district_map values (?, ?, ?)', rows)
            joins += f' left join district_map d on d.city is not distinct from {city_expr} and d.raw = t.district_ar'
            replace.append('d.clean as district_ar')
            if 'district_reliable' in columns:
                # a value that was never a district name must not place the record inside any polygon
                replace.append('case when t.district_ar is not null and d.clean is null then false else t.district_reliable end as district_reliable')
        if not replace:
            return None
        tmp = out + '.tmp'
        # COPY ... TO takes no bound parameter for the target, so the scratch path is quoted as a literal
        target = tmp.replace("'", "''")
        db.execute(f"copy (select t.* replace ({', '.join(replace)}) from read_parquet(?) t{joins}) to '{target}' (format parquet)", [src])
        os.replace(tmp, out)
        return db.execute('select count(*) from read_parquet(?)', [out]).fetchone()[0]
    finally:
        db.close()


def prepare(data_dir, out_dir):
    """Canonical paths for the parquet assets in data_dir; falls back to the originals on any failure."""
    paths = {name: os.path.join(data_dir, name) for name in FILES}
    if os.environ.get('FARQ_TARGETING_CANONICALIZE', '1') in ('0', 'false', 'no'):
        return paths
    official = official_districts(os.path.join(data_dir, 'districts.geojson'))
    for name, src in list(paths.items()):
        if not os.path.isfile(src):
            continue
        out = os.path.join(out_dir, name)
        try:
            os.makedirs(out_dir, exist_ok=True)
            signature = _source_signature(src)
            if not _fresh(out, signature):
                rows = canonicalize_file(src, out, official)
                if rows is None:
                    continue
                with open(out + '.source.json', 'w', encoding='utf-8') as handle:
                    json.dump(signature, handle)
                LOGGER.info('canonical_data file=%s rows=%s', name, rows)
            paths[name] = out
        except Exception as error:   # the original asset keeps the service up; the log names the file only
            LOGGER.error('canonical_data_failed file=%s error_type=%s', name, type(error).__name__)
    return paths
