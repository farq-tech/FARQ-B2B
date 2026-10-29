import contact_lookup
# -*- coding: utf-8 -*-
"""
Farq Targeting — local server over the KSA golden POI set.
  python3 server.py            (port 8765)
AI query parsing uses ANTHROPIC_API_KEY (claude-haiku-4-5) when present; otherwise a built-in Arabic dictionary.
Nothing is sent automatically: the UI opens WhatsApp click-to-chat / mailto links one contact at a time after your confirmation.
"""
import os, json, re, sys, time, urllib.request, csv, threading, logging, traceback, collections
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import duckdb, subprocess, base64
from trial_search import Directory
from directory_tiles import DirectoryTiles, has_usable_whatsapp, is_precise_point, valid_filters
from market_analytics import MarketAnalytics
import market_analytics
import status_policy
import read_only_test
from metrics import ServiceMetrics, route_label
import contextvars
from health import is_ready
_DRY = contextvars.ContextVar('dry_run', default=False)   # set for the whole of a dry run; provider_send refuses
import urllib.parse
FARQ_DIR = os.path.expanduser('~/farq-ontology-sync')
# Without a handler Python prints only warnings, which hid every info line (canonical copy sizes, startup job
# reports) from the Railway log. Messages are aggregate-only by convention. Railway marks every stderr line as an
# error, so info goes to stdout and warnings and errors to stderr.
if not logging.getLogger('farq.targeting').handlers:
    _log_handler = logging.StreamHandler(sys.stdout)
    _log_handler.addFilter(lambda record: record.levelno < logging.WARNING)
    _log_handler.setFormatter(logging.Formatter('%(message)s'))
    logging.getLogger('farq.targeting').addHandler(_log_handler)
    _log_handler = logging.StreamHandler(sys.stderr)
    _log_handler.setLevel(logging.WARNING)
    _log_handler.setFormatter(logging.Formatter('%(message)s'))
    logging.getLogger('farq.targeting').addHandler(_log_handler)
    logging.getLogger('farq.targeting').setLevel(logging.INFO)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('FARQ_TARGETING_DATA_DIR', os.path.join(HERE, 'data'))
RUNTIME_DIR = os.environ.get('FARQ_TARGETING_RUNTIME_DIR', os.path.join(HERE, 'data'))
AUX_DATA_DIR = os.environ.get('FARQ_TARGETING_AUX_DATA_DIR', DATA_DIR)
# The mounted snapshot is served through a canonical copy (one spelling per city and district, see
# canonical_data.py) written to scratch space; the mounted volume itself is never modified.
import canonical_data, district_reference, golden, input_upload, price_estimate, tempfile
CANONICAL = canonical_data.prepare(DATA_DIR, os.environ.get('FARQ_TARGETING_CANONICAL_DIR') or os.path.join(tempfile.gettempdir(), 'farq-targeting-canonical'))
DATA = CANONICAL['targets.parquet']
CLUSTERS = CANONICAL['trade_clusters.parquet']
STREET_DENSITY = CANONICAL['street_density.parquet']
LOG = os.path.join(RUNTIME_DIR, 'send_log.csv')
PORT = int(os.environ.get('PORT', '8765'))
API_KEY = os.environ.get('ANTHROPIC_API_KEY')
DB_URL = os.environ.get('CONSTRUCTION_DB_URL')
AUTH_PASSWORD = os.environ.get('TARGETING_PASSWORD')
HOLDER_ENV = os.environ.get('HOLDER_RFQ_ID')
HOLDER_ACTOR = os.environ.get('HOLDER_ACTOR_USER_ID')
MODEL = 'claude-haiku-4-5-20251001'
LOGGER = logging.getLogger('farq.targeting')
METRICS = ServiceMetrics()

def city_polygon_ids(city):
    """Ids of every source polygon in a city of the golden atlas. Source layers (WorldPop, the building model)
    keep the city a polygon was filed under; a correction can move a polygon to another city, so rows are chosen
    by these ids, never by the source's own city column."""
    ids={str(f['properties']['id']) for f in _city_features(city)}
    return sorted(ids|{k for k,v in CANONICAL['district_id_map'].items() if str(v) in ids})


def golden_population(city):
    """The golden population rows of a city, one per canonical district (golden.population), or None when the
    WorldPop layer the rows are built on is missing."""
    path=os.path.join(AUX_DATA_DIR,'buildings_ingest','population','district_population_2025.parquet')
    if not os.path.isfile(path): return None
    import insights
    ids=city_polygon_ids(city)
    with LOCK:
        rows=con.execute("""select district_id,district_ar,district_en,population_estimate,
            population_coverage_pct,population_valid_cells,population_polygon_cells,
            population_year,population_source,population_license
            from read_parquet(?) where cast(district_id as varchar) in (select unnest(?::varchar[])) order by district_ar""",[path,ids]).fetchall()
        built_path=insights.latest(os.path.join(AUX_DATA_DIR,'buildings_ingest','population','district_population_buildings_*.parquet'))
        built=con.execute("select district_id,population_estimate,calibration_source from read_parquet(?) where cast(district_id as varchar) in (select unnest(?::varchar[]))",[built_path,ids]).fetchall() if built_path else []
    rows=[dict(zip(('district_id','district_ar','district_en','population','coverage_pct','valid_cells','polygon_cells','year','source','license'),row)) for row in rows]
    # one row per canonical district: polygons merged in districts.geojson are summed here too
    merged=canonical_data.merge_population_rows(rows,CANONICAL['district_id_map'],CANONICAL['district_names'])
    return golden.population(merged,city,golden.building_totals(built,CANONICAL['district_id_map']))


def golden_demographics(city, districts=(), population=None):
    """Golden by-age rows of a city (or of the given canonical district ids): ages add up to the golden total and
    male/female are given only where 910ths measured them. None when the WorldPop age layer is missing."""
    path=os.path.join(AUX_DATA_DIR,'buildings_ingest','population','district_demographics_2025.parquet')
    if not os.path.isfile(path): return None
    # a canonical district stands for every polygon merged into it; rows are chosen by the city's polygon ids
    ids=city_polygon_ids(city)
    if districts:
        wanted=set(districts)|{k for k,v in CANONICAL['district_id_map'].items() if str(v) in set(districts)}
        ids=[i for i in ids if i in wanted]
    with LOCK:
        rows=con.execute("""select district_id,district_ar,district_en,age_code,age_group,
            male_estimate,female_estimate,total_estimate,coverage_pct,population_year,
            population_source,population_license from read_parquet(?) where cast(district_id as varchar) in (select unnest(?::varchar[]))
            order by district_ar,age_code""",[path,ids]).fetchall()
    names=('district_id','district_ar','district_en','age_code','age_group','male','female','total','coverage_pct','year','source','license')
    merged=canonical_data.merge_population_rows([dict(zip(names,row)) for row in rows],CANONICAL['district_id_map'],CANONICAL['district_names'],by_age=True)
    totals={row['district_ar']:row['population'] for row in ((golden_population(city) if population is None else population) or []) if row.get('district_ar')}
    return golden.demographics(merged,totals,city)


def district_population_by_name(city):
    """Canonical district name -> {population, male, female, source}: the golden table, keyed for name-based joins."""
    population=golden_population(city) or []
    out={row['district_ar']:{'population':row['population'],'male':None,'female':None,'source':row.get('source')}
         for row in population if row.get('district_ar')}
    for row in golden_demographics(city,population=population) or []:
        if row['age_code']=='ALL' and row['district_ar'] in out: out[row['district_ar']].update(male=row['male'],female=row['female'])
    return out


POPULATION_DIR = os.path.join(AUX_DATA_DIR, 'buildings_ingest', 'population')
HOUSEHOLD_SIZE = 5.0   # people per dwelling for building-based counts; the same assumption as build_building_population


def _city(body):
    city = body.get('city')
    if not isinstance(city, str) or not 1 <= len(city) <= 80: raise ValueError('city')
    return city


def _number(body, key, low, high, default=None):
    value = body.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high: raise ValueError(key)
    return value


def _city_features(city):
    with open(CANONICAL['districts.geojson'], encoding='utf-8') as handle:
        return [f for f in json.load(handle).get('features', []) if (f.get('properties') or {}).get('city_en') == city]


