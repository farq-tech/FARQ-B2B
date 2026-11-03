"""Read-only aggregates for the Farq opportunity map.

All aggregates follow the directory's open-record policy. Activity-filtered
counts use the same high/medium row-level taxonomy confidence as map discovery.
This module returns aggregates only, never contact or business-identifying fields.
"""
import collections
import copy
import json
import os
from collections import Counter
import threading
import math

import classification_layer
import activity_groups
import taxonomy_search


DATA_DIR = os.environ.get("FARQ_TARGETING_DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
DATA = os.path.join(DATA_DIR, "targets.parquet")
POI_TAXONOMY = os.path.join(DATA_DIR, "poi_taxonomy.parquet")


def taxonomy_path():
    """The row-level classification the figures read: the AI layer when FARQ_AI_CLASSIFICATION is on and built,
    else the release file (classification_layer.served_taxonomy)."""
    return classification_layer.served_taxonomy(POI_TAXONOMY)

STREET_DENSITY = os.path.join(DATA_DIR, "street_density.parquet")

MAX_SUB_IDS = 50
MAX_DISTRICTS = 30
MAX_SPECIALTY_IDS = 20
MAX_TEXT = 120
RESULT_CACHE_SIZE = 512   # remembered aggregate answers (MarketAnalytics._remembered)

# Keep aggregate counts aligned with directory_tiles contact=whatsapp. A record needs
# both the source marker and a mobile number in a supported Saudi representation.
USABLE_WHATSAPP_SQL = """coalesce(p.has_whatsapp, false) and regexp_matches(
    regexp_replace(coalesce(p.phone_norm, ''), '[^0-9]', '', 'g'),
    '^(9665[0-9]{8}|009665[0-9]{8}|05[0-9]{8}|5[0-9]{8})$'
)"""

NEAR_BASIS = "أقرب الأماكن من دليل فرق في دائرة 6 كم، والمسافة خط مستقيم. نوع المدرسة (حكومية أو أهلية) من اسمها؛ ما لا يذكر اسمه النوع يظهر «مدرسة» فقط."
BRANDS_BASIS = "السلسلة: اسم تجاري له عدد الفروع المحدد أو أكثر (3 افتراضياً) في دليل فرق داخل المدينة لهذا النشاط، بعد توحيد كتابة الاسم وحذف اسم الفرع ورقمه وكلمة النشاط («صيدلية النهدي» و«النهدي» سلسلة واحدة). الاسمان العربي واللاتيني بسجل تجاري مشترك سلسلة واحدة إذا كان كل منهما أقرب اسم للآخر، وبلا سجل مشترك إذا تطابق نطقهما ولم يشبهه اسم آخر في النشاط، ولا تتسلسل الأسماء، وكلمة النشاط وحدها ليست سلسلة."
MARKET_BASIS = (
    "حصر سجلات الدليل غير المغلقة نهائياً في المدينة؛ الأحياء تعتمد على الإسناد الموثوق. "
    "عداد واتساب يتطلب علامة المصدر ورقماً سعودياً صالحاً للاستخدام، ولا يعني نية الشراء."
)
MARKET_GAPS_BASIS = (
    "النقص = عدد المنشآت المتوقع بمعدل المدينة (سكان لكل منشأة من النشاط نفسه) ناقص الموجود في الدليل. "
    "السكان رقم مقاس للحي حيث يتوفر، وإلا تقدير. الدليل لا يغطي كل المنشآت الفعلية، فالنقص يدل على مكان البحث لا على طلب مؤكد."
)


def population_method(source):
    """How a district's population was arrived at, in a word the interface may show: «measured», «buildings»
    (dwellings in the building layer) or «grid» (a satellite population grid); None when there is no figure. Atlas
    never names an outside source (docs/atlas-product-foundation.md §5), so the source label stays in the service."""
    if not source:
        return None
    if str(source).startswith("910ths"):
        return "measured"
    if str(source).startswith("farq_buildings"):
        return "buildings"
    return "grid"
BUYER_BASIS = (
    "الشراء المتوقع مستنتج من علاقات التصنيف (يشتري عادةً)، وليس سجلاً لطلب أو شراء فعلي. "
    "عداد واتساب يتطلب علامة المصدر ورقماً سعودياً صالحاً للاستخدام."
)


UNCOVERED_MIN_POPULATION = 5000

# A district that is not ordinary homes should not lead a list of where shops are missing for residents. Two facts
# the data already holds mark it, nothing is estimated: the atlas's own district name says industrial («المدينة
# الصناعية الجديدة», «المصانع»), or 910ths measures nine in ten residents as men (labour housing: «المدينة الصناعية
# الجديدة» is 98.6% men). Such districts keep their figures and go after the others in market_gaps.
GAP_INDUSTRIAL_NAME = ("صناعي", "صناعيه", "صناعية", "مصانع")
GAP_WORKERS_MALE_PCT = 90.0


def gap_caveat(district_ar, male_pct):
    """«industrial», «workers» or None: why a district's shortfall is not a plain residential one."""
    if any(token in (district_ar or "") for token in GAP_INDUSTRIAL_NAME):
        return "industrial"
    if male_pct is not None and male_pct >= GAP_WORKERS_MALE_PCT:
        return "workers"
    return None


# Whether an activity's district counts are driven by population here is decided only from the counts and
# population the gap view already holds (no new data source). The gap number — expected businesses at the
# city rate, and the shortfall under it — is published only when the population model holds, i.e. all of:
#   * enough covered districts carry both a population figure and directory businesses,
#   * more population means more businesses there (regression slope > 0),
#   * the counts actually move with population (Pearson r ≥ GAP_MODEL_MIN_R),
#   * and population itself varies between those districts (positive variance).
# Wholesale, industrial, B2B and destination activities fail this test; for them a shortfall at the city
# rate is a fabricated number, so the view shows «غير متاح» and the districts' real counts only.
# The two thresholds are calibratable constants, not theory: raise GAP_MODEL_MIN_R to demand a tighter fit,
# GAP_MODEL_MIN_DISTRICTS to demand more covered districts before any rate is trusted. 0.3 and 8 are a
# deliberately permissive floor — they reject the clearly non-residential activities (flat or negative
# relationship, or too few districts to tell) without discarding a noisy but real residential signal.
GAP_MODEL_MIN_DISTRICTS = 8
GAP_MODEL_MIN_R = 0.3

# Why no shortfall is shown, told apart so the rep can act: a thin directory (too few covered districts to
# judge the relationship — not a verdict on the activity) versus a genuine non-population activity (enough
# districts, but the count does not track population). The second keeps the product-mandated wording.
GAP_UNAVAILABLE_MESSAGES = {
    "too_few_districts": "عدد الأحياء التي تحمل سكاناً ومنشآت لهذا النشاط أقل من أن يُقاس به ارتباطه بالسكان، "
                         "وقد يكون النشاط قليل الظهور في الدليل هنا؛ فلا يُقدَّر النقص، وتُعرض الأحياء بأعدادها الفعلية فقط.",
    "weak_relationship": "هذا النشاط لا يتبع عدد السكان في هذه المدينة، فلا يمكن تقدير النقص؛ "
                         "تُعرض الأحياء بأعدادها الفعلية فقط.",
}


def population_fit(populations, counts):
    """Pearson r and the slope of business count on population, with the population variance, over the
    districts that carry both figures. Returns (r, slope, variance); r and slope are None when either
    series is flat (no variation to correlate). Pure arithmetic over the two lists, no new data."""
    n = len(populations)
    if n < 2:
        return None, None, 0.0
    mean_pop = sum(populations) / n
    mean_count = sum(counts) / n
    sxx = sum((p - mean_pop) ** 2 for p in populations)
    syy = sum((c - mean_count) ** 2 for c in counts)
    sxy = sum((p - mean_pop) * (c - mean_count) for p, c in zip(populations, counts))
    variance = sxx / n
    if sxx == 0 or syy == 0:
        return None, None, variance
    r = sxy / math.sqrt(sxx * syy)
    slope = sxy / sxx
    return r, slope, variance


def market_gaps_basis(fit, covered_districts):
    """The gap basis line, with the measured fit appended so the number is auditable: the Pearson correlation
    between a district's population and its business count (signed, so a non-positive relationship is visible)
    and over how many districts it was measured."""
    if fit is None or not covered_districts:
        return MARKET_GAPS_BASIS
    return (MARKET_GAPS_BASIS +
            f" ارتباط عدد المنشآت بالسكان r = {fit} على {covered_districts} حي يحمل الرقمين.")


# a bare activity word is how many independent shops are named, not a brand (keys after letter folding)
GENERIC_BRAND_KEYS = frozenset({
    "صيدليه", "pharmacy", "مطعم", "restaurant", "مقهي", "كافيه", "cafe", "coffee", "بقاله", "grocery", "سوبرماركت",
    "supermarket", "تموينات", "مخبز", "bakery", "مغسله", "laundry", "صالون", "salon", "حلاق", "barber", "ورشه",
    "workshop", "مستودع", "warehouse", "مكتب", "office", "مؤسسه", "شركه", "company", "متجر", "store", "shop", "محل",
    "عياده", "clinic", "مجمع", "مركز", "center", "centre", "مدرسه", "school",
})


# Words that say what a business is or how it is registered, not which brand it is. Dropped to find a name's core,
# so «صيدليه النهدي», «النهدي», «nahdi pharmacy» and «al nahdi medical company pharmacy» meet as «النهدي» / «nahdi».
CORE_FILLER = GENERIC_BRAND_KEYS | frozenset({
    "صيدليات", "pharmacies", "الطبيه", "طبيه", "للادويه", "ادويه", "مطاعم", "restaurants", "مقاهي",
    "al", "el", "the", "and", "for", "of", "medical", "co", "est", "group", "trading",
    "للتجاره", "تجاره", "التجاريه", "شركات",
    # a kind of shop, not a brand: «مغاسل», «بخاري», «اسواق مركزيه», «غسيل سيارات» are many unrelated shops
    "مغاسل", "laundries", "اسواق", "مركزيه", "المركزيه", "غسيل", "سيارات", "السيارات", "بخاري", "البخاري",
    "ملابس", "clothes", "cleaners", "المحدوده", "محدوده", "للاطعمه", "دونتس", "دونات", "donuts",
    "car", "cars", "wash", "carwash", "كار", "واش", "وواش", "dontes", "donut", "doughnuts",
    # what is served or sold, or a cuisine: «بوفية», «مطعم باكستاني», «اكلات شعبية» are many unrelated places
    "بوفيه", "بوفيات", "اكلات", "شعبيه", "شعبي", "باكستاني", "هندي", "يمني", "يمنيه", "ويمنيه", "حجازي", "حجازيه",
    "لتقديم", "الوجبات", "للوجبات", "وجبات", "السريعه", "سريعه", "المشروبات", "تلميع",
    "مستحضرات", "لمستحضرات", "التجميل", "cosmetic", "cosmetics",
    # travel/tourism is an activity, not a brand: «وكالة … للسياحة والسفر», «Travel and Tourism Agency», «Tour» are many
    # unrelated agencies. A real brand keeps its distinctive word («المسافر للسفر والسياحة» -> «المسافر»).
    "سياحه", "سفر", "السياحه", "السفر", "للسياحه", "للسفر", "والسفر", "والسياحه", "وسفر", "وسياحه", "سياحيه", "السياحيه",
    "اسفار", "للاسفار", "رحلات", "للرحلات", "وكاله", "وكالات", "للوكاله", "لرحلات",
    "travel", "travels", "tourism", "tour", "tours", "tourist", "touristic", "agency", "agencies", "holiday", "holidays", "trips",
    # generic qualifiers and description words that attach to many names and are no brand on their own: they merged
    # «زوفر/سكاي/إيدر international» and description-as-name phrases («شركة متخصصة في مجال … تقدم خدمات …») into one
    "international", "intl", "عالميه", "العالميه", "الدوليه", "دوليه", "global", "worldwide", "national", "الوطنيه", "وطنيه",
    "company", "companies", "corporation", "enterprise", "services", "service", "خدمات", "الخدمات", "للخدمات", "خدماتها",
    "متخصصه", "متخصص", "المتخصصه", "مجال", "المجال", "تقدم", "متنوعه", "متنوعة", "largest", "leading", "best", "premium",
})

# Words that mark a registered company's own name: one that ends in a brand it runs is that brand
# («شركة شهية المحدودة للأطعمة دانكن», «Al-Shaya International Trade Company Starbucks»).
COMPANY_WORDS = frozenset({"شركه", "مؤسسه", "المحدوده", "محدوده", "company", "international", "ltd", "llc", "est"})

# Letters to the consonant skeleton a name keeps across scripts: «الجبر» and «aljabr» are both «jbr», «دانكن» and
# «dunkin» both «dnkn». Vowels, long vowels and «ع» drop; close sounds share one letter (ق ك خ -> k, ز -> s).
_AR_SOUND = str.maketrans({"ب": "b", "ت": "t", "ث": "t", "ج": "j", "ح": "h", "خ": "k", "د": "d", "ذ": "d", "ر": "r",
                           "ز": "s", "س": "s", "ش": "s", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "", "غ": "g",
                           "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "", "ي": "",
                           "ا": "", "ء": ""})
_LATIN_PAIRS = (("sh", "s"), ("th", "t"), ("kh", "k"), ("gh", "G"), ("ph", "f"), ("ck", "k"), ("ch", "s"))
_LATIN_SOUND = str.maketrans({"c": "k", "q": "k", "x": "k", "v": "f", "p": "b", "g": "j", "z": "s", "G": "g",
                              "a": "", "e": "", "i": "", "o": "", "u": "", "y": "", "w": ""})


def sound_key(core):
    """The consonant skeleton of a brand core, comparable between an Arabic and a Latin spelling."""
    arabic = any("؀" <= char <= "ۿ" for char in core)
    parts = []
    for word in core.split():
        if arabic:
            word = word[2:] if word.startswith("ال") and len(word) > 3 else word
            word = word[:-1] if word.endswith("ه") and len(word) > 2 else word   # ta marbuta, folded to ه
            parts.append(word.translate(_AR_SOUND))
        else:
            word = word[2:] if word.startswith(("al", "el")) and len(word) > 4 else word
            for pair, letter in _LATIN_PAIRS:
                word = word.replace(pair, letter)
            word = word[:-1] if word.endswith("h") and len(word) > 2 else word
            parts.append(word.translate(_LATIN_SOUND))
    skeleton = "".join(parts)
    return "".join(char for index, char in enumerate(skeleton) if not index or char != skeleton[index - 1])


def brand_core(key):
    """A brand key without its filler words and stray single letters («صيدليه الدواء s» -> «الدواء»); empty when
    nothing names a brand («the», «pharmacy pharmacy»)."""
    return " ".join(word for word in key.split() if len(word) > 1 and word not in CORE_FILLER)


def fold_key(text):
    """The brand key's letter folding (brand_sql) for a name read in Python: lower case, one Arabic letter form, letters,
    digits and single spaces only."""
    text = (text or "").lower().translate(str.maketrans("أإآةىؤئ", "اااهيوي")).replace("ـ", "")
    return " ".join("".join(char for char in text if char.isalnum() or char.isspace()).split())


def brand_sql(columns):
    """Select list giving each business its brand label and key: the registered brand name, else the business name
    cut before a branch suffix ("- العليا", "فرع", brackets) or a category after a comma ("ماك, محل مستحضرات"); the key compares labels after Arabic letter folding.
    Also the commercial registration, which joins a brand written in Arabic and in Latin letters."""
    brand = "nullif(trim(p.brand_name), '')" if "brand_name" in columns else "null"
    cr = "nullif(trim(p.commercial_license), '')" if "commercial_license" in columns else "null"
    label = (rf"trim(regexp_replace(regexp_replace(coalesce({brand}, nullif(trim(p.name_ar), ''), p.name_en), "
             r"'\s+(-|–|\||فرع|branch)(\s.*)?$|\s*[\(\[,،].*$', '', 'i'), '(\s+[0-9٠-٩]+)+$', ''))")
    # a branch number at the end («الجازع 5», «اوشن ٣١») names the branch, not the brand
    key = (rf"trim(regexp_replace(regexp_replace(regexp_replace(translate(lower({label}), 'أإآةىؤئـ', 'اااهيوي'), "
           r"'[^\pL\pN ]', '', 'g'), '\s+', ' ', 'g'), '(\s+[0-9٠-٩]+)+$', ''))")
    return f"p.poi_key, p.district_ar, {label} brand_label, {key} brand_key, {cr} cr"


def group_chains(rows):
    """Businesses (poi_key, district, label, key, cr) grouped into brands by the core of their key (brand_core), so
    a name with and without its activity word («صيدليه النهدي», «النهدي») is one brand. An Arabic core and a Latin
    core also join when they share commercial registrations and each is the other's strongest partner across
    scripts: the same brand in two scripts. A join never chains (Arabic to Latin to
    another Arabic name), so two competitors that a stray registration links stay apart, and different cores in the
    same script never join, so a holding company's brands stay apart. Filler alone («صيدليه», «the») names no brand,
    nor does a district's own name (places the directory names after their district) or a name fragment that opens
    with «لل» («للملابس الجاهزة»)."""
    arabic = lambda text: any("؀" <= char <= "ۿ" for char in text)
    places = {fold_key(district) for _, district, _, _, _ in rows if district}
    usable = lambda core: bool(core) and len(core) >= 2 and core not in places and not core.startswith("لل")
    cores = {key: brand_core(key or "") for _, _, _, key, _ in rows}
    # a company name joins the longest ending that is a chain of its own at least as large («شهيه دانكن» -> «دانكن»),
    # so a person's name («مؤسسه محمد علي») never folds into a small shop called «علي»
    size = Counter(cores[key] for _, _, _, key, _ in rows)
    for key, core in cores.items():
        words = core.split()
        if len(words) > 1 and set((key or "").split()) & COMPANY_WORDS:
            tails = (" ".join(words[start:]) for start in range(1, len(words)))
            cores[key] = next((tail for tail in tails if usable(tail) and size[tail] >= max(3, size[core])), core)
    by_cr = {}
    for poi, _, _, key, cr in rows:
        if usable(cores[key]) and cr:
            by_cr.setdefault(cr, {}).setdefault(cores[key], set()).add(poi)
    # how strongly each Arabic and Latin key are tied: branches sharing a registration, summed over registrations
    ties = Counter()
    for keys in by_cr.values():
        for key, pois in keys.items():
            for other, others in keys.items():
                if arabic(key) and not arabic(other):
                    ties[(key, other)] += min(len(pois), len(others))
    best_latin, best_arabic = {}, {}
    for (ar, la), weight in sorted(ties.items(), key=lambda item: (-item[1], item[0])):
        best_latin.setdefault(ar, la)
        best_arabic.setdefault(la, ar)
    partner = {la: ar for ar, la in best_latin.items() if best_arabic.get(la) == ar}
    # the same brand in two scripts with no shared registration on file: an Arabic and a Latin core still unpaired
    # join when their sound (sound_key) matches each other and no other name, paired or not, so two names alike in
    # sound stay apart and a name already paired by registration keeps a sound from looking unique
    paired = set(partner) | set(partner.values())
    by_sound = {}
    for core in {core for core in cores.values() if usable(core)}:
        sound = sound_key(core)
        if len(sound) >= 3:
            by_sound.setdefault(sound, []).append(core)
    for names in by_sound.values():
        ar, la = [name for name in names if arabic(name)], [name for name in names if not arabic(name)]
        if len(ar) == 1 and len(la) == 1 and not paired & {ar[0], la[0]}:
            partner[la[0]] = ar[0]
    groups = {}
    for poi, district, label, key, _ in rows:
        core = cores[key]
        if not usable(core):
            continue
        group = groups.setdefault(partner.get(core, core), {"keys": Counter(), "labels": Counter(), "pois": set(), "districts": Counter()})
        if poi in group["pois"]:
            continue
        group["pois"].add(poi)
        group["keys"][key] += 1
        group["labels"][label] += 1
        if district and district.strip():
            group["districts"][district] += 1
    for group in groups.values():
        # the Arabic spelling names the brand when it has one
        names = [label for label, _ in group["labels"].most_common() if arabic(label)] or [group["labels"].most_common(1)[0][0]]
        group["brand"] = names[0]
    return groups


def haversine_km(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(math.radians, (lon1, lat1, lon2, lat2))
    return 2 * 6371 * math.asin(math.sqrt(math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2))


# A snapshot is taken whenever the directory file changes, and a rebuild (classification, closures, name merging)
# changes it as much as real openings do: over days the difference is the pipeline, not the chain. Growth is shown
# once the history spans long enough for openings and closures to outweigh a rebuild.
MIN_GROWTH_DAYS = 30


def chain_growth(history, city, keys):
    """A brand's whole-city branches in the oldest and newest directory snapshots of the chain history, or None while
    the history holds fewer than two snapshots or spans under MIN_GROWTH_DAYS (shown as «غير متاح»)."""
    import datetime
    snapshots = (history or {}).get("snapshots") or []
    if len(snapshots) < 2:
        return None
    first, last = snapshots[0], snapshots[-1]
    try:
        span = (datetime.date.fromisoformat(last.get("date")) - datetime.date.fromisoformat(first.get("date"))).days
    except (TypeError, ValueError):
        return None
    if span < MIN_GROWTH_DAYS:
        return None
    count = lambda snapshot: sum((snapshot.get("cities", {}).get(city) or {}).get(key, 0) for key in keys)
    return {"since": first.get("date"), "before": count(first), "now": count(last)}


def record_chain_history(analytics, path, today=None):
    """Append a chain snapshot when the directory file differs from the last one recorded. Returns True when written."""
    import datetime
    import json
    stat = os.stat(analytics.data)
    signature = [stat.st_size, stat.st_mtime_ns]
    try:
        with open(path, encoding="utf-8") as handle:
            history = json.load(handle)
    except (OSError, ValueError):
        history = {"snapshots": []}
    if history["snapshots"] and history["snapshots"][-1].get("signature") == signature:
        return False
    history["snapshots"].append({"date": today or datetime.date.today().isoformat(), "signature": signature, "cities": analytics.chain_snapshot()})
    partial = path + ".partial"
    with open(partial, "w", encoding="utf-8") as handle:
        json.dump(history, handle, ensure_ascii=False)
    os.replace(partial, path)
    return True


def read_chain_history(path):
    import json
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


# fixed places a home is measured against, per city: its airport and its centre (lon, lat, label)
CITY_ANCHORS = {
    "Riyadh": {"airport": (46.6988, 24.9576, "مطار الملك خالد الدولي"), "center": (46.7135, 24.6311, "وسط الرياض (قصر الحكم)")},
    "Jeddah": {"airport": (39.1565, 21.6796, "مطار الملك عبدالعزيز الدولي"), "center": (39.1868, 21.4858, "وسط جدة (البلد)")},
    "Makkah Al Mukarramah": {"airport": (39.1565, 21.6796, "مطار الملك عبدالعزيز الدولي"), "center": (39.8262, 21.4225, "المسجد الحرام")},
    "Al Madinah Al Munawwarah": {"airport": (39.7051, 24.5534, "مطار الأمير محمد بن عبدالعزيز"), "center": (39.6111, 24.4672, "المسجد النبوي")},
    "Dammam": {"airport": (49.7979, 26.4712, "مطار الملك فهد الدولي"), "center": (50.1033, 26.4344, "وسط الدمام")},
    "Al Khobar": {"airport": (49.7979, 26.4712, "مطار الملك فهد الدولي"), "center": (50.2083, 26.2794, "وسط الخبر")},
}
NEAR_RADIUS_KM = 6
# places classified from the business name (folded Arabic, lower-case Latin); a name decides, never a guess
NEAR_KINDS = {
    "school": r"مدرس|مدارس|school|academy|اكاديمي",
    "hospital": r"مستشفي|مستشفى|hospital|مدينه .*الطبيه|medical city",
}
NEAR_EXCLUDE = r"قياده|سياقه|driving|تدريب|training|معهد|بيطري|veterinary|عياده|clinic|مستلزمات|supplies|نقل|transport|قرطاسي"
SCHOOL_PRIVATE = r"اهلي|عالمي|international|private|خاص"
SCHOOL_PUBLIC = r"ابتدائي|متوسط|ثانوي|elementary|primary|secondary|intermediate|high school|تحفيظ"



def corridor_subs(tx, q, objective=None):
    """The activity whose streets a request asks for. A street is lined by the trade itself, so the business type the
    words name («ورش سيارات» → car workshops, «حلاق» → barbers) comes first; the commercial resolver, which can read the
    same words as a product to buy («ورش» → workshop equipment, «حلاق» → salon supplies), answers only when no type is
    named, when the words ask for supplies («مستلزمات حلاقين»), or when a seller asks for his buyers. The same reading
    (taxonomy_search.Taxonomy.subs_in, activity_groups.group_named) drives understand() for every other tool; this one
    only keeps a group as one activity, because corridors are built per group. Measured by test_query_eval.py."""
    if objective != 'marketing':
        named, score = tx.subs_in(q)
        named = taxonomy_search.without_served(q, [sub for sub in named if sub in tx.subs])   # «مورد قهوة» is not cafés
        words = taxonomy_search.norm(q).split()
        # «أغراض مواليد», «أطفال»: the group, unless one trade is named precisely (activity_groups.group_named)
        group = tx.group_in(q, named, score)
        if group:
            return [group]
        # «مستلزمات حلاقين» asks for supplies: the trade word names who they are for, so the resolver decides
        if named and not set(words) & taxonomy_search.SUPPLY_CUES:
            return named
    return list(tx.understand(q, 'marketing' if objective == 'marketing' else 'purchase')['targets'])


def street_density_district_sql(columns):
    """District filter on the street table: a corridor matches every district it crosses (districts_ar), an older
    file only its own district_ar."""
    if 'districts_ar' in columns:
        return "list_has_any(string_split(coalesce(nullif(districts_ar, ''), district_ar), '|'), ?::varchar[])"
    return 'district_ar in (select unnest(?::varchar[]))'

class MarketAnalytics:
    def __init__(self, directory_tiles, street_density=None):
        self.tiles = directory_tiles
        # One query at a time on the shared database: run side by side (a cursor per thread, #739) they overran its
        # 512MB memory limit (OutOfMemoryException) under a handful of visitors. Each thread keeps its own cursor so
        # a result set is never swapped under another thread's fetch; repeated questions are answered from
        # _remembered without queueing.
        self._root = directory_tiles.db
        self._local = threading.local()
        self.lock = directory_tiles.lock
        self._results = collections.OrderedDict()
        self._results_lock = threading.Lock()
        # Aggregates read the same (canonical) directory copy the tiles serve, never the mounted file directly.
        self.data = getattr(directory_tiles, "path", None) or DATA
        self.street_density = street_density or STREET_DENSITY
        self._taxonomy = None
        self._taxonomy_lock = threading.Lock()
        self._specialty_column = None
        self._specialty_column_lock = threading.Lock()

    @property
    def db(self):
        cursor = getattr(self._local, "cursor", None)
        if cursor is None:
            cursor = self._local.cursor = self._root.cursor()
        return cursor

    def _remembered(self, name, body, compute):
        """The release is read-only while the service runs, so the same question gets the same answer: the city-wide
        aggregates every visitor asks on opening the map are computed once. Copies in and out, so a caller that
        enriches the answer never edits the stored one."""
        try:
            key = (name, json.dumps(body, sort_keys=True, ensure_ascii=False))
        except (TypeError, ValueError):
            return compute()
        with self._results_lock:
            if key in self._results:
                self._results.move_to_end(key)
                return copy.deepcopy(self._results[key])
        result = compute()
        with self._results_lock:
            self._results[key] = copy.deepcopy(result)
            while len(self._results) > RESULT_CACHE_SIZE:
                self._results.popitem(last=False)
        return result

    def _tx(self):
        if self._taxonomy is None:
            with self._taxonomy_lock:
                if self._taxonomy is None:
                    self._taxonomy = taxonomy_search.get()
        return self._taxonomy

    def _has_specialty_column(self):
        if self._specialty_column is None:
            with self._specialty_column_lock:
                if self._specialty_column is None:
                    with self.lock:
                        columns = {row[0] for row in self.db.execute("describe select * from read_parquet(?)", [self.data]).fetchall()}
                    self._specialty_column = "specialty_ids" in columns
        return self._specialty_column

    @staticmethod
    def _validate(body):
        city = body.get("city")
        if not isinstance(city, str) or not 1 <= len(city) <= 80:
            raise ValueError("city")
        q = body.get("q")
        if q is not None and (not isinstance(q, str) or len(q) > MAX_TEXT):
            raise ValueError("q")
        main_id = body.get("main_id")
        if main_id is not None and (not isinstance(main_id, str) or not 1 <= len(main_id) <= 40):
            raise ValueError("main_id")
        sub_ids = body.get("sub_ids") or []
        if not isinstance(sub_ids, list) or len(sub_ids) > MAX_SUB_IDS or not all(
            isinstance(item, str) and 1 <= len(item) <= 80 for item in sub_ids
        ):
            raise ValueError("sub_ids")
        districts = body.get("districts") or []
        if not isinstance(districts, list) or len(districts) > MAX_DISTRICTS or not all(
            isinstance(item, str) and 1 <= len(item) <= 80 for item in districts
        ):
            raise ValueError("districts")
        specialty_ids = body.get("specialty_ids") or []
        if not isinstance(specialty_ids, list) or len(specialty_ids) > MAX_SPECIALTY_IDS or not all(
            isinstance(item, str) and 1 <= len(item) <= 80 for item in specialty_ids
        ):
            raise ValueError("specialty_ids")
        objective = body.get("objective", "purchase")
        if objective not in ("purchase", "marketing"):
            raise ValueError("objective")
        bounds = body.get("bounds")
        if bounds is not None:
            if not isinstance(bounds, list) or len(bounds) != 4 or not all(type(value) in (int, float) and math.isfinite(value) for value in bounds):
                raise ValueError("bounds")
            west, south, east, north = bounds
            if not (-180 <= west <= east <= 180 and -85.1 <= south <= north <= 85.1):
                raise ValueError("bounds")
            bounds = [float(west), float(south), float(east), float(north)]
        return city, q, main_id, list(dict.fromkeys(sub_ids)), list(dict.fromkeys(districts)), objective, bounds

    def _resolve_subs(self, q, main_id, sub_ids, objective):
        tx = self._tx()
        if tx is None:
            if q or main_id:
                return [], True
            return sub_ids, False
        if sub_ids and not all(sid in tx.subs for sid in sub_ids):
            raise ValueError("unknown sub_id")
        resolved = None
        if q:
            # Use the same commercial-direction resolver as directory search.
            # A marketing query for «شركات مقاولات» must count contractors,
            # not generic city activity nor suppliers of construction inputs.
            # This also makes aggregate map totals agree with the entity pins.
            if hasattr(tx, "understand"):
                understood = tx.understand(q, objective)
                query_subs = list(understood.get("targets") or [])
            else:
                # Minimal legacy taxonomy fixtures expose only lexical lookup.
                # Production taxonomy always has `understand`; this fallback
                # preserves a safe, narrow answer for older read-only assets.
                specialty_ids, _ = tx.spec_hits(q)
                query_subs = list(dict.fromkeys(tx.specs[sid]["sub_id"] for sid in specialty_ids))
                if not query_subs:
                    query_subs = tx.subs_in(q)[0]
            if not query_subs:
                return [], True
            resolved = set(query_subs)
        if main_id:
            if main_id not in {item.get("main_id") for item in tx.subs.values()}:
                return [], True
            main_subs = {sid for sid, item in tx.subs.items() if item.get("main_id") == main_id}
            resolved = main_subs if resolved is None else resolved & main_subs
        if sub_ids:
            requested_subs = set(sub_ids)
            resolved = requested_subs if resolved is None else resolved & requested_subs
        resolved = sorted(resolved) if resolved is not None else []
        if resolved and not all(sid in tx.subs for sid in resolved):
            raise ValueError("unknown sub_id")
        return resolved, bool((main_id or q) and not resolved)

    def _where(self, body):
        city, q, main_id, sub_ids, districts, objective, bounds = self._validate(body)
        subs, empty_match = self._resolve_subs(q, main_id, sub_ids, objective)
        specialty_ids = list(dict.fromkeys(body.get("specialty_ids") or []))
        specialty_available = not specialty_ids or self._has_specialty_column()
        clauses = [
            self.tiles.search_sql,
            "coalesce(nullif(p.name_ar, ''), p.name_en) is not null",
            "p.city_en = ?",
        ]
        params = [self.data, city]
        if empty_match:
            clauses.append("false")
        elif subs:
            by_sub = ("exists (select 1 from read_parquet(?) c where c.poi_key = p.poi_key "
                      "and c.confidence in ('high', 'medium') and c.sub_id in (select unnest(?::varchar[])))")
            params.extend([taxonomy_path(), subs])
            # a picked main activity also counts the businesses whose main is known but not their sub; a typed or
            # sub activity never does, because their sub is not known (classification_layer)
            main_only = classification_layer.main_only() if main_id and not q and not sub_ids else None
            if main_only:
                by_sub = (f"({by_sub} or exists (select 1 from read_parquet(?) m "
                          "where m.poi_key = p.poi_key and m.main_id = ?))")
                params.extend([main_only, main_id])
            clauses.append(by_sub)
        if districts:
            clauses.append("p.district_ar in (select unnest(?::varchar[]))")
            params.append(districts)
        if bounds:
            west, south, east, north = bounds
            clauses.append("p.longitude between ? and ? and p.latitude between ? and ?")
            params.extend([west, east, south, north])
        if specialty_ids:
            if not specialty_available:
                # Older directory snapshots cannot answer exact-specialty questions;
                # fail closed rather than show the wider parent subcategory as exact.
                clauses.append("false")
            else:
                clauses.append("list_has_any(string_split(coalesce(p.specialty_ids, ''), '|'), ?::varchar[])")
                params.append(specialty_ids)
        return city, subs, " and ".join(clauses), params, specialty_available, bounds

    def competitors_within(self, body, geometry, centre=None, limit=8):
        """The chosen activity's businesses inside a range (site_card): their count, per km² of the range, and the
        nearest by name. The activity is read exactly as the other figures read it (_where); None without one."""
        import district_metrics
        import site_card
        if not (body.get("q") or body.get("main_id") or body.get("sub_ids")):
            return None
        polygons = site_card.insights.canonical_data._polygons(geometry)
        coords = [p for rings in polygons for ring in rings for p in ring]
        if not coords:
            return None
        west, east = min(p[0] for p in coords), max(p[0] for p in coords)
        south, north = min(p[1] for p in coords), max(p[1] for p in coords)
        _, subs, where, params, _, _ = self._where({**body, "bounds": [west, south, east, north]})
        query = f"""
            select coalesce(nullif(p.name_ar, ''), p.name_en), p.district_ar, p.longitude, p.latitude
            from read_parquet(?) p
            where {where} and coalesce(p.location_precision, 'unknown') = 'point'
            qualify row_number() over (partition by p.poi_key) = 1
        """
        with self.lock:
            rows = self.db.execute(query, params).fetchall()
        n, near = site_card.nearest(rows, geometry, centre, limit)
        area = district_metrics.area_km2(geometry)
        return {"n": n, "area_km2": round(area, 2) if area else None, "per_km2": district_metrics.per_km2(n, area),
                "nearest": near, "understood": self._understood(body, subs)}

    def district_points(self, body, limit=20000):
        """Located directory businesses in the given districts (and activity), for planning a visit route: id, name,
        district, coordinates and whether it is reachable on WhatsApp. Only point-precise locations are returned."""
        if not body.get("districts"):
            raise ValueError("districts")
        _, _, where, params, _, _ = self._where(body)
        query = f"""
            select p.poi_key, coalesce(nullif(p.name_ar, ''), p.name_en), p.district_ar, p.longitude, p.latitude,
                   ({USABLE_WHATSAPP_SQL}) whatsapp
            from read_parquet(?) p
            where {where} and coalesce(p.location_precision, 'unknown') = 'point'
              and p.longitude between -180 and 180 and p.latitude between -90 and 90
            qualify row_number() over (partition by p.poi_key) = 1
            order by p.poi_key limit ?
        """
        with self.lock:
            rows = self.db.execute(query, params + [limit + 1]).fetchall()
        return {
            "ok": True,
            "points": [{"id": key, "name": name, "district_ar": district, "lon": lon, "lat": lat, "whatsapp": bool(whatsapp)}
                       for key, name, district, lon, lat, whatsapp in rows[:limit]],
            "truncated": len(rows) > limit,
        }

    def _understood(self, body, subs):
        """The subcategories a typed activity was read as, so the reader sees what is counted («مغسلة» -> laundries)
        and can retype it when the reading is wrong; None for a main activity picked from the list."""
        tx = self._tx()
        if not body.get("q") or not subs or tx is None:
            return None
        labels = list(dict.fromkeys(tx.subs[sub]["sub_ar"] for sub in subs if sub in tx.subs))
        return {"labels": labels[:4], "more": max(0, len(labels) - 4)}

    def district_counts(self, body):
        return self._remembered('district_counts', body, lambda: self._district_counts(body))

    def _district_counts(self, body):
        city, subs, where, params, specialty_available, bounds = self._where(body)
        query = f"""
            select p.district_ar, count(distinct p.poi_key) n,
                   count(distinct p.poi_key) filter (where {USABLE_WHATSAPP_SQL}) n_whatsapp,
                   count(distinct p.poi_key) filter (where coalesce(p.is_wholesale, false)) n_wholesale
            from read_parquet(?) p
            where {where} and p.district_reliable is true
              and length(trim(coalesce(p.district_ar, ''))) > 0
            group by p.district_ar order by n desc, p.district_ar
        """
        with self.lock:
            rows = self.db.execute(query, params).fetchall()
            total = self.db.execute(
                f"select count(distinct p.poi_key) from read_parquet(?) p where {where}", params
            ).fetchone()[0]
        return {
            "ok": True,
            "city": city,
            "districts": [
                {"district_ar": name, "n": n, "n_whatsapp": whatsapp, "n_wholesale": wholesale}
                for name, n, whatsapp, wholesale in rows
            ],
            "total": total,
            "understood": self._understood(body, subs),
            "specialty_available": specialty_available,
            "scope": {"bounds": bounds} if bounds else {},
            "basis": MARKET_BASIS,
        }

    def _columns(self):
        if getattr(self, "_column_names", None) is None:
            with self.lock:
                self._column_names = {row[0] for row in self.db.execute("describe select * from read_parquet(?)", [self.data]).fetchall()}
        return self._column_names

    def _brand_sql(self):
        return brand_sql(self._columns())

    _group_chains = staticmethod(group_chains)

    def _chain_rows(self, where, params):
        with self.lock:
            return self.db.execute(f"select distinct {self._brand_sql()} from read_parquet(?) p where {where}", params).fetchall()

    def brands(self, body, population=None, history=None):
        return self._remembered('brands', body, lambda: self._brands(body, population, history))

    def _brands(self, body, population=None, history=None):
        """Chains of an activity in a city (see _group_chains): a brand counts as a chain from `min_branches` locations
        (default 3). Returns the chains ranked by locations, each with the districts it covers and its whole-city
        branches then and now when the directory history has an older snapshot; how much of the activity chains hold;
        and, with `population`, the populated districts none of the five largest chains has reached."""
        min_branches = body.get("min_branches", 3)
        if not isinstance(min_branches, int) or isinstance(min_branches, bool) or not 2 <= min_branches <= 50:
            raise ValueError("min_branches")
        limit = body.get("limit", 30)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
            raise ValueError("limit")
        city, subs, where, params, specialty_available, bounds = self._where(body)
        rows = self._chain_rows(where, params)
        total = len({row[0] for row in rows})
        chains = sorted((group for group in self._group_chains(rows).values() if len(group["pois"]) >= min_branches),
                        key=lambda group: (-len(group["pois"]), group["brand"]))
        in_chains = sum(len(group["pois"]) for group in chains)
        result = {
            "ok": True,
            "city": city,
            "min_branches": min_branches,
            "total": total,
            "chains": len(chains),
            "in_chains": in_chains,
            "understood": self._understood(body, subs),
            "brands": [
                {"brand": group["brand"], "keys": [key for key, _ in group["keys"].most_common(10)],
                 "branches": len(group["pois"]), "districts": len(group["districts"]),
                 "share_pct": round(100 * len(group["pois"]) / total, 1) if total else None,
                 "by_district": [{"district_ar": name, "n": n} for name, n in sorted(group["districts"].items(), key=lambda item: (-item[1], item[0]))[:80]],
                 "growth": chain_growth(history, city, group["keys"])}
                for group in chains[:limit]
            ],
            "specialty_available": specialty_available,
            "scope": {"bounds": bounds} if bounds else {},
            "basis": BRANDS_BASIS,
        }
        if population is not None:
            top = chains[:5]
            reached = set().union(*(group["districts"] for group in top)) if top else set()
            present = Counter(district for _, district, _, _, _ in {row[0]: row for row in rows}.values() if district)
            result["uncovered"] = [
                {"district_ar": name, "population": round(row["population"]), "businesses": present.get(name, 0)}
                for name, row in sorted(population.items(), key=lambda item: -(item[1].get("population") or 0))
                if (row.get("population") or 0) >= UNCOVERED_MIN_POPULATION and name not in reached
            ][:20] if top else []
            result["uncovered_by"] = [group["brand"] for group in top]
        return result

    def brand_profile(self, body):
        """One brand across the whole city, every activity: its branches per district and the main activities they
        are classified under. `keys` are the brand keys a /brands answer gave for it."""
        city = body.get("city")
        keys = body.get("keys")
        if not isinstance(city, str) or not 1 <= len(city) <= 80:
            raise ValueError("city")
        if not isinstance(keys, list) or not 1 <= len(keys) <= 10 or not all(isinstance(key, str) and 2 <= len(key) <= 120 for key in keys):
            raise ValueError("keys")
        query = f"""
            with b as (select {self._brand_sql()} from read_parquet(?) p where {self.tiles.search_sql} and p.city_en = ?)
            select distinct poi_key, district_ar from b where brand_key in (select unnest(?::varchar[]))
        """
        with self.lock:
            branches = self.db.execute(query, [self.data, city, keys]).fetchall()
            pois = [poi for poi, _ in branches]
            subs = self.db.execute(
                "select sub_id, count(distinct poi_key) from read_parquet(?) where confidence in ('high', 'medium') "
                "and poi_key in (select unnest(?::varchar[])) group by sub_id", [taxonomy_path(), pois]).fetchall() if pois else []
        mains = Counter()
        known = getattr(self._tx(), "subs", {}) if subs else {}
        for sub_id, n in subs:
            main = (known.get(sub_id) or {}).get("main_ar")
            if main:
                mains[main] += n
        districts = Counter(district for _, district in branches if district)
        # a chain is one business: it takes the activity most of its classified branches carry, and the branches the
        # directory files elsewhere are counted, then named apart so the directory can be corrected
        main = mains.most_common(1)[0] if mains else None
        return {
            "ok": True,
            "city": city,
            "branches": len(set(pois)),
            "districts": len(districts),
            "by_district": [{"district_ar": name, "n": n} for name, n in sorted(districts.items(), key=lambda item: (-item[1], item[0]))],
            "activity": {"main_ar": main[0], "classified": sum(mains.values()), "agree": main[1]} if main else None,
            "activities": [{"main_ar": name, "n": n} for name, n in mains.most_common(8)],
            "basis": BRANDS_BASIS,
        }

    def chain_snapshot(self):
        """Every brand with at least 3 branches in each city, over the whole directory, for the chain history."""
        query = f"""
            with b as (select p.city_en, {self._brand_sql()} from read_parquet(?) p where {self.tiles.search_sql})
            select city_en, brand_key, count(distinct poi_key) n from b where length(brand_key) >= 2
            group by city_en, brand_key having count(distinct poi_key) >= 3
        """
        with self.lock:
            rows = self.db.execute(query, [self.data]).fetchall()
        cities = {}
        for city, key, n in rows:
            cities.setdefault(city, {})[key] = n
        return cities

    def places_near(self, body):
        """The nearest schools (public and private apart, by name) and hospitals to a point within NEAR_RADIUS_KM, with
        straight-line distance, plus the city's airport and centre. Classification is by the business name, so a
        school whose name says neither is listed as a school of unstated type."""
        city, lon, lat = body.get("city"), body.get("lon"), body.get("lat")
        if not isinstance(city, str) or not 1 <= len(city) <= 80:
            raise ValueError("city")
        if not all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in (lon, lat)) or not (34 <= lon <= 56 and 16 <= lat <= 33):
            raise ValueError("point")
        box = NEAR_RADIUS_KM / 111.0
        folded = "translate(lower(concat_ws(' ', p.name_ar, p.name_en)), 'أإآةىؤئ', 'اااهيوي')"
        kind = " ".join(f"when regexp_matches(n, '{pattern}') then '{name}'" for name, pattern in NEAR_KINDS.items())
        query = f"""
            with c as (
                select p.poi_key, coalesce(nullif(p.name_ar, ''), p.name_en) place_name, p.district_ar, p.longitude place_lon, p.latitude place_lat, {folded} n
                from read_parquet(?) p
                where {self.tiles.search_sql} and p.city_en = ? and p.longitude between ? and ? and p.latitude between ? and ?
                  and coalesce(p.location_precision, 'point') = 'point'
            ),
            k as (
                select *, case {kind} end kind,
                       2 * 6371 * asin(sqrt(pow(sin(radians(place_lat - ?) / 2), 2) + cos(radians(?)) * cos(radians(place_lat)) * pow(sin(radians(place_lon - ?) / 2), 2))) km
                from c where not regexp_matches(n, '{NEAR_EXCLUDE}')
            )
            select kind, case when kind = 'school' and regexp_matches(n, '{SCHOOL_PRIVATE}') then 'private'
                              when kind = 'school' and regexp_matches(n, '{SCHOOL_PUBLIC}') then 'public' end school_type,
                   place_name, district_ar, place_lon, place_lat, km
            from k where kind is not null and km <= ? order by km
        """
        with self.lock:
            rows = self.db.execute(query, [self.data, city, lon - box, lon + box, lat - box, lat + box, lat, lat, lon, NEAR_RADIUS_KM]).fetchall()
        groups = {"school_public": [], "school_private": [], "school": [], "hospital": []}
        for kind, school_type, name, district, place_lon, place_lat, km in rows:
            key = f"school_{school_type}" if kind == "school" and school_type else kind
            if len(groups[key]) < 3:
                groups[key].append({"name": name, "district_ar": district, "lon": place_lon, "lat": place_lat, "km": round(km, 1)})
        anchors = {name: {"label": label, "lon": a_lon, "lat": a_lat, "km": round(haversine_km(lon, lat, a_lon, a_lat), 1)}
                   for name, (a_lon, a_lat, label) in CITY_ANCHORS.get(city, {}).items()}
        return {"ok": True, "city": city, "radius_km": NEAR_RADIUS_KM, "places": groups, "anchors": anchors, "basis": NEAR_BASIS}

    def market_gaps(self, body, population):
        return self._remembered('market_gaps', body, lambda: self._market_gaps(body, population))

    def _market_gaps(self, body, population):
        """Districts where an activity has fewer directory businesses than its residents would carry at the
        city's own rate. `population` maps a canonical district name to {"population", "male", "female"}.

        The city rate is residents per business over the districts that have both a population estimate
        and the activity; a district's expected count is its population at that rate, and the shortfall is
        expected minus present. Directory coverage is incomplete, so a shortfall marks where to look, not
        proof of unmet demand."""
        min_population = body.get("min_population", 5000)
        if not isinstance(min_population, (int, float)) or isinstance(min_population, bool) or not 0 <= min_population <= 1_000_000:
            raise ValueError("min_population")
        limit = body.get("limit", 30)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
            raise ValueError("limit")
        counted = self.district_counts(body)
        counts = {row["district_ar"]: row["n"] for row in counted["districts"]}
        city = body.get("city")
        known = {name: row for name, row in population.items() if row.get("population")}
        covered = [name for name in known if counts.get(name)]
        city_population = sum(known[name]["population"] for name in covered)
        city_businesses = sum(counts[name] for name in covered)
        if not city_businesses or not city_population:
            return {"ok": True, "city": city, "residents_per_business": None, "districts": [], "understood": counted["understood"], "basis": MARKET_GAPS_BASIS,
                    "message": "لا توجد منشآت مطابقة في أحياء معروفة السكان لحساب معدل المدينة."}
        rate = city_population / city_businesses
        # Does this activity's count actually track population here? Measured over the covered districts (both a
        # population figure and directory businesses) from the numbers already in hand. When it does not —
        # wholesale, industrial, B2B, destinations — the city rate is meaningless and a shortfall under it would
        # be an invented number, so no expected count and no shortfall are emitted.
        fit_r, slope, pop_variance = population_fit([known[name]["population"] for name in covered],
                                                    [counts[name] for name in covered])
        covered_districts = len(covered)
        model_fits = bool(covered_districts >= GAP_MODEL_MIN_DISTRICTS and fit_r is not None
                          and fit_r >= GAP_MODEL_MIN_R and slope is not None and slope > 0 and pop_variance > 0)
        # the signed Pearson r, so a flat or negative (non-population) relationship stays visible in the number
        fit = round(fit_r, 2) if fit_r is not None else None
        rows = []
        for name, row in known.items():
            people = row["population"]
            if people < min_population:
                continue
            present = counts.get(name, 0)
            expected = people / rate
            male, female = row.get("male"), row.get("female")
            male_pct = round(100 * male / (male + female), 1) if male and female else None
            rows.append({
                "district_ar": name,
                "population": round(people),
                "businesses": present,
                "expected_businesses": round(expected, 1) if model_fits else None,
                "shortfall": round(expected - present, 1) if model_fits else None,
                "residents_per_business": round(people / present) if present else None,
                "male_pct": male_pct,
                "population_method": population_method(row.get("source")),
                "caveat": gap_caveat(name, male_pct),
            })
        base = {
            "ok": True,
            "city": city,
            "population_model_fits": model_fits,
            "fit": fit,
            "covered_districts": covered_districts,
            "districts_with_population": len(known),
            "understood": counted["understood"],
            "basis": market_gaps_basis(fit, covered_districts),
        }
        if not model_fits:
            # the count is not driven by population here: no city rate, no expected, no shortfall. The districts
            # are listed by their real directory counts only, the most-served first. Two different failures are
            # told apart so the rep knows whether to trust the verdict: with fewer than the floor of covered
            # districts we simply cannot judge the relationship (a thin directory, often just few listings of
            # the activity) — that is NOT a finding that the activity ignores population; with enough districts
            # but a flat-or-negative relationship it genuinely does not track population.
            reason = "too_few_districts" if covered_districts < GAP_MODEL_MIN_DISTRICTS else "weak_relationship"
            rows.sort(key=lambda row: (-row["businesses"], row["district_ar"]))
            return {**base, "residents_per_business": None, "districts": rows[:limit],
                    "population_model_reason": reason, "message": GAP_UNAVAILABLE_MESSAGES[reason]}
        # ordinary residential districts first, each group largest shortfall first
        rows.sort(key=lambda row: (row["caveat"] is not None, -row["shortfall"], row["district_ar"]))
        return {**base, "residents_per_business": round(rate), "districts": rows[:limit]}

    def district_insights(self, body):
        """Aggregate confidently classified activities for selected districts.

        Missing categories mean no matching directory records, not proof that a trade
        does not exist in the real district.
        """
        city, q, main_id, sub_ids, districts, _, _ = self._validate(body)
        if q or main_id or sub_ids or not districts:
            raise ValueError("district_insights requires districts only")
        tx = self._tx()
        if tx is None:
            return {"ok": False, "city": city, "districts": [], "basis": "التصنيف غير متاح"}

        # Build a parameterized taxonomy relation from the same approved labels used
        # by search. Counts are distinct POIs per activity to avoid double counting
        # when one listing has multiple specialty rows.
        subs = [
            (sid, item.get("main_id") or "", item.get("main_ar") or "غير مصنف", item.get("sub_ar") or "")
            for sid, item in tx.subs.items()
            if not sid.startswith(("unc.", "noncom."))
        ]
        values_sql = ",".join("(?, ?, ?, ?)" for _ in subs)
        taxonomy_params = [value for row in subs for value in row]
        taxonomy_cte = f"taxonomy(sub_id, main_id, main_ar, sub_ar) as (values {values_sql})"
        base = (
            "from read_parquet(?) p where " + self.tiles.search_sql +
            " and p.city_en = ? and p.district_reliable is true "
            "and length(trim(coalesce(p.district_ar, ''))) > 0 "
            "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null"
        )
        where_params = [self.data, city]
        with self.lock:
            district_rows = self.db.execute(
                f"select p.district_ar, count(distinct p.poi_key) n {base} "
                "and p.district_ar in (select unnest(?::varchar[])) group by 1",
                where_params + [districts],
            ).fetchall()
            classified_rows = self.db.execute(
                "select p.district_ar, count(distinct p.poi_key) from read_parquet(?) p "
                "join read_parquet(?) c on c.poi_key = p.poi_key "
                f"where {self.tiles.search_sql} and p.city_en = ? and p.district_reliable is true "
                "and c.confidence in ('high','medium') and p.district_ar in (select unnest(?::varchar[])) "
                "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null group by 1",
                [self.data, taxonomy_path(), city, districts],
            ).fetchall()
            # City coverage defines which main activities can be called missing.
            city_activity_rows = self.db.execute(
                f"with {taxonomy_cte} select t.main_id, any_value(t.main_ar), count(distinct p.poi_key) n "
                "from read_parquet(?) p join read_parquet(?) c on c.poi_key = p.poi_key "
                "join taxonomy t on t.sub_id = c.sub_id "
                f"where {self.tiles.search_sql} and p.city_en = ? and c.confidence in ('high','medium') "
                "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null "
                "group by t.main_id",
                taxonomy_params + [self.data, taxonomy_path(), city],
            ).fetchall()
            main_rows = self.db.execute(
                f"with {taxonomy_cte} select p.district_ar, t.main_id, any_value(t.main_ar), count(distinct p.poi_key) n "
                "from read_parquet(?) p join read_parquet(?) c on c.poi_key = p.poi_key "
                "join taxonomy t on t.sub_id = c.sub_id "
                f"where {self.tiles.search_sql} and p.city_en = ? and p.district_reliable is true "
                "and c.confidence in ('high','medium') and p.district_ar in (select unnest(?::varchar[])) "
                "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null "
                "group by p.district_ar, t.main_id",
                taxonomy_params + [self.data, taxonomy_path(), city, districts],
            ).fetchall()
            sub_rows = self.db.execute(
                f"with {taxonomy_cte} select p.district_ar, t.main_id, t.sub_id, any_value(t.sub_ar), count(distinct p.poi_key) n "
                "from read_parquet(?) p join read_parquet(?) c on c.poi_key = p.poi_key "
                "join taxonomy t on t.sub_id = c.sub_id "
                f"where {self.tiles.search_sql} and p.city_en = ? and p.district_reliable is true "
                "and c.confidence in ('high','medium') and p.district_ar in (select unnest(?::varchar[])) "
                "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null "
                "group by p.district_ar, t.main_id, t.sub_id",
                taxonomy_params + [self.data, taxonomy_path(), city, districts],
            ).fetchall()

        city_mains = {mid: {"main_id": mid, "main_ar": label, "n": n} for mid, label, n in city_activity_rows}
        totals = {name: count for name, count in district_rows}
        classified_totals = {name: count for name, count in classified_rows}
        by_district = {name: [] for name in districts}
        for name, mid, label, count in main_rows:
            by_district.setdefault(name, []).append({"main_id": mid, "main_ar": label, "n": count})
        subs_by_district = {}
        for name, mid, sid, label, count in sub_rows:
            subs_by_district.setdefault((name, mid), []).append({"sub_id": sid, "sub_ar": label, "n": count})

        results = []
        for name in districts:
            activities = sorted(by_district.get(name, []), key=lambda item: (-item["n"], item["main_ar"]))
            for activity in activities:
                activity["top_subactivities"] = sorted(
                    subs_by_district.get((name, activity["main_id"]), []),
                    key=lambda item: (-item["n"], item["sub_ar"]),
                )[:3]
            ranked_present = sorted(activities, key=lambda item: (item["n"], item["main_ar"]))
            present_ids = {item["main_id"] for item in activities}
            absent = sorted(
                (item["main_ar"] for mid, item in city_mains.items() if mid not in present_ids),
            )
            total = totals.get(name, 0)
            classified = classified_totals.get(name, 0)
            results.append({
                "district_ar": name,
                "total": total,
                "classified": classified,
                "classification_pct": round(classified * 100 / total) if total else 0,
                "dominant_activity": activities[0] if activities else None,
                "least_activity": ranked_present[0] if ranked_present else None,
                "activities": activities,
                "absent_from_directory": absent,
            })
        return {
            "ok": True,
            "city": city,
            "districts": results,
            "basis": "سجلات الدليل ذات إسناد حي موثوق وتصنيف نشاط عالي أو متوسط الثقة. الأنشطة الغائبة تعني عدم ظهور سجل مصنف لها في هذا الحي، ولا تثبت غيابها فعلياً.",
        }

    def market_summary(self, body):
        return self._remembered('market_summary', body, lambda: self._market_summary(body))

    def _market_summary(self, body):
        city, subs, where, params, specialty_available, bounds = self._where(body)
        aggregate = f"""
            select count(distinct p.poi_key) total,
                   count(distinct p.poi_key) filter (where {USABLE_WHATSAPP_SQL}) n_whatsapp,
                   count(distinct p.poi_key) filter (where coalesce(p.is_wholesale, false)) n_wholesale,
                   count(distinct p.poi_key) filter (where not (
                       coalesce(
                           coalesce(p.location_precision, 'unknown') = 'point'
                           and p.longitude between -180 and 180
                           and p.latitude between -85.05112878 and 85.05112878,
                           false
                       )
                   )) n_approx,
                   count(distinct p.poi_key) filter (where length(trim(coalesce(p.commercial_license, ''))) > 0) n_cr,
                   count(distinct p.district_ar) filter (
                       where p.district_reliable is true and length(trim(coalesce(p.district_ar, ''))) > 0
                   ) districts_count
            from read_parquet(?) p where {where}
        """
        specialty_sql = f"""
            select count(distinct c.sub_id)
            from read_parquet(?) p join read_parquet(?) c using (poi_key)
            where {where} and c.confidence in ('high', 'medium')
        """
        district_sql = f"""
            select p.district_ar, count(distinct p.poi_key) n
            from read_parquet(?) p where {where} and p.district_reliable is true
              and length(trim(coalesce(p.district_ar, ''))) > 0
            group by p.district_ar order by n desc, p.district_ar limit 5
        """
        tx = self._tx()
        with self.lock:
            row = self.db.execute(aggregate, params).fetchone()
            n_specialties = self.db.execute(specialty_sql, [self.data, taxonomy_path()] + params[1:]).fetchone()[0]
            top_districts = self.db.execute(district_sql, params).fetchall()
            activity_rows = []
            if tx is not None:
                # Use the same approved taxonomy as discovery. Counts are distinct
                # businesses per main activity (a business can belong to multiple).
                taxonomy = [
                    (sid, item.get("main_id") or "", item.get("main_ar") or "غير مصنف")
                    for sid, item in tx.subs.items()
                    if not sid.startswith(("unc.", "noncom."))
                ]
                if taxonomy:
                    taxonomy_sql = ",".join("(?, ?, ?)" for _ in taxonomy)
                    taxonomy_params = [value for activity in taxonomy for value in activity]
                    activity_rows = self.db.execute(
                        f"with taxonomy(sub_id, main_id, main_ar) as (values {taxonomy_sql}) "
                        "select t.main_id, any_value(t.main_ar), count(distinct p.poi_key) n "
                        "from read_parquet(?) p join read_parquet(?) c on c.poi_key = p.poi_key "
                        "join taxonomy t on t.sub_id = c.sub_id "
                        f"where {where} and c.confidence in ('high', 'medium') "
                        "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null "
                        "group by t.main_id order by n desc, t.main_id",
                        taxonomy_params + [self.data, taxonomy_path()] + params[1:],
                    ).fetchall()
        # Street lines are aggregated only to subcategory in the current data asset.
        # Do not show one as an exact specialty result.
        # The street asset has no portable spatial index for arbitrary viewport
        # clipping. Do not label a city-wide street as the viewport's strongest
        # signal until it can be filtered from the same spatial cohort.
        dense = None if body.get("specialty_ids") or bounds else self._densest_street(city, subs, body.get("main_id"), body.get("districts") or [])
        total, n_whatsapp, n_wholesale, n_approx, n_cr, districts_count = row
        return {
            "ok": True,
            "summary": {
                "total": total,
                "districts_count": districts_count,
                "top_districts": [{"district_ar": name, "n": count} for name, count in top_districts],
                "densest_street": dense,
                "n_wholesale": n_wholesale,
                "n_whatsapp": n_whatsapp,
                "n_specialties": n_specialties,
                "main_activities": [
                    {"main_id": main_id, "main_ar": label, "n": count}
                    for main_id, label, count in activity_rows
                ],
                "main_activities_basis": (
                    "سجلات دليل ذات تصنيف نشاط عالي أو متوسط الثقة؛ قد يظهر السجل ضمن أكثر من نشاط."
                ),
                "n_approx": n_approx,
                "n_cr": n_cr,
                "specialty_available": specialty_available,
                "scope": {"bounds": bounds} if bounds else {},
                "basis": MARKET_BASIS,
            },
        }

    def _densest_street(self, city, subs, main_id, districts):
        if not os.path.isfile(self.street_density):
            return None
        clauses = ["city_en = ?"]
        params = [self.street_density, city]
        if subs:
            clauses.append("sub_id in (select unnest(?::varchar[]))")
            params.append(subs)
        elif main_id:
            clauses.append("main_id = ?")
            params.append(main_id)
        # the connection is shared by every request thread: a query outside the lock swaps the result set under
        # another thread's fetch («No open result set») and fails both
        with self.lock:
            if districts:
                # a corridor built on the road network matches every district it crosses (build_trade_corridors.py)
                columns = {c[0] for c in self.db.execute("describe select * from read_parquet(?)", [self.street_density]).fetchall()}
                clauses.append(street_density_district_sql(columns))
                params.append(districts)
            row = self.db.execute(
                "select street_ar, district_ar, n, length_m, per_100m, sub_ar "
                f"from read_parquet(?) where {' and '.join(clauses)} order by n desc, per_100m desc limit 1",
                params,
            ).fetchone()
        if not row:
            return None
        street, district, count, length_m, per_100m, sub = row
        return {
            "street_ar": street,
            "district_ar": district,
            "n": count,
            "length_m": length_m,
            "per_100m": per_100m,
            "sub_ar": sub,
        }

    def who_buys(self, body):
        city, q, main_id, sub_ids, _, _, _ = self._validate(body)
        tx = self._tx()
        if tx is None:
            raise RuntimeError("taxonomy unavailable")
        if main_id:
            if main_id not in {item.get("main_id") for item in tx.subs.values()}:
                sub_ids = []
            else:
                main_subs = {sid for sid, item in tx.subs.items() if item.get("main_id") == main_id}
                sub_ids = list(main_subs) if not sub_ids else [sid for sid in sub_ids if sid in main_subs]
        elif q and not sub_ids:
            # This endpoint must not send free text to an external model.
            specialty_ids, _ = tx.spec_hits(q)
            sub_ids = list(dict.fromkeys(tx.specs[sid]["sub_id"] for sid in specialty_ids))
            if not sub_ids:
                sub_ids = tx.subs_in(q)[0]
        elif sub_ids and not all(sid in tx.subs for sid in sub_ids):
            raise ValueError("unknown sub_id")
        if not sub_ids:
            return {
                "ok": True,
                "buyers": [],
                "subject": {"sub_ids": [], "label_ar": "لم يتضح النشاط"},
                "basis": BUYER_BASIS,
            }

        subject_sub_ids = set(sub_ids)
        families = {
            family
            for family, sellers in tx.rel.get("sells", {}).items()
            if any(sub in subject_sub_ids for sub, _ in sellers)
        }
        weights = {}
        for family in families:
            for sub, weight in tx.rel.get("buys", {}).get(family, []):
                if sub not in sub_ids and sub in tx.subs and tx._sub_ok(sub):
                    weights[sub] = max(weights.get(sub, 0), weight)
        ranked = sorted(weights, key=lambda sub: (-weights[sub], tx.subs[sub]["sub_ar"]))[:30]
        counts = {}
        if ranked:
            with self.lock:
                rows = self.db.execute(
                    """
                    select c.sub_id, count(distinct p.poi_key) n,
                           count(distinct p.poi_key) filter (where {USABLE_WHATSAPP_SQL}) n_whatsapp
                    from read_parquet(?) p join read_parquet(?) c using (poi_key)
                    where p.city_en = ? and """ + self.tiles.search_sql + """
                      and coalesce(nullif(p.name_ar, ''), p.name_en) is not null
                      and c.confidence in ('high', 'medium')
                      and c.sub_id in (select unnest(?::varchar[]))
                    group by c.sub_id
                    """,
                    [self.data, taxonomy_path(), city, ranked],
                ).fetchall()
            counts = {sub: (n, whatsapp) for sub, n, whatsapp in rows}
        buyers = []
        for sub in ranked:
            n, whatsapp = counts.get(sub, (0, 0))
            if n <= 0:
                continue
            entry = tx.subs[sub]
            buyers.append(
                {
                    "sub_id": sub,
                    "sub_ar": entry["sub_ar"],
                    "main_id": entry["main_id"],
                    "main_ar": entry["main_ar"],
                    "strength": "core" if weights[sub] >= 2 else "common",
                    "n": n,
                    "n_whatsapp": whatsapp,
                }
            )
        return {
            "ok": True,
            "buyers": buyers,
            "subject": {
                "sub_ids": sub_ids,
                "label_ar": "، ".join(tx.subs[sub]["sub_ar"] for sub in sub_ids[:4]),
            },
            "basis": BUYER_BASIS,
        }