def insight_response(path, body):
    import insights
    if path == '/growth':
        city = _city(body)
        with LOCK:
            rows = insights.growth(con, insights.latest(os.path.join(POPULATION_DIR, 'district_growth_*.parquet')), city_polygon_ids(city), CANONICAL['district_id_map'], CANONICAL['district_names'])
        if rows is None: return {'ok': True, 'city': city, 'districts': [], 'available': False, 'basis': 'طبقة المباني لم تُعالج بعد على الخادم.'}
        return {'ok': True, 'city': city, 'available': True, 'districts': rows,
                'basis': 'مبانٍ تحت الإنشاء أو الترميم من حقل الغرض في طبقة المباني، ومبانٍ جديدة رُصدت منذ آخر مسح. مؤشر لاتجاه الطلب القادم، لا عدد وحدات مؤكد.'}
    if path == '/population-around':
        lon, lat = _number(body, 'lon', 34, 56), _number(body, 'lat', 16, 33)
        radius = _number(body, 'radius_m', 100, 5000, 500)
        with LOCK:
            result = insights.population_around(con, insights.latest(os.path.join(POPULATION_DIR, 'building_points_*.parquet')),
                                                DATA if os.path.isfile(DATA) else None, TILES.search_sql, lon, lat, radius, HOUSEHOLD_SIZE)
        basis = ('السكان = سكان كل حي (من 910ths حيث يتوفر، وإلا من كثافة الوحدات السكنية) موزعين على مبانيه السكنية، ثم جُمعت المباني داخل الدائرة.'
                 if result.get('people_per_district') else 'السكان = الوحدات السكنية في المباني ضمن الدائرة × 5 أفراد للوحدة.')
        result.update(ok=True, household_size=HOUSEHOLD_SIZE, basis=basis + ' المنشآت من الدليل المفتوح. تقدير للمقارنة بين المواقع لا تعداد.')
        return result
    if path == '/population-within':
        geometry = body.get('geometry')
        if not isinstance(geometry, dict) or geometry.get('type') not in ('Polygon', 'MultiPolygon'): raise ValueError('geometry')
        points = [p for rings in canonical_data._polygons(geometry) for ring in rings for p in ring]
        if not 3 <= len(points) <= 20000 or not all(isinstance(p, list) and len(p) >= 2 and 34 <= p[0] <= 56 and 16 <= p[1] <= 33 for p in points):
            raise ValueError('geometry')
        with LOCK:
            result = insights.population_within(con, insights.latest(os.path.join(POPULATION_DIR, 'building_points_*.parquet')),
                                                DATA if os.path.isfile(DATA) else None, TILES.search_sql, geometry, HOUSEHOLD_SIZE)
        result.update(ok=True, household_size=HOUSEHOLD_SIZE)
        return result
    if path == '/territories':
        city = _city(body)
        count = int(_number(body, 'count', 2, 50, 5))
        weight = body.get('weight', 'population')
        if weight not in ('population', 'businesses'): raise ValueError('weight')
        if weight == 'population':
            weights = {name: row['population'] for name, row in district_population_by_name(city).items() if row.get('population')}
        else:
            activity = {key: body[key] for key in ('q', 'main_id') if body.get(key)}   # a distributor balances on its own customers
            weights = {row['district_ar']: row['n'] for row in MARKET_ANALYTICS.district_counts({'city': city, **activity})['districts']}
        groups = insights.territories(_city_features(city), weights, count)
        return {'ok': True, 'city': city, 'weight': weight, 'territories': groups,
                'basis': 'الأحياء مرتبة على مسار يمر بمراكزها حتى تبقى كل منطقة متجاورة، ثم قُسمت عند كل حصة متساوية من ' + ('السكان.' if weight == 'population' else 'المنشآت.')}
    if path == '/district-income':
        city = _city(body)
        table = insights.district_income(city)
        if table is None: return {'ok': True, 'city': city, 'available': False, 'districts': []}
        return {'ok': True, 'city': city, 'available': True, **table}
    if path == '/registered-deals':
        city = _city(body)
        table = insights.registered_deals(city)
        if table is None: return {'ok': True, 'city': city, 'available': False, 'districts': []}
        return {'ok': True, 'city': city, 'available': True, **table}
    if path == '/real-estate':
        city = _city(body)
        table = insights.real_estate(city)
        if table is None: return {'ok': True, 'city': city, 'available': False, 'districts': []}
        return {'ok': True, 'city': city, 'available': True, **table}
    if path == '/price-estimate':
        city = _city(body)
        district_id = body.get('district_id')
        if not isinstance(district_id, str) or not 1 <= len(district_id) <= 40: raise ValueError('district_id')
        if body.get('deal') not in price_estimate.DEALS: raise ValueError('deal')
        if body.get('type') not in price_estimate.TYPES: raise ValueError('type')
        for key, allowed in (('age', price_estimate.AGE_BANDS), ('streets', price_estimate.STREETS), ('street_width', price_estimate.WIDTHS), ('furnished', ('no', 'yes'))):
            if body.get(key) is not None and body.get(key) not in allowed: raise ValueError(key)
        query = {key: body.get(key) for key in ('district_id', 'deal', 'type', 'age', 'streets', 'street_width', 'furnished')}
        query['area_sqm'] = _number(body, 'area_sqm', 10, 100000)
        try:
            result = price_estimate.estimate(city, query)
        except (OSError, ValueError):
            return {'ok': True, 'city': city, 'available': False, 'reason': 'no_listings'}
        return {'ok': True, 'city': city, **result}
    if path == '/real-estate-listings':
        city = _city(body)
        box = body.get('bbox')
        if box is not None and not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in box)
                                    and 34 <= box[0] < box[2] <= 56 and 16 <= box[1] < box[3] <= 33):
            raise ValueError('bbox')
        ids = body.get('district_ids')
        if ids is not None and not (isinstance(ids, list) and len(ids) <= 50 and all(isinstance(v, str) and len(v) <= 40 for v in ids)): raise ValueError('district_ids')
        kind = body.get('kind')
        if kind not in (None, 'rent', 'sale'): raise ValueError('kind')
        deal = body.get('deal')
        if deal not in (None, 'sale', 'rent_year', 'rent_month', 'rent_unstated'): raise ValueError('deal')
        types = body.get('types')
        if types is not None and not (isinstance(types, list) and all(t in insights.LISTING_TYPES for t in types)): raise ValueError('types')
        filters = {'bbox': box, 'district_ids': ids, 'kind': kind, 'deal': deal, 'types': types,
                   'min_price': body.get('min_price') and _number(body, 'min_price', 1, 1e9), 'max_price': body.get('max_price') and _number(body, 'max_price', 1, 1e9),
                   'min_area': body.get('min_area') and _number(body, 'min_area', 1, 1e6), 'max_area': body.get('max_area') and _number(body, 'max_area', 1, 1e6),
                   # 0 is a real answer here («new only»), so it is read when present, not when truthy
                   'max_age': _number(body, 'max_age', 0, 99) if body.get('max_age') is not None else None,
                   'limit': int(_number(body, 'limit', 1, insights.LISTINGS_MAX, insights.LISTINGS_MAX))}
        table = insights.real_estate_listings(city, filters)
        if table is None: return {'ok': True, 'city': city, 'available': False, 'total': 0, 'listings': []}
        return {'ok': True, 'city': city, 'available': True, **table}
    if path == '/housing-level':
        city = _city(body)
        with LOCK:
            rows = insights.housing_level(con, insights.latest(os.path.join(POPULATION_DIR, 'district_population_buildings_*.parquet')), city_polygon_ids(city), CANONICAL['district_id_map'], CANONICAL['district_names'])
        if rows is None: return {'ok': True, 'city': city, 'districts': [], 'available': False}
        return {'ok': True, 'city': city, 'available': True, 'min_units': insights.MIN_HOUSING_UNITS, 'districts': rows}
    if path == '/district-audience':
        city = _city(body)
        table = insights.district_audience(city)
        if table is None: return {'ok': True, 'city': city, 'available': False, 'districts': []}
        return {'ok': True, 'city': city, 'available': True, **table}
    if path == '/district-profile':
        city = _city(body)
        district = body.get('district')
        if not isinstance(district, str) or not 1 <= len(district) <= 100: raise ValueError('district')
        people = district_population_by_name(city).get(district) or {}
        summary = MARKET_ANALYTICS.market_summary({'city': city, 'districts': [district]})['summary']
        # the golden rows of this city only: a district name can recur in other cities
        ages = sorted(({'age_group': r['age_group'], 'age_code': r['age_code'], 'male': None if r['male'] is None else round(r['male']),
                        'female': None if r['female'] is None else round(r['female']), 'total': round(r['total'] or 0)}
                       for r in (golden_demographics(city) or []) if r['district_ar'] == district and r['age_code'] != 'ALL'), key=lambda r: r['age_code'])
        with LOCK:
            growth_rows = insights.growth(con, insights.latest(os.path.join(POPULATION_DIR, 'district_growth_*.parquet')), city_polygon_ids(city), CANONICAL['district_id_map'], CANONICAL['district_names']) or []
        income = insights.district_income(city) or {}
        measured = district_reference.city_rows(city).get(district) or {}
        return {
            'ok': True, 'city': city, 'district': district,
            'population': round(people['population']) if people.get('population') else None,
            'male': round(people['male']) if people.get('male') else None, 'female': round(people['female']) if people.get('female') else None,
            'ages': ages,
            'saudi_pct': measured.get('saudi_pct'),   # published by 910ths only; None elsewhere
            'businesses': summary.get('total'), 'whatsapp': summary.get('n_whatsapp'), 'wholesale': summary.get('n_wholesale'),
            'main_activities': summary.get('main_activities') or [],
            'growth': next((row for row in growth_rows if row['district_ar'] == district), None),
            'income': next((row for row in income.get('districts', []) if row.get('district_ar') == district), None),
            'income_source': income.get('source'),
            'sources': {'population': people.get('source') or golden.WORLDPOP, 'businesses': 'دليل فرق المفتوح', 'growth': 'طبقة مباني فرق'},
        }
    raise ValueError(path)


def log_map_api_failure(endpoint, error):
    """Log a safe failure location without request bodies, query text, or exception messages."""
    try:
        frames = traceback.extract_tb(error.__traceback__)[-8:]
        stack = ','.join(f'{os.path.basename(frame.filename)}:{frame.name}:{frame.lineno}' for frame in frames)
        LOGGER.error('map_api_failure endpoint=%s error_type=%s stack=%s', endpoint, type(error).__name__, stack)
    except Exception:
        pass

con = duckdb.connect()
con.execute("SET threads=2; SET memory_limit='3GB'")
con.execute(f"create view t as select * from '{DATA}'")
SEARCH_SQL = status_policy.search_sql(con, DATA)   # same rule as status_policy.SEARCH_SQL, compiled once
LOCK = threading.Lock()
TRIAL_DIRECTORY = Directory(DATA)
TILES = DirectoryTiles(DATA)
TRIAL_DIRECTORY.branch_counts = TILES.branch_counts
MARKET_ANALYTICS = MarketAnalytics(TILES, STREET_DENSITY)
# chain branch counts per directory snapshot, on the volume so they outlive deploys (market_analytics.record_chain_history)
CHAIN_HISTORY = os.path.join(AUX_DATA_DIR, 'chain_history.json')


def _record_chain_history():
    try:
        if market_analytics.record_chain_history(MARKET_ANALYTICS, CHAIN_HISTORY): LOGGER.info('chain_history snapshot recorded')
    except Exception as error:   # history is an extra; the service runs without it
        LOGGER.error('chain_history_failed error_type=%s', type(error).__name__)

# ---------- Arabic normalisation ----------
AR = str.maketrans({'أ':'ا','إ':'ا','آ':'ا','ة':'ه','ى':'ي','ؤ':'و','ئ':'ي'})
def norm(s):
    s = (s or '').lower().translate(AR)
    s = re.sub(r'[ً-ْـ]', '', s)
    return re.sub(r'\s+', ' ', s).strip()

# fallback dictionary: request keyword -> search terms (AR/EN) and category hints
FALLBACK = {
 'مقاول': {'kw': ['مقاولات','مقاول','للمقاولات','contracting','contractor','construction','انشاءات','إنشاءات','بناء'], 'cat': ['construction','contract']},
 'نظاف': {'kw': ['نظافه','تنظيف','مواد نظافه','منظفات','cleaning','detergent','hygiene','janitorial'], 'cat': ['clean']},
 'كهرب': {'kw': ['كهرباء','كهربائيه','ادوات كهربائيه','electrical','electric'], 'cat': ['electric']},
 'سباك': {'kw': ['سباكه','ادوات صحيه','plumbing','sanitary'], 'cat': ['plumb','sanitary']},
 'حديد': {'kw': ['حديد','حدادة','steel','iron','metal'], 'cat': ['steel','metal']},
 'دهان': {'kw': ['دهانات','بويه','paint'], 'cat': ['paint']},
 'سيراميك': {'kw': ['سيراميك','بلاط','رخام','ceramic','tile','marble'], 'cat': ['ceramic','tile','marble']},
 'تكييف': {'kw': ['تكييف','مكيفات','تبريد','hvac','air condition'], 'cat': ['hvac','air']},
 'مطعم': {'kw': ['مطعم','مطاعم','restaurant'], 'cat': ['restaurant']},
 'صيدل': {'kw': ['صيدليه','pharmacy'], 'cat': ['pharmac']},
 'عقار': {'kw': ['عقار','عقارات','real estate'], 'cat': ['real estate']},
 'مورد': {'kw': ['مورد','توريد','تجاره','supplier','trading','supply'], 'cat': []},
 'مصنع': {'kw': ['مصنع','صناعه','factory','manufactur'], 'cat': ['industr','factory']},
 'خشب': {'kw': ['خشب','اخشاب','نجاره','wood','timber','carpentry'], 'cat': ['wood']},
 'زجاج': {'kw': ['زجاج','المنيوم','glass','aluminium','aluminum'], 'cat': ['glass','alumin']},
 'مستشف': {'kw': ['مستشفى','مستوصف','عياده','hospital','clinic'], 'cat': ['hospital','clinic','medical']},
 'فندق': {'kw': ['فندق','شقق مفروشه','hotel'], 'cat': ['hotel']},
 'مدرس': {'kw': ['مدرسه','مدارس','school'], 'cat': ['school','education']},
}
REGIONS = {'الرياض':'Riyadh','رياض':'Riyadh','مكه':'Makkah','مكة':'Makkah','جده':'Makkah','جدة':'Makkah','الشرقيه':'Eastern Province','الشرقية':'Eastern Province','الدمام':'Eastern Province','المدينه':'Madinah','المدينة':'Madinah','عسير':'Asir','ابها':'Asir','القصيم':'Al Qassim','بريده':'Al Qassim','جازان':'Jazan','تبوك':'Tabuk','حائل':'Hail','الباحه':'Al Bahah','الجوف':'Al Jawf','نجران':'Najran','الحدود الشماليه':'Northern Borders'}
CITIES = {'جده':'Jeddah','جدة':'Jeddah','الرياض':'Riyadh','الدمام':'Dammam','الخبر':'Al Khobar','مكه':'Makkah Al Mukarramah','مكة':'Makkah Al Mukarramah','المدينه':'Al Madinah Al Munawwarah','المدينة':'Al Madinah Al Munawwarah','ابها':'Abha','بريده':'Buraydah','الطائف':'Al Taif','الاحساء':'Al Ahsa','الجبيل':'Al Jubail','تبوك':'Tabuk','حائل':'Hail','خميس مشيط':'Khamis Mushayt','ينبع':'Yanbu','الخرج':'Al Kharj'}

# products sold by shops that rarely name them: product stem -> (seller terms, label)
PRODUCTS = {
 'بيوتيل': (['عوازل','مواد عزل','عزل مائي','عزل حراري','اكسسوارات المنيوم','سيليكون','مواد لاصقه','insulation','waterproofing','sealant','aluminium accessories','adhesive'], 'محلات العوازل واكسسوارات الألمنيوم والسيليكون'),
 'butyl': (['عوازل','مواد عزل','عزل مائي','اكسسوارات المنيوم','سيليكون','insulation','waterproofing','sealant','aluminium accessories'], 'محلات العوازل واكسسوارات الألمنيوم والسيليكون'),
 'ماستك': (['عوازل','مواد عزل','اكسسوارات المنيوم','سيليكون','مواد لاصقه','sealant','insulation','aluminium accessories','adhesive'], 'محلات العوازل والسيليكون واكسسوارات الألمنيوم'),
 'mastic': (['عوازل','مواد عزل','اكسسوارات المنيوم','سيليكون','sealant','insulation','aluminium accessories'], 'محلات العوازل والسيليكون واكسسوارات الألمنيوم'),
 'سيليكون': (['عوازل','اكسسوارات المنيوم','زجاج','مواد بناء','عدد','sealant','glass','aluminium accessories','hardware'], 'محلات الزجاج والألمنيوم والعوازل والعدد'),
 'فوم': (['عوازل','مواد عزل','مواد بناء','insulation','sealant'], 'محلات العوازل ومواد البناء'),
}
# shop types that never fit a product search (owner rule 2026-10-07)
# words too broad to search on their own
GENERIC = {'construction','building','buildings','بناء','البناء','home','house','general','commercial','industrial','صناعي','صناعيه','accessories','اكسسوارات','مورد','موردين','توريد','تجاره','supplier','suppliers','مواد بناء','مواد البناء','building materials','construction materials','اكسسوارات البناء','home goods','احتياجات المنزل','حديات','شريط','tape','اكسسوارات','accessories','accessory','مواد','materials','material','store','shop','trading','supplies','supply','محلات','محل','شركه','مؤسسه','products','منتجات'}
SELLER_EXCLUDE = ['رمل','بلك','بلوك','اسمنت','خرسانه','دفان','زينه سيارات','sand','cement','concrete','car accessor']

def fallback_parse(q):
    nq = norm(q)
    kw, cat = [], []
    for stem, d in FALLBACK.items():
        if stem in nq:
            kw += d['kw']; cat += d['cat']
    city = next((v for k, v in CITIES.items() if norm(k) in nq), None)
    region = next((v for k, v in REGIONS.items() if norm(k) in nq), None)
    if city == 'Jeddah': region = None
    req = []
    if 'واتس' in nq or 'whatsapp' in nq: req.append('whatsapp')
    if 'ايميل' in nq or 'بريد' in nq or 'email' in nq: req.append('email')
    if not kw:
        words = [w for w in re.findall(r'[\w؀-ۿ]{3,}', nq) if w not in ('ابي','ابغى','اريد','شركات','شركه','مؤسسات','موردين','مورد','الي','اللي','عندهم','عنده','بس','ممكن','كل')]
        kw = words
    sel, label = [], None
    for stem, (terms, lab) in PRODUCTS.items():
        if norm(stem) in nq: sel += terms; label = label or lab
    return {'keywords': list(dict.fromkeys(kw)), 'category_hints': cat, 'seller_terms': list(dict.fromkeys(norm(t) for t in sel)), 'seller_label': label, 'city': city, 'region': region, 'require': req, 'explain': 'قاموس داخلي (بدون ذكاء)'}

PROMPT = """You turn an Arabic/English business-targeting request into search filters over a Saudi POI database.
Return ONLY JSON with keys:
 keywords: list of 4-12 search terms naming ONLY the requested thing itself (Arabic AND English spelling variants, synonyms, singular/plural, e.g. مقاولات/مقاول/contracting/contractor; for butyl tape: شريط بيوتيل/بيوتيل/butyl tape/butyl; for silicone: سيليكون/silicone/silicone sealant/مانع تسرب). Direct product-family names belong here; never shop types or broad words (tape, شريط, accessories, materials) — shop types go in seller_terms. Normalise Arabic (no hamza variants needed).
 category_hints: list of lowercase English category fragments likely used in the data (e.g. "construction", "contract", "cleaning", "electric").
 seller_terms: when the request names a PRODUCT or material, list 8-20 Arabic AND English terms for the TYPES of shops/companies that usually sell or supply it even when the product is not in their name (e.g. for butyl tape: عوازل, مواد عزل, عزل مائي, اكسسوارات المنيوم, سيليكون, مواد لاصقه, insulation, waterproofing, sealant, aluminium accessories, adhesives). Use [] when the request already names a type of business (e.g. "محلات سباكة").
 seller_label: short Arabic phrase naming those shop types (e.g. "محلات العوازل واكسسوارات الألمنيوم والسيليكون"), or null.
 exclude: list of terms that must NOT appear (e.g. for cleaning-material suppliers exclude "laundry").
 city: English city name if the request names a city (Riyadh, Jeddah, Dammam, Al Khobar, Makkah Al Mukarramah, Al Madinah Al Munawwarah, Abha, Buraydah, Al Taif, Al Ahsa ...) else null.
 region: one of [Riyadh, Makkah, Eastern Province, Madinah, Asir, Al Qassim, Jazan, Tabuk, Hail, Al Bahah, Al Jawf, Najran, Northern Borders] if a region is named, else null.
 require: subset of ["whatsapp","email"] only when the user explicitly asks for it.
 explain: one short Arabic sentence of how you understood the request.
Request: """

def ai_parse(q):
    if not API_KEY:
        return fallback_parse(q)
    body = {"model": MODEL, "max_tokens": 600, "temperature": 0, "messages": [{"role": "user", "content": PROMPT + q}]}
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
                                 headers={"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = json.loads(r.read())['content'][0]['text']
        m = re.search(r'\{.*\}', txt, re.S)
        p = json.loads(m.group(0))
        p['keywords'] = [norm(k) for k in p.get('keywords', []) if k]
        p['category_hints'] = [k.lower() for k in p.get('category_hints', [])]
        p['exclude'] = [norm(k) for k in p.get('exclude', []) if k]
        p['seller_terms'] = [norm(k) for k in p.get('seller_terms', []) or [] if k]
        # safety net: the request's own words always search too, whatever the model returned
        own = [w for w in fallback_parse(q)['keywords'] if len(w) >= 4 and w not in GENERIC and not any(norm(c) == w or norm(c) in w for c in list(CITIES) + list(REGIONS))]
        p['keywords'] = list(dict.fromkeys(p['keywords'] + own))
        p['ai'] = True
        return p
    except Exception as e:
        p = fallback_parse(q); p['explain'] += f' — تعذّر الذكاء: {str(e)[:80]}'; return p

def sql_lit(s): return "'" + s.replace("'", "''") + "'"

RANK_PROMPT = """A construction / procurement buyer in Saudi Arabia wants to buy: {q}
Below are businesses (id | name | category). For each, judge from the name and category whether it would sell or supply that to a buyer:
 L = likely: it names the product, OR it is the kind of shop/distributor/factory that normally stocks it (e.g. insulation, waterproofing and aluminium-accessory shops stock butyl tape and silicone; plumbing shops stock pipes and fittings).
 M = maybe: a general building-materials or hardware store that might carry it.
 N = not: unrelated businesses, including look-alike names in another trade (e.g. "Silicon Valley Computers" for silicone), services only (cleaning, car wash, tank cleaning), contractors, real estate, salons, restaurants, furniture."""
RANK_PROMPT += """
Return ONLY JSON: {{"L": [ids], "M": [ids]}} — ids not listed are N.
{rows}"""
RANK_MAX = 300
_CITIES = []
def cities():
    """Cities with at least 1,500 places, largest first (computed once), each with the number of districts it has in
    the golden atlas: tools that work per district (population, gaps, growth, territories, reports) offer only
    cities with districts, instead of letting a user pick one and find nothing."""
    if not _CITIES:
        with open(CANONICAL['districts.geojson'], encoding='utf-8') as handle:
            districts = collections.Counter((f.get('properties') or {}).get('city_en') for f in json.load(handle).get('features', []))
        with LOCK:
            _CITIES.extend({'en': a, 'ar': b, 'n': c, 'districts': districts.get(a, 0)} for a, b, c in con.execute("select city_en, mode(city_ar), count(*) n from t where city_en is not null group by 1 having n >= 1500 order by n desc").fetchall())
    return _CITIES

def ai_rank(q, rows):
    """AI fit per candidate: 'L' likely · 'M' maybe · 'N' not (only for the first RANK_MAX rows; two calls of 150 in parallel)."""
    if not API_KEY or not rows: return {}
    def one(chunk):
        lines = '\n'.join(f"{i} | {(r.get('name_ar') or r.get('name_en') or '')[:60]} | {(r.get('category_ar') or r.get('category') or '')[:50]}".replace('\n', ' ') + '' for i, r in chunk)
        body = {"model": MODEL, "max_tokens": 1500, "temperature": 0, "messages": [{"role": "user", "content": RANK_PROMPT.format(q=q, rows=lines)}]}
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
                                     headers={"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r: txt = json.loads(r.read())['content'][0]['text']
            d = json.loads(re.search(r'\{.*\}', txt, re.S).group(0))
        except Exception: return {}
        ids = {i for i, _ in chunk}
        out = {i: 'N' for i in ids}
        for k in ('M', 'L'):
            for i in d.get(k) or []:
                if isinstance(i, int) and i in ids: out[i] = k
        return out
    items = list(enumerate(rows[:RANK_MAX]))
    chunks = [items[i:i + 150] for i in range(0, len(items), 150)]
    res = {}
    ts = []
    for c in chunks:
        t = threading.Thread(target=lambda c=c: res.update(one(c))); t.start(); ts.append(t)
    for t in ts: t.join()
    return {rows[i]['poi_key']: v for i, v in res.items()}

def search(q, limit=3000, only_sendable=False, city=None, rank=True):
    p = ai_parse(q)
    # the city chosen in the screen wins over whatever the request text says
    if city: p['city'] = city; p['region'] = None
    # two kinds of match: the place names the product, or its type of shop usually sells it (product first)
    kws = [k for k in p.get('keywords', []) if len(k) >= 3 and k not in GENERIC]
    # «محلات العوازل» → «العوازل»: the shop-word prefix never appears in a name or category
    strip = lambda k: re.sub(r'\s+(shops?|stores?|suppliers?|distributors?|dealers?|companies|company|traders?|materials?)$', '', re.sub(r'^(محلات|محل|متاجر|متجر|شركات|شركه|مؤسسات|موزعي|موزع|موردي)\s+(ال)?', '', k)).strip()
    sel = list(dict.fromkeys(t for t in (strip(k) for k in (p.get('seller_terms') or [])) if len(t) >= 4 and t not in GENERIC and t not in kws))
    nm = "translate(lower(concat_ws(' ', name_ar, name_en, legal_name, brand_name)), 'أإآةىؤئ', 'اااهيوي')"
    ct = "translate(lower(concat_ws(' ', category, category_ar, secondary_category, category_l3, google_category)), 'أإآةىؤئ', 'اااهيوي')"
    like = lambda terms: '(' + ' or '.join(f"st ilike {sql_lit('%'+k+'%')}" for k in terms) + ')' if terms else 'false'
    # a likely seller is judged by its own name and category only (not reviews or other text)
    like_nc = lambda terms: '(' + ' or '.join(f"({nm} ilike {sql_lit('%'+k+'%')} or {ct} ilike {sql_lit('%'+k+'%')})" for k in terms) + ')' if terms else 'false'
    kw_cond, sel_cond = like(kws), like_nc(sel)
    sel_excl = like_nc([norm(x) for x in SELLER_EXCLUDE] + ['عقار','real estate','مقاولات','contracting','صالون','salon','مطعم','restaurant'])
    conds = [f"({kw_cond} or ({sel_cond} and not {sel_excl}))"]
    cats = [c for c in (p.get('category_hints') or []) if len(c) >= 4 and c not in ('supplies','materials','supplier','distributor','services','company','corporate','retail','shop','store','trading')]
    for x in p.get('exclude') or []:
        conds.append(f"st not ilike {sql_lit('%'+x+'%')}")
    conds.append(SEARCH_SQL)   # same policy as the map and the new search
    if p.get('city'): conds.append(f"city_en = {sql_lit(p['city'])}")
    if p.get('region'): conds.append(f"region_en = {sql_lit(p['region'])}")
    # 'require' never hides rows: those without WhatsApp/email are still shown (greyed) so you can see them on the map.
    if only_sendable: conds.append("(has_whatsapp or email is not null)")
    where = ' and '.join(conds) if (kws or sel) else 'false'
    nm = "translate(lower(concat_ws(' ', name_ar, name_en, legal_name, brand_name)), 'أإآةىؤئ', 'اااهيوي')"
    ct = "lower(concat_ws(' ', category, category_ar, secondary_category, category_l3, google_category))"
    score = ' + '.join([f"(case when {nm} ilike {sql_lit('%'+k+'%')} then 3 else 0 end)" for k in kws] +
                       [f"(case when {ct} ilike {sql_lit('%'+k+'%')} then 2 else 0 end)" for k in kws] +
                       [f"(case when {ct} ilike {sql_lit('%'+c+'%')} then 2 else 0 end)" for c in cats] +
                       [f"(case when {ct} ilike {sql_lit('%'+k+'%')} then 1 else 0 end)" for k in sel] + ['0'])
    base = f"""select *, translate(search_text, 'أإآةىؤئ', 'اااهيوي') as st, ({score}) as score from t"""
    with LOCK:
        # one scan: the matches land in a temp table, counts and the page come from it
        con.execute(f"""create or replace temp table m as select poi_key, name_ar, name_en, category, category_ar, secondary_category, region_en, region_ar, city_en, district_en, district_ar,
                                      latitude, longitude, phone_norm, phone_kind, has_whatsapp, email, website, instagram, working_hours, rating, sources, source_count, completeness_pct,
                                      case when {kw_cond} then 'product' else 'seller' end as match, score
                               from ({base}) where {where}""")
        total, wa, em, prod = con.execute("select count(*), count(*) filter (where has_whatsapp), count(*) filter (where email is not null), count(*) filter (where match = 'product') from m").fetchone()
        rows = con.execute(f"""select * exclude (score) from m
                               order by (match = 'product') desc, score desc, has_whatsapp desc, (email is not null) desc, completeness_pct desc limit {int(limit)}""").fetchall()
        by_region = con.execute("select region_en, count(*) from m group by 1 order by 2 desc").fetchall()
    cols = ['poi_key','name_ar','name_en','category','category_ar','secondary_category','region_en','region_ar','city_en','district_en','district_ar','latitude','longitude','phone','phone_kind','has_whatsapp','email','website','instagram','working_hours','rating','sources','source_count','completeness_pct','match']
    out = [dict(zip(cols, r)) for r in rows]
    fit = ai_rank(q, out) if rank else {}
    order = {'L': 0, 'M': 1, None: 2, 'N': 3}
    for r in out: r['ai'] = fit.get(r['poi_key'])
    out.sort(key=lambda r: order[r['ai']])  # stable: keeps product-first and score order inside each group
    n = lambda k: sum(1 for v in fit.values() if v == k)
    return {'parsed': p, 'total': total, 'product_total': prod, 'with_whatsapp': wa, 'with_email': em, 'by_region': by_region,
            'ai_checked': len(fit), 'ai_likely': n('L'), 'ai_maybe': n('M'), 'rows': out}

UNDERSTAND_PROMPT = """A company in Saudi Arabia writes what it wants to buy (any sector: clinics, restaurants, hotels, offices, schools, factories, maintenance, contractors, shops).
Request: {q}
Return ONLY JSON:
{{"item": "short Arabic product name", "quantity": number or null, "unit": "Arabic unit or null", "city": "Arabic city name if named, else null",
  "city_en": "one of [{cities}] if the city is named, else null", "use": "Arabic: who/what it is for if stated (e.g. عيادة طبية), else null",
  "quantity_note": "Arabic question if the quantity can be read two ways (e.g. 12 فرع: per branch or total?), else null",
  "question": {{"text": "ONE short Arabic question about the detail that most changes the price for THIS item, or null if none is needed",
               "options": ["2 or 3 short Arabic options", "the last option is always: ما يفرق، أبي أفضل عرض"]}}}}
Ask only what a supplier needs to price it. Never ask about budget, timing or contact details."""
_UNDERSTAND = {}
def demo_understand(body):
    """Public landing: what the request says (item, quantity, city, use) + at most one price-relevant question. No supplier data."""
    q = re.sub(r'\s+', ' ', str(body.get('q') or '')).strip()[:160]
    if len(q) < 3: return {'ok': False, 'error': 'QUERY_SHORT'}
    key = norm(q)
    if key in _UNDERSTAND: return _UNDERSTAND[key]
    out = {'ok': True, 'q': q, 'ai': False, 'item': q, 'quantity': None, 'unit': None, 'city': None, 'city_en': None, 'use': None, 'quantity_note': None, 'question': None}
    if API_KEY:
        names = ', '.join(c['en'] for c in cities()[:40])
        bodyx = {"model": MODEL, "max_tokens": 400, "temperature": 0, "messages": [{"role": "user", "content": UNDERSTAND_PROMPT.format(q=q, cities=names)}]}
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(bodyx).encode(),
                                     headers={"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r: txt = json.loads(r.read())['content'][0]['text']
            d = json.loads(re.search(r'\{.*\}', txt, re.S).group(0))
            valid = {c['en'] for c in cities()}
            out.update({k: d.get(k) for k in ('item', 'quantity', 'unit', 'city', 'use', 'quantity_note')})
            out['city_en'] = d.get('city_en') if d.get('city_en') in valid else None
            qn = d.get('question') or {}
            if qn.get('text') and isinstance(qn.get('options'), list) and qn['options']:
                ANY = 'ما يفرق، أبي أفضل عرض'
                opts = [str(o)[:60] for o in qn['options'] if 'ما يفرق' not in str(o)][:2] + [ANY]
                out['question'] = {'text': str(qn['text'])[:120], 'options': opts}
            out['ai'] = True
        except Exception: pass
    else:
        fp = fallback_parse(q)
        out['city_en'] = fp.get('city')
    if len(_UNDERSTAND) > 2000: _UNDERSTAND.clear()
    _UNDERSTAND[key] = out
    return out

_DEMO = {}
def demo_search(body):
    """Public landing demo: what exists for a request in a city — totals and a sample described by kind of shop,
    district and channel only. No names, no phones, no emails; no AI ranking (only the request is understood)."""
    q = re.sub(r'\s+', ' ', str(body.get('q') or '')).strip()[:120]
    city = str(body.get('city') or '')
    valid = {c['en'] for c in cities()}
    if len(q) < 3: return {'ok': False, 'error': 'QUERY_SHORT'}
    if city not in valid: return {'ok': False, 'error': 'CITY_INVALID'}
    key = (norm(q), city)
    if key in _DEMO: return _DEMO[key]
    r = search(q, 400, False, city, rank=False)
    rows = r['rows']
    def kind(x):
        k = (x.get('category_ar') or x.get('category') or '').split('|')[0].split(';')[0].strip()
        return k[:40] or 'مورد'
    pick = [x for x in rows if x.get('has_whatsapp')][:6] or rows[:6]
    out = {'ok': True, 'q': q, 'city': city, 'understood': {'item': next((k for k in (r['parsed'].get('keywords') or []) if re.search(r'[\u0600-\u06ff]', k)), q),
                                                            'sellers': r['parsed'].get('seller_label')},
           'total': r['total'], 'names_product': r.get('product_total', 0), 'with_whatsapp': r['with_whatsapp'], 'with_email': r['with_email'],
           'sample': [{'kind': kind(x), 'district': x.get('district_ar') or x.get('district_en') or '',
                       'channel': 'whatsapp' if x.get('has_whatsapp') else 'email' if x.get('email') else 'none',
                       'farq': 'farq_supplier' in (x.get('sources') or [])} for x in pick]}
    if len(_DEMO) > 2000: _DEMO.clear()
    _DEMO[key] = out
    return out

def load_holder():
    try: h = json.load(open(os.path.join(HERE, 'data', 'holder_rfq.json'), encoding='utf-8'))
    except Exception: h = {}
    if HOLDER_ENV: h['holder_rfq_id'] = HOLDER_ENV
    if HOLDER_ACTOR: h['actor_user_id'] = HOLDER_ACTOR
    return h

def pg():
    import psycopg
    return psycopg.connect(DB_URL, sslmode='require', connect_timeout=15)

RECIPIENT_COLS = ['poi_key', 'name_ar', 'name_en', 'city_en', 'category', 'company_status', 'lifecycle_state', 'phone_norm', 'has_whatsapp', 'email']
KEY_RE = re.compile(r'^[A-Za-z0-9:_\-\.]{1,200}$')

def resolve_recipients(targets):
    """Every recipient comes from the directory, looked up by poi_key at the moment of sending.
    Returns ({poi_key: row}, {poi_key_or_index: reason}). Request numbers, names and emails are ignored."""
    rejected, keys = {}, []
    for i, t in enumerate(targets):
        k = str((t or {}).get('poi_key') or '') if isinstance(t, dict) else ''
        if not KEY_RE.match(k): rejected[f'#{i}'] = 'INVALID_KEY'; continue
        if k in keys: rejected[k] = 'DUPLICATE_IN_REQUEST'; continue
        keys.append(k)
    found = {}
    if keys:
        with LOCK:
            rows = con.execute(f"select {', '.join(RECIPIENT_COLS)} from t where poi_key in (select unnest(?::varchar[]))", [keys]).fetchall()
        for r in rows:
            row = dict(zip(RECIPIENT_COLS, r))
            if row['poi_key'] in found: rejected[row['poi_key']] = 'AMBIGUOUS_KEY'
            else: found[row['poi_key']] = row
        for k in list(found):
            if rejected.get(k) == 'AMBIGUOUS_KEY': found.pop(k)
        for k in keys:
            if k not in found and k not in rejected: rejected[k] = 'NOT_IN_DIRECTORY'
    return found, rejected

def log_decision(kind, rfq_id, poi_key, decision, reason):
    """Decision trail without contact data: record id, decision and reason only."""
    try:
        with open(os.path.join(HERE, 'data', 'send_decisions.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'kind': kind, 'rfq_id': rfq_id, 'poi_key': poi_key, 'decision': decision, 'reason': reason}, ensure_ascii=False) + '\n')
    except OSError: pass

def provider_send(payload):
    """The only function that hands a message to WhatsApp. Refuses inside a dry run, whatever the caller does."""
    if not read_only_test.provider_calls_allowed():
        raise RuntimeError('READ_ONLY_TEST_ENV')
    if _DRY.get(): raise RuntimeError('DRY_RUN_PROVIDER_CALL')
    return graph(f"{WA_PHONE_ID}/messages", payload)

def send_farq(body):
    token = _DRY.set(body.get('dry_run') is True)
    try: return _send_farq(body)
    finally: _DRY.reset(token)

def _send_farq(body):
    """Register the chosen POIs as private suppliers + invites of the RFQ (holder), optionally send the marketing template
    from the Farq number and record a SENT dispatch attempt so the reply routes to that conversation.
    Recipients, names and numbers come from the directory (resolve_recipients); status_policy decides eligibility."""
    rfq_id = str(body.get('rfq_id', '')).strip().lower()
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', rfq_id): return {'ok': False, 'error': 'RFQ_ID_INVALID'}
    targets = body.get('targets') or []
    if not isinstance(targets, list) or not targets or len(targets) > 500: return {'ok': False, 'error': 'TARGETS_1_500'}
    mode = body.get('mode'); dry = body.get('dry_run') is True
    out = {'ok': False, 'rfq_id': rfq_id, 'dry_run': dry, 'added': 0, 'contacts_whatsapp': 0, 'contacts_email': 0, 'errors': [], 'sent': [], 'failed': [], 'eligible': []}
    clean = lambda v: re.sub(r'\s{2,}', ' ', re.sub(r'[\r\n\t]+', ' ', str(v or ''))).strip()[:1024]
    found, rejected = resolve_recipients(targets)
    for k, why in rejected.items():
        (out['failed'] if mode == 'template' else out['errors']).append({'poi_key': k, 'error': why}); log_decision('send_farq', rfq_id, k, 'reject', why)
    message = {str(t.get('poi_key')): t.get('message') for t in targets if isinstance(t, dict)}
    # Template variables are shared by the reviewed campaign. {{1}} remains the
    # directory recipient name; all later values originate from the explicit
    # fields rendered by the frontend for this template.
    raw_template_values = body.get('template_values') or {}
    template_values = raw_template_values if isinstance(raw_template_values, dict) else {}
    decided = []
    for k, row in found.items():
        ok, why = status_policy.send_decision(row)
        email = str(row.get('email') or '').lower(); email = email if re.match(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$', email) else None
        reasons = status_policy.send_reasons(row)
        email_only = mode != 'template' and email and reasons and all(r.startswith(('whatsapp:', 'contact:')) for r in reasons)
        if not ok and not email_only:
            (out['failed'] if mode == 'template' else out['errors']).append({'poi_key': k, 'error': 'NOT_ELIGIBLE:' + why}); log_decision('send_farq', rfq_id, k, 'reject', why); continue
        decided.append((k, row, ok, email)); out['eligible'].append(k); log_decision('send_farq', rfq_id, k, 'dry_run' if dry else 'accept', why)
    if dry: out['ok'] = True; return out
    if not DB_URL: return {**out, 'error': 'DB_NOT_CONFIGURED'}
    try:
        with pg() as con_pg:
            rfq = con_pg.execute('select id, buyer_user_id, current_version_id, status::text from construction.rfqs where id=%s', (rfq_id,)).fetchone()
            if not rfq: return {'ok': False, 'error': 'RFQ_NOT_FOUND'}
            _, owner, ver, status = rfq; owner = str(owner); ver = str(ver); out['buyer'] = owner; out['rfq_status'] = status
            if mode == 'template':
                tpl = body.get('template', 'farq_outreach_ar')
                custom_indexes = sorted(int(k) for k, v in template_values.items() if str(k).isdigit() and int(k) > 1 and clean(v))
                if custom_indexes and custom_indexes != list(range(2, max(custom_indexes) + 1)):
                    return {**out, 'error': 'TEMPLATE_VALUES_INVALID'}
                for k, row, wa_ok, _ in decided:
                    if not wa_ok: continue
                    to = status_policy.mobile_of(row)
                    inv = con_pg.execute('select i.id from construction.rfq_invites i join construction.suppliers s on s.id=i.supplier_id where i.rfq_version_id=%s and s.external_key=%s limit 1', (ver, f"golden:{k}"[:300])).fetchone()
                    if not inv: out['failed'].append({'poi_key': k, 'error': 'NOT_REGISTERED'}); continue
                    values = {**template_values, '2': message.get(k) or template_values.get('2')}
                    max_index = max([1, *custom_indexes, 2])
                    parameters = [{'type': 'text', 'text': clean(row.get('name_ar') or row.get('name_en') or 'عميلنا الكريم')}]
                    for index in range(2, max_index + 1):
                        value = clean(values.get(str(index)))
                        if not value:
                            out['failed'].append({'poi_key': k, 'error': f'TEMPLATE_VALUE_{index}_MISSING'})
                            parameters = []
                            break
                        parameters.append({'type': 'text', 'text': value})
                    if not parameters: continue
                    payload = {'messaging_product': 'whatsapp', 'to': to, 'type': 'template', 'template': {'name': tpl, 'language': {'code': 'ar'},
                               'components': [{'type': 'body', 'parameters': parameters}]}}
                    r = provider_send(payload)
                    mid = (r.get('messages') or [{}])[0].get('id')
                    if mid:
                        con_pg.execute("insert into construction.dispatch_attempts(invite_id,channel,status,idempotency_key,provider_receipt_id,sent_at) values (%s,'WHATSAPP','SENT',%s,%s,now()) on conflict (idempotency_key) do nothing", (inv[0], f'golden-template:{inv[0]}:{tpl}', mid))
                        try: con_pg.execute("update construction.rfq_invites set delivery_status='SENT', updated_at=now() where id=%s and delivery_status='PENDING'", (inv[0],))
                        except Exception: pass
                        out['sent'].append({'poi_key': k, 'message_id': mid, 'invite_id': str(inv[0])})
                    else:
                        e = r.get('error') or {}; out['failed'].append({'poi_key': k, 'error': (e.get('message') or 'UNKNOWN')})
                con_pg.commit(); out['ok'] = True
            else:
                line_keys = [r[0] for r in con_pg.execute('select line_key from construction.rfq_lines where rfq_version_id=%s order by line_number', (ver,)).fetchall()]
                if not line_keys: return {'ok': False, 'error': 'RFQ_HAS_NO_LINES'}
                out['line_keys'] = line_keys
                for k, row, wa_ok, em in decided:
                    ek = f"golden:{k}"[:300]
                    wa = status_policy.mobile_of(row) if wa_ok else None
                    name_ar = (str(row.get('name_ar') or row.get('name_en') or '').strip() or 'مورد')[:300]; name_en = (str(row.get('name_en') or row.get('name_ar') or '').strip() or name_ar)[:300]
                    try:
                        sid = con_pg.execute("""insert into construction.suppliers (external_key,name_ar,name_en,city,supplied_items_text,qualification_status,legal_entity_verified,source_ref,active,directory_visibility,owner_scope_user_id)
                            values (%s,%s,%s,%s,%s,'DISCOVERY_CANDIDATE',false,%s,true,'PRIVATE',%s)
                            on conflict (external_key) do update set name_ar=excluded.name_ar,name_en=excluded.name_en,city=coalesce(excluded.city,construction.suppliers.city),active=true,updated_at=now() returning id""",
                            (ek, name_ar, name_en, row.get('city_en'), row.get('category'), f"GOLDEN_TARGETING:{body.get('query','')}"[:300], owner)).fetchone()[0]
                        con_pg.execute("""insert into construction.supplier_contacts (supplier_id,contact_name,whatsapp_e164,emails,source_ref) values (%s,%s,%s,%s,'GOLDEN_TARGETING')
                            on conflict (supplier_id) do update set whatsapp_e164=coalesce(excluded.whatsapp_e164,construction.supplier_contacts.whatsapp_e164),
                            emails=case when cardinality(excluded.emails)>0 then excluded.emails else construction.supplier_contacts.emails end,updated_at=now()""", (sid, name_ar, wa, [em] if em else []))
                        import hashlib, secrets
                        tok = hashlib.sha256(secrets.token_urlsafe(32).encode()).hexdigest()
                        con_pg.execute("""insert into construction.rfq_invites (rfq_version_id, supplier_id, access_token_hash, access_token_expires_at, added_by_farq)
                            values (%s,%s,%s, now() + interval '30 days', true) on conflict (rfq_version_id, supplier_id) do update set updated_at=now()""", (ver, sid, tok))
                        out['added'] += 1; out['contacts_whatsapp'] += 1 if wa else 0; out['contacts_email'] += 1 if em else 0
                    except Exception as e:
                        con_pg.rollback(); out['errors'].append({'poi_key': k, 'error': type(e).__name__})
                con_pg.execute("insert into construction.procurement_audit_events (actor_user_id,entity_type,entity_id,event_type,snapshot) values (%s,'RFQ',%s,'GOLDEN_TARGETING_INVITES',%s)",
                               (owner, rfq_id, json.dumps({'added': out['added'], 'query': body.get('query', '')}, ensure_ascii=False)))
                con_pg.commit(); out['ok'] = True
    except Exception as e:
        out['fatal'] = type(e).__name__
    with open(os.path.join(HERE, 'data', 'farq_send_log.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'rfq_id': rfq_id, 'mode': mode, 'n': len(targets),
                            'sent': len(out['sent']), 'failed': len(out['failed']), 'errors': len(out['errors']), 'added': out['added']}, ensure_ascii=False) + '\n')
    return out

WA_TOKEN = os.environ.get('CONSTRUCTION_WHATSAPP_ACCESS_TOKEN'); WA_PHONE_ID = os.environ.get('CONSTRUCTION_WHATSAPP_PHONE_NUMBER_ID'); WA_WABA = os.environ.get('WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID')
WA_GRAPH = 'https://graph.facebook.com/v23.0'
def graph(path, body=None, method=None):
    if not read_only_test.provider_calls_allowed():
        return {'error': {'message': 'READ_ONLY_TEST_ENV'}}
    req = urllib.request.Request(f"{WA_GRAPH}/{path}", data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {WA_TOKEN}', 'content-type': 'application/json'}, method=method or ('POST' if body is not None else 'GET'))
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read())
        except Exception: return {'error': {'message': str(e)}}

def template_status(name):
    d = graph(f"{WA_WABA}/message_templates?name={name}&fields=name,status,category,rejected_reason")
    rows = d.get('data') or []
    return rows[0] if rows else {'name': name, 'status': 'MISSING'}

def list_templates():
    """Every template of the WhatsApp Business account with its Meta status (read only)."""
    if not (WA_TOKEN and WA_WABA): return {'ok': False, 'error': 'WHATSAPP_NOT_CONFIGURED', 'data': []}
    d = graph(f"{WA_WABA}/message_templates?fields=name,status,category,language,rejected_reason,components&limit=200")
    if d.get('error'): return {'ok': False, 'error': (d['error'] or {}).get('message'), 'data': []}
    return {'ok': True, 'data': d.get('data') or []}

def create_template(body):
    """Submit one template to Meta for review. Sends nothing to anyone; Meta answers APPROVED / PENDING / REJECTED."""
    if not (WA_TOKEN and WA_WABA): return {'ok': False, 'error': 'WHATSAPP_NOT_CONFIGURED'}
    name = str(body.get('name', ''))
    if not re.match(r'^[a-z0-9_]{1,512}$', name): return {'ok': False, 'error': 'NAME_INVALID'}
    if body.get('category') not in ('MARKETING', 'UTILITY', 'AUTHENTICATION'): return {'ok': False, 'error': 'CATEGORY_INVALID'}
    if body.get('language') not in ('ar', 'en'): return {'ok': False, 'error': 'LANGUAGE_INVALID'}
    comps = body.get('components')
    if not isinstance(comps, list) or not any(isinstance(c, dict) and c.get('type') == 'BODY' and str(c.get('text', '')).strip() for c in comps): return {'ok': False, 'error': 'BODY_REQUIRED'}
    payload = {'name': name, 'language': body['language'], 'category': body['category'], 'parameter_format': 'positional', 'components': comps}
    r = graph(f"{WA_WABA}/message_templates", payload)
    with open(os.path.join(HERE, 'data', 'template_create_log.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'name': name, 'category': body['category'], 'resp': r}, ensure_ascii=False) + '\n')
    if r.get('id'): return {'ok': True, 'id': r.get('id'), 'status': r.get('status'), 'category': r.get('category')}
    e = r.get('error') or {}
    return {'ok': False, 'error': e.get('error_user_msg') or e.get('message') or 'UNKNOWN', 'code': e.get('code')}

def send_template(body):
    token = _DRY.set(body.get('dry_run') is True)
    try: return _send_template(body)
    finally: _DRY.reset(token)

def _send_template(body):
    """Send farq_outreach_ar ({{1}} name, {{2}} message) from the Farq number to ONE directory record (poi_key).
    The number and the name come from the directory; 'to' / 'name' in the request are ignored."""
    found, rejected = resolve_recipients([{'poi_key': body.get('poi_key')}])
    if rejected:
        why = next(iter(rejected.values())); log_decision('send_template', None, str(body.get('poi_key') or ''), 'reject', why); return {'ok': False, 'error': why}
    row = next(iter(found.values()))
    # Atlas campaign recipients may have no lifecycle/status data in the source.
    # Its explicit caller flag allows only unknown_empty; known closed/inactive
    # and invalid states remain blocked, as do missing WhatsApp and bad phones.
    ok, why = status_policy.send_decision(row, allow_unknown_empty_status=body.get('atlas_campaign') is True)
    if not ok: log_decision('send_template', None, row['poi_key'], 'reject', why); return {'ok': False, 'error': 'NOT_ELIGIBLE:' + why}
    if body.get('dry_run') is True: log_decision('send_template', None, row['poi_key'], 'dry_run', why); return {'ok': True, 'dry_run': True, 'eligible': row['poi_key']}
    if not (WA_TOKEN and WA_PHONE_ID): return {'ok': False, 'error': 'WHATSAPP_NOT_CONFIGURED'}
    name = body.get('template', 'farq_outreach_ar')
    st = template_status(name)
    if st.get('status') != 'APPROVED': return {'ok': False, 'error': f"TEMPLATE_{st.get('status')}", 'template': st}
    to = status_policy.mobile_of(row)
    clean = lambda v: re.sub(r'\s{2,}', ' ', re.sub(r'[\r\n\t]+', ' ', str(v or ''))).strip()[:1024]
    params = [{'type': 'text', 'text': clean(row.get('name_ar') or row.get('name_en') or 'عميلنا الكريم')}, {'type': 'text', 'text': clean(body.get('message'))}]
    if not params[1]['text']: return {'ok': False, 'error': 'EMPTY_MESSAGE'}
    payload = {'messaging_product': 'whatsapp', 'to': to, 'type': 'template',
               'template': {'name': name, 'language': {'code': 'ar'}, 'components': [{'type': 'body', 'parameters': params}]}}
    log_decision('send_template', None, row['poi_key'], 'accept', why)
    r = provider_send(payload)
    ok = bool(r.get('messages'))
    with open(os.path.join(HERE, 'data', 'wa_template_log.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'to': status_policy.mask(to), 'poi_key': row['poi_key'], 'template': name, 'ok': ok, 'error_code': (r.get('error') or {}).get('code')}, ensure_ascii=False) + '\n')
    return {'ok': ok, 'message_id': (r.get('messages') or [{}])[0].get('id'), 'error': (r.get('error') or {}).get('message') if not ok else None, 'code': (r.get('error') or {}).get('code')}

def test_mobile(value):
    """Normalize a Saudi mobile supplied only for an owner test message."""
    digits = re.sub(r'\D', '', str(value or ''))
    if digits.startswith('00'): digits = digits[2:]
    if len(digits) == 10 and digits.startswith('05'): digits = '966' + digits[1:]
    elif len(digits) == 9 and digits.startswith('5'): digits = '966' + digits
    return digits if re.fullmatch(r'9665\d{8}', digits) else None

def send_test_template(body):
    """Deliver one approved two-variable template to a manually entered Saudi test number.

    This deliberately bypasses directory lookup and RFQ creation. It is exposed
    only behind the Farq owner proxy and keeps the number out of the directory.
    """
    to = test_mobile(body.get('to'))
    if not to: return {'ok': False, 'error': 'TEST_PHONE_INVALID'}
    template = str(body.get('template') or 'farq_outreach_ar').strip()
    if template != 'farq_outreach_ar': return {'ok': False, 'error': 'TEST_TEMPLATE_UNSUPPORTED'}
    message = re.sub(r'\s{2,}', ' ', re.sub(r'[\r\n\t]+', ' ', str(body.get('message') or ''))).strip()[:1024]
    if not message: return {'ok': False, 'error': 'EMPTY_MESSAGE'}
    name = re.sub(r'\s{2,}', ' ', re.sub(r'[\r\n\t]+', ' ', str(body.get('name') or 'اختبار فرق'))).strip()[:300]
    if not (WA_TOKEN and WA_PHONE_ID): return {'ok': False, 'error': 'WHATSAPP_NOT_CONFIGURED'}
    status = template_status(template)
    if status.get('status') != 'APPROVED': return {'ok': False, 'error': f"TEMPLATE_{status.get('status')}", 'template': status}
    payload = {'messaging_product': 'whatsapp', 'to': to, 'type': 'template',
               'template': {'name': template, 'language': {'code': 'ar'}, 'components': [{'type': 'body', 'parameters': [
                   {'type': 'text', 'text': name}, {'type': 'text', 'text': message},
               ]}]}}
    response = provider_send(payload)
    ok = bool(response.get('messages'))
    with open(os.path.join(HERE, 'data', 'wa_template_log.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'to': status_policy.mask(to), 'test': True, 'template': template, 'ok': ok, 'error_code': (response.get('error') or {}).get('code')}, ensure_ascii=False) + '\n')
    return {'ok': ok, 'message_id': (response.get('messages') or [{}])[0].get('id'), 'error': (response.get('error') or {}).get('message') if not ok else None, 'code': (response.get('error') or {}).get('code')}

LOGIN_HTML = '''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>فرق تسعير — دخول</title>
<body style="font-family:-apple-system,Tahoma;background:#0f1115;color:#e8eaf0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<form method="post" action="/login" style="background:#171a21;padding:28px;border-radius:12px;border:1px solid #2a2f3a;min-width:300px"><h2 style="margin:0 0 14px">فرق تسعير — الاستهداف</h2>
<input name="p" type="password" placeholder="كلمة المرور" style="width:100%;padding:10px;border-radius:8px;border:1px solid #2a2f3a;background:#0f1115;color:#fff;font-size:15px" autofocus>
<button style="margin-top:12px;width:100%;padding:10px;border-radius:8px;border:0;background:#3b82f6;color:#fff;font-size:15px">دخول</button></form></body></html>'''

# ---------- sessions (owner-approved 2026-10-15) ----------
# Browser users: one random session per login, kept in memory, idle 8 h / max 7 days, logout, rate-limited login.
# The farq-pricing proxy: X-Farq-Service header (TARGETING_SERVICE_TOKEN when set; until then a value derived from the
# password that differs from any browser cookie). The old password-derived cookie (ft_auth) is no longer accepted.
import hmac, hashlib, secrets, http.cookies
SESSION_IDLE, SESSION_MAX, LOGIN_WINDOW, LOGIN_MAX = 8 * 3600, 7 * 86400, 60, 5
SESSIONS = {}; LOGIN_ATTEMPTS = {}; AUTH_LOCK = threading.Lock()
def service_token():
    t = os.environ.get('TARGETING_SERVICE_TOKEN')
    if t: return t
    return hmac.new(AUTH_PASSWORD.encode(), b'farq-proxy-v1', hashlib.sha256).hexdigest() if AUTH_PASSWORD else None
def session_ok(sid, now=None):
    now = now or time.time()
    with AUTH_LOCK:
        s = SESSIONS.get(sid)
        if not s: return False
        created, seen = s
        if now - seen > SESSION_IDLE or now - created > SESSION_MAX: SESSIONS.pop(sid, None); return False
        SESSIONS[sid] = (created, now); return True
def login_allowed(ip, now=None):
    now = now or time.time()
    with AUTH_LOCK:
        hits = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < LOGIN_WINDOW]
        hits.append(now); LOGIN_ATTEMPTS[ip] = hits
        return len(hits) <= LOGIN_MAX

class H(BaseHTTPRequestHandler):
    def handle_one_request(self):
        """Record only fixed route labels, status, and duration for safe scraping."""
        started = time.monotonic()
        self._metric_route = "other"
        self._metric_status = 500
        self._metric_has_request = False
        try:
            super().handle_one_request()
        finally:
            if self._metric_has_request:
                METRICS.observe(self._metric_route, self._metric_status, time.monotonic() - started)

    def send_response(self, code, message=None):
        self._metric_status = int(code)
        return super().send_response(code, message)

    def _authed(self):
        if not AUTH_PASSWORD: return not os.environ.get('RAILWAY_ENVIRONMENT')   # local development only; never open in production
        svc, tok = service_token(), self.headers.get('X-Farq-Service') or ''
        if svc and tok and hmac.compare_digest(tok.encode(), svc.encode()): return True
        try: jar = http.cookies.SimpleCookie(self.headers.get('Cookie') or '')
        except http.cookies.CookieError: return False
        sid = jar['ft_session'].value if 'ft_session' in jar else ''
        return bool(sid) and session_ok(sid)
    def _client_ip(self):
        return (self.headers.get('X-Forwarded-For') or self.client_address[0]).split(',')[0].strip()
    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False, default=str).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
    def do_GET(self):
        route=urllib.parse.urlparse(self.path)
        self._metric_has_request = True
        self._metric_route = route_label(route.path)
        if route.path == '/healthz':
            ready = is_ready(DATA, con, LOCK)
            self._json({'ok': ready, 'service': 'farq-targeting'}, 200 if ready else 503)
            return
        if route.path=='/logout': self.do_POST(); return   # same handling as POST /logout
        if route.path == '/metrics':
            if not self._authed(): self._json({"error":"UNAUTHORIZED"},401); return
            body = METRICS.render_prometheus()
            self.send_response(200); self.send_header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        if route.path=="/districts":
            # official district outlines (MOMRAH atlas, 6 cities) for the map's district picker (owner 2026-10-16)
            if not self._authed(): self._json({"error":"UNAUTHORIZED"},401); return
            city=urllib.parse.parse_qs(route.query).get("city",[""])[0]
            if not city or len(city)>80: self._json({"error":"INPUT"},400); return
            global _DISTRICTS
            try: _DISTRICTS
            except NameError:
                p=CANONICAL['districts.geojson']; _DISTRICTS=json.load(open(p,encoding='utf-8')) if os.path.isfile(p) else {'features':[]}
            self._json({'type':'FeatureCollection','features':[f for f in _DISTRICTS['features'] if f['properties'].get('city_en')==city]}); return
        if route.path=="/population-districts":
            # Population estimates are served from the existing data volume and
            # joined to the same official district IDs used by /districts.
            if not self._authed(): self._json({"error":"UNAUTHORIZED"},401); return
            city=urllib.parse.parse_qs(route.query).get("city",[""])[0]
            if not city or len(city)>80: self._json({"error":"INPUT"},400); return
            try:
                rows=golden_population(city)
                if rows is None: self._json({"error":"UNAVAILABLE"},503); return
                self._json({'city_en':city,'districts':rows})
            except Exception as error:
                log_map_api_failure('population-districts',error)
                self._json({"error":"UNAVAILABLE"},503)
            return
        if route.path=="/population-demographics":
            # Modeled WorldPop age/sex aggregates; never serve the source grids.
            if not self._authed(): self._json({"error":"UNAUTHORIZED"},401); return
            query=urllib.parse.parse_qs(route.query,keep_blank_values=True)
            city=query.get("city",[""])[0]
            districts=query.get("district",[])
            if not city or len(city)>80 or len(districts)>50 or any(not item or len(item)>120 for item in districts):
                self._json({"error":"INPUT"},400); return
            try:
                rows=golden_demographics(city,districts)
                if rows is None: self._json({"error":"UNAVAILABLE"},503); return
                self._json({'city_en':city,'districts':rows})
            except Exception as error:
                log_map_api_failure('population-demographics',error)
                self._json({"error":"UNAVAILABLE"},503)
            return
        if route.path.startswith("/tiles/") or route.path=="/facets":
            if not self._authed(): self._json({"error":"UNAUTHORIZED"},401); return
            try:
                if route.path=="/facets":
                    city=urllib.parse.parse_qs(route.query).get("city",["*"])[0]
                    if len(city)>80: raise ValueError()
                    self._json(TILES.facets(city)); return
                match=re.fullmatch(r"/tiles/([a-f0-9]{32})/(\d{1,2})/(\d{1,7})/(\d{1,7})\.pbf",route.path)
                if not match: raise ValueError()
                key,z,x,y=match.groups();data=TILES.tile(key,int(z),int(x),int(y))
                self.send_response(200);self.send_header("Content-Type","application/vnd.mapbox-vector-tile");self.send_header("Cache-Control","private, no-store");self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)
            except KeyError: self._json({"error":"MAP_QUERY_EXPIRED"},410)
            except ValueError: self._json({"error":"INPUT"},400)
            except Exception as error:
                log_map_api_failure('map-tiles-or-facets', error)
                self._json({"error":"UNAVAILABLE"},503)
            return
        if not self._authed():
            b = LOGIN_HTML.encode(); self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        if self.path in ('/', '/index.html'):
            b = open(os.path.join(HERE, 'index.html'), 'rb').read()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
        elif self.path == '/status':
            with LOCK: n = con.execute("select count(*), count(*) filter (where has_whatsapp), count(*) filter (where email is not null) from t where " + SEARCH_SQL).fetchone()
            self._json({'ai': bool(API_KEY), 'model': MODEL if API_KEY else None, 'pois': n[0], 'whatsapp': n[1], 'email': n[2]})
        elif self.path == '/templates':
            self._json(list_templates())
        elif self.path == '/cities':
            self._json(cities())
        elif self.path.startswith('/template-status'):
            st = template_status('farq_outreach_ar'); st['holder'] = load_holder(); self._json(st)
        elif self.path == '/log':
            rows = []
            if os.path.exists(LOG):
                with open(LOG, encoding='utf-8') as f: rows = [{**r, 'to': status_policy.mask(r.get('to'))} for r in csv.DictReader(f)]
            self._json(rows[-500:])
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        self._metric_has_request = True
        self._metric_route = route_label(self.path)
        if self.path in input_upload.INPUTS:   # streamed to the volume, so it is handled before the body is read into memory
            status, body = input_upload.receive(self.headers, self.rfile, AUX_DATA_DIR, path=self.path)
            LOGGER.info('input_upload status=%s', status)
            self._json(body, status)
            if status == 200:
                import startup_jobs
                for job in startup_jobs.start(DATA_DIR, AUX_DATA_DIR): LOGGER.info('startup job running in background after upload: %s', job)
            return
        n = int(self.headers.get('Content-Length', 0)); raw = self.rfile.read(n)
        if self.path == '/login':
            if not login_allowed(self._client_ip()): self._json({'error': 'TOO_MANY_ATTEMPTS'}, 429); return
            p = urllib.parse.parse_qs(raw.decode(errors='replace')).get('p', [''])[0]
            self.send_response(303); self.send_header('Location', '/')
            if AUTH_PASSWORD and hmac.compare_digest(p.encode(), AUTH_PASSWORD.encode()):
                sid = secrets.token_urlsafe(32)
                with AUTH_LOCK: SESSIONS[sid] = (time.time(), time.time())
                self.send_header('Set-Cookie', f"ft_session={sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={SESSION_MAX}")
                self.send_header('Set-Cookie', "ft_auth=; Path=/; Max-Age=0")
            self.end_headers(); return
        if self.path == '/logout':
            try: jar = http.cookies.SimpleCookie(self.headers.get('Cookie') or ''); sid = jar['ft_session'].value if 'ft_session' in jar else ''
            except http.cookies.CookieError: sid = ''
            with AUTH_LOCK: SESSIONS.pop(sid, None)
            self.send_response(303); self.send_header('Location', '/'); self.send_header('Set-Cookie', "ft_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict"); self.end_headers(); return
        if not self._authed(): self._json({'error': 'UNAUTHORIZED'}, 401); return
        if read_only_test.blocks_request(self.path):
            self._json({
                'ok': False,
                'error': 'READ_ONLY_TEST_ENV',
                'message': 'بيئة الاختبار للقراءة فقط: لا يتم إرسال رسائل أو حفظ تغييرات أو الاتصال بميتا.',
            }, 403)
            return
        body = json.loads(raw or b'{}')
        if self.path in ('/map-query','/map-profile','/map-focus'):
            try:
                if self.path=='/map-query':
                    city=body.get('city')
                    if not isinstance(city,str) or not 1<=len(city)<=80: raise ValueError()
                    self._json(TILES.browse(city,body.get('filters'),1,0))
                elif self.path=='/map-focus':
                    query=body.get('query'); level=body.get('level'); identifier=body.get('id')
                    sub_id=body.get('sub_id'); specialty_id=body.get('specialty_id')
                    if not isinstance(query,str) or not 16<=len(query)<=80: raise ValueError()
                    self._json({'map_query':TILES.focus(query,level,identifier,sub_id,specialty_id)})
                else:
                    row=TILES.profile(str(body.get('query','')),str(body.get('poi_key','')))
                    self._json({'row':row},200 if row else 404)
            except KeyError: self._json({'error':'MAP_QUERY_EXPIRED'},410)
            except ValueError: self._json({'error':'INPUT'},400)
            except Exception as error:
                log_map_api_failure('map-context', error)
                self._json({'error':'UNAVAILABLE'},503)
        elif self.path == '/trial-search':
            try:
                result=TRIAL_DIRECTORY.search(body.get('q'), body.get('city'), body.get('objective', 'purchase'),min(200,max(1,int(body.get('limit',30)))),int(body.get('offset',0)));result.pop('_map_rows',None);self._json(result)
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('trial-search', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/clusters':
            # trade clusters for the map (owner 2026-10-16): streets/districts where a trade concentrates, wholesale marked
            try:
                import taxonomy_search
                tx = taxonomy_search.get(); city = body.get('city'); q = body.get('q'); subs = body.get('sub_ids') or []
                if not isinstance(city, str) or not 1 <= len(city) <= 80 or (q is not None and (not isinstance(q, str) or len(q) > 120)) \
                        or not isinstance(subs, list) or len(subs) > 20 or not all(isinstance(x, str) and len(x) <= 80 for x in subs): self._json({'error': 'INPUT'}, 400); return
                f = valid_filters({'bounds': body['bounds']} if body.get('bounds') is not None else {})
                if q and tx is not None:
                    u = tx.understand(q, 'marketing' if body.get('objective') == 'marketing' else 'purchase')
                    subs = subs or list(u['targets'])
                wholesale = body.get('wholesale') is True or bool(q and set(taxonomy_search.norm(q).split()) & {'جمله', 'بالجمله', 'wholesale', 'موزع', 'موزعين'})
                path = CLUSTERS
                self._json({'clusters': taxonomy_search.trade_clusters(path, city, subs, wholesale, f.get('bounds')), 'wholesale': wholesale,
                            'basis': 'تجمع = عدد المحلات من نفس النشاط في الشارع/الحي مقارنة بنسبته في المدينة؛ ليس تأكيدًا للأسعار أو التوفر'})
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('clusters', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/advisor':
            # the comparison assistant's model call; Atlas checks the user and owns the prompt (advisor_proxy.py)
            import advisor_proxy
            try: system, messages = advisor_proxy.read(body)
            except ValueError: self._json({'error': 'INPUT'}, 400); return
            status, answer = advisor_proxy.reply(system, messages)
            LOGGER.info('advisor status=%s', status)
            self._json(answer, status)
        elif self.path in ('/growth', '/population-around', '/population-within', '/territories', '/district-income', '/district-audience', '/housing-level', '/real-estate', '/registered-deals', '/real-estate-listings', '/district-profile'):
            # Commercial insights over the district layers (insights.py); aggregates only, no business records.
            try:
                self._json(insight_response(self.path, body))
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('insights', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/market-gaps':
            # Districts where an activity has fewer directory businesses than its residents would carry at the city rate.
            try:
                city = body.get('city')
                if not isinstance(city, str) or not 1 <= len(city) <= 80: raise ValueError('city')
                self._json(MARKET_ANALYTICS.market_gaps(body, district_population_by_name(city)))
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('market-gaps', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/district-points':
            # Business records with coordinates for route planning; Atlas serves it only to signed-in users.
            try: self._json(MARKET_ANALYTICS.district_points(body))
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('district-points', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/places-near':
            # schools, hospitals, the airport and the centre around a home (market_analytics.places_near)
            try: self._json(MARKET_ANALYTICS.places_near(body))
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('places-near', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/brand-profile':
            # one chain across every activity in the city: branches per district and the activities they fall under
            try: self._json(MARKET_ANALYTICS.brand_profile(body))
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('brand-profile', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/brands':
            # chains of an activity and where their branches are (market_analytics.brands); aggregate counts only
            try:
                city = _city(body)
                self._json(MARKET_ANALYTICS.brands(body, population=district_population_by_name(city), history=market_analytics.read_chain_history(CHAIN_HISTORY)))
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('brands', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path in ('/market-summary', '/district-counts', '/district-insights', '/who-buys'):
            # Read-only market aggregates for the map; analytics return aggregate counts only.
            try:
                if self.path == '/market-summary': self._json(MARKET_ANALYTICS.market_summary(body))
                elif self.path == '/district-counts': self._json(MARKET_ANALYTICS.district_counts(body))
                elif self.path == '/district-insights': self._json(MARKET_ANALYTICS.district_insights(body))
                else: self._json(MARKET_ANALYTICS.who_buys(body))
            except ValueError: self._json({'error': 'INPUT'}, 400)
            except Exception as error:
                log_map_api_failure('market-analytics', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path in ('/street-density', '/street-density/catalog'):
            # dense streets along real streets (street_density.py), owner 2026-10-16: shown as soon as the map opens (all
            # activities in the city), narrowed by a main activity, subcategory, exact specialty, a request, and/or districts
            try:
                import taxonomy_search, duckdb
                tx = taxonomy_search.get(); city = body.get('city'); q = body.get('q'); subs = body.get('sub_ids') or []
                main = body.get('main_id'); districts = body.get('districts') or []; specialties = body.get('specialty_ids') or []
                bad = (not isinstance(city, str) or not 1 <= len(city) <= 80 or (q is not None and (not isinstance(q, str) or len(q) > 120))
                       or not isinstance(subs, list) or len(subs) > 20 or not all(isinstance(x, str) and len(x) <= 80 for x in subs)
                       or not isinstance(specialties, list) or len(specialties) > 20 or not all(isinstance(x, str) and 1 <= len(x) <= 80 for x in specialties)
                       or (main is not None and (not isinstance(main, str) or len(main) > 40))
                       or not isinstance(districts, list) or len(districts) > 30 or not all(isinstance(x, str) and len(x) <= 80 for x in districts))
                if bad: self._json({'error': 'INPUT'}, 400); return
                path = STREET_DENSITY
                if not os.path.isfile(path): self._json({'type': 'FeatureCollection', 'features': [], 'specialty_available': not bool(specialties), 'basis': 'بيانات كثافة الشوارع غير متاحة.'}); return
                db = duckdb.connect()
                if specialties:
                    columns = {row[0] for row in db.execute('describe select * from read_parquet(?)', [path]).fetchall()}
                    if 'specialty_ids' not in columns:
                        db.close()
                        self._json({'type': 'FeatureCollection', 'features': [], 'specialty_available': False, 'basis': 'مصدر كثافة الشوارع لا يفصل التخصصات حتى الآن؛ أخفينا الخطوط العامة كي لا تبدو كأنها مطابقة للتخصص.'}); return
                if q and tx is not None and not subs:
                    subs = list(tx.understand(q, 'marketing' if body.get('objective') == 'marketing' else 'purchase')['targets'])
                where, params = ['city_en = ?'], [city]
                if subs: where.append('sub_id in (select unnest(?::varchar[]))'); params.append(subs[:20])
                if specialties: where.append("list_has_any(string_split(coalesce(specialty_ids, ''), '|'), ?::varchar[])"); params.append(specialties)
                if main: where.append('main_id = ?'); params.append(main)
                if districts: where.append('district_ar in (select unnest(?::varchar[]))'); params.append(districts)
                if self.path.endswith('/catalog'):
                    rows = db.execute(f"""select main_id, any_value(main_ar), sub_id, any_value(sub_ar), count(*), sum(n) from read_parquet(?)
                        where {' and '.join(where)} group by main_id, sub_id order by 6 desc""", [path] + params).fetchall()
                    mains = {}
                    for mid, mar, sid, sar, k, n in rows:
                        m = mains.setdefault(mid, {'main_id': mid, 'main_ar': mar, 'streets': 0, 'shops': 0, 'subs': []})
                        m['streets'] += k; m['shops'] += int(n); m['subs'].append({'sub_id': sid, 'sub_ar': sar, 'streets': k, 'shops': int(n)})
                    self._json({'mains': sorted(mains.values(), key=lambda m: -m['shops'])}); return
                rows = db.execute(f"""select sub_id, sub_ar, main_id, main_ar, street_ar, district_ar, n, n_wholesale, length_m, per_100m, lift, geojson
                    from read_parquet(?) where {' and '.join(where)} order by n desc limit 80""", [path] + params).fetchall()
                self._json({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': json.loads(g), 'properties': {
                    'sub_id': sid, 'sub_ar': sar or '', 'main_id': mid, 'main_ar': mar or '', 'street_ar': st, 'district_ar': dist or '', 'n': n,
                    'n_wholesale': nw, 'length_m': L, 'per_100m': d, 'lift': lf,
                    'label_ar': f'{st} — {n} محل {sar or ""} على {L} م'}} for sid, sar, mid, mar, st, dist, n, nw, L, d, lf, g in rows],
                    'specialty_available': True,
                    'basis': 'كل منشأة على أقرب شارع لها (حتى ٤٠ م)؛ الكثافة = عدد المحلات لكل ١٠٠ م مقارنة بنسبة النشاط في المدينة'})
            except Exception as error:
                log_map_api_failure('street-density', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/suggest-specialties':
            # supplier onboarding: the supplier names his sector and his main materials in his own words; we suggest specialties to confirm
            try:
                import taxonomy_search
                tx = taxonomy_search.get(); text = body.get('text'); main = body.get('main_id')
                if tx is None: self._json({'error': 'UNAVAILABLE'}, 503); return
                if not isinstance(text, str) or not 2 <= len(text.strip()) <= 1000 or (main is not None and not isinstance(main, str)): self._json({'error': 'INPUT'}, 400); return
                self._json({'suggestions': tx.suggest_specialties(text, main or None)})
            except Exception as error:
                log_map_api_failure('suggest-specialties', error)
                self._json({'error': 'UNAVAILABLE'}, 503)
        elif self.path == '/search':
            try:
                if body.get('objective')=='browse':
                    self._json(TILES.browse(body.get('city'),body.get('filters'),min(200,max(1,int(body.get('limit',30)))),int(body.get('offset',0)))); return
                if body.get('objective') in ('purchase','marketing','name'):
                    result=TRIAL_DIRECTORY.search(body.get('q'),body.get('city'),body['objective'],min(200,max(1,int(body.get('limit',30)))),int(body.get('offset',0)),valid_filters(body.get('filters')))
                    cohort=result.pop('_map_rows',result['rows']);result['located_total']=sum(is_precise_point(r) for r in cohort);result['map_query']=TILES.register(rows=cohort)
                    rows,contact_status=contact_lookup.enrich(result['rows']); understood=result['understood']
                    result={**result,'rows':rows,'contact_enrichment':contact_status}
                    self._json({**result,'parsed':{'keywords':[understood['family']],'seller_label':understood['target_label'],'seller_terms':understood['target_types'],'city':body['city'],'ai':understood['source']=='ai'},'with_whatsapp':sum(has_usable_whatsapp(r) for r in rows),'with_email':sum(bool(r.get('email')) for r in rows),'by_region':[]})
                else:
                    self._json(search(body.get('q', ''), body.get('limit', 3000), body.get('only_sendable', False), body.get('city') or None))
            except ValueError: self._json({'error':'INPUT'},400)
            except Exception as error:
                log_map_api_failure('search', error)
                self._json({'error':'UNAVAILABLE'},503)
        elif self.path == '/demo-understand':
            try: self._json(demo_understand(body))
            except Exception: self._json({'ok': False, 'error': 'DEMO_FAILED'}, 500)
        elif self.path == '/demo-search':
            try: self._json(demo_search(body))
            except Exception as e: self._json({'ok': False, 'error': 'DEMO_FAILED'}, 500)
        elif self.path == '/templates':
            try: self._json(create_template(body))
            except Exception as e: self._json({'ok': False, 'error': str(e)[:200]}, 500)
        elif self.path == '/send-template':
            try: self._json(send_template(body))
            except Exception as e: self._json({'ok': False, 'error': str(e)}, 500)
        elif self.path == '/send-test-template':
            try: self._json(send_test_template(body))
            except Exception as e: self._json({'ok': False, 'error': str(e)}, 500)
        elif self.path == '/send-farq':
            try: self._json(send_farq(body))
            except Exception as e: self._json({'ok': False, 'error': str(e)}, 500)
        elif self.path == '/log':
            new = not os.path.exists(LOG)
            with open(LOG, 'a', encoding='utf-8', newline='') as f:
                w = csv.DictWriter(f, fieldnames=['ts','poi_key','name','channel','to','message','query'])
                if new: w.writeheader()
                w.writerow({'ts': time.strftime('%Y-%m-%d %H:%M:%S'), **{k: body.get(k, '') for k in ['poi_key','name','channel','message','query']}, 'to': status_policy.mask(body.get('to'))})
            self._json({'ok': True})
        else:
            self.send_response(404); self.end_headers()

if __name__ == '__main__':
    if os.environ.get('RAILWAY_ENVIRONMENT') and not AUTH_PASSWORD: sys.exit('TARGETING_PASSWORD is required in production')
    print(f"Farq Targeting on http://localhost:{PORT}  (AI: {'on' if API_KEY else 'off — fallback dictionary'})", flush=True)
    import startup_jobs
    for job in startup_jobs.start(DATA_DIR, AUX_DATA_DIR): print(f"startup job running in background: {job}", flush=True)
    threading.Thread(target=_record_chain_history, daemon=True, name='chain-history').start()
    ThreadingHTTPServer(('0.0.0.0' if os.environ.get('RAILWAY_ENVIRONMENT') else '127.0.0.1', PORT), H).serve_forever()
