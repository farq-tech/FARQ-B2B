"""Apply the POI enrichment standard (owner decision 2026-11-02) to the directory, as a new layer beside it.

The standard is two documents the owner supplied: «POI Data Enrichment & Enhancement Rules» and «POI Dataset — Column
Standards & Accepted Values». Every rule is applied, with one change decided by the owner: a value that cannot be
found is left empty, never written as «UNAVAILABLE». The screen shows an empty value as «غير متاح».

What this step guarantees, so the directory is never weaker:
- It reads the directory and writes a new file. No source column is changed or removed; the original value of every
  field it rewrites stays in the directory.
- Every value the standard fills by a default, a category rule, a generation or a transliteration (rather than reading it
  from the record) is listed in `std_inferred` with its rule, so it can be shown as an estimate and never as a fact.
- Every value the standard blanks (a duplicate phone, a website of another business…) is listed in `std_flags` with
  the reason; the value itself is still in the directory.
- A generated e-mail (info@ / care@ from the website domain) is marked `email:generated` and must never be a send target.

It runs on production, inside the service (startup_jobs, FARQ_POI_STANDARD=1), over the published release and the
served classification (docs/production-first.md). The category map is reference/standard_category_map.csv, a copy
of docs/qa/targeting/taxonomy/standard_category_map.csv kept identical by a test.
"""
import argparse
import csv
import json
import math
import os
import re
import sys
import uuid

import name_translation  # English names learned from the directory's own pairs

VERSION = 'poi_standard_v2'
# the directory's working hours as its build writes them (services/data-cleaning/normalize_hours.py, readable form):
# «Sun: 08:30 - 23:30 | Mon: 08:30 - 13:00, 16:00 - 23:30»; any other value is not read
DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
_SPAN = r'\d{2}:\d{2} - \d{2}:\d{2}'
READABLE = re.compile(rf'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat): {_SPAN}(, {_SPAN})*( \| (Sun|Mon|Tue|Wed|Thu|Fri|Sat): {_SPAN}(, {_SPAN})*)*$')
NAMESPACE = uuid.UUID('6f1c7a52-5d3e-4b8e-9f1a-2c4d5e6f7a8b')   # GlobalID = uuid5(NAMESPACE, poi_key): stable across runs

ARABIC = re.compile(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]')
LATIN = re.compile(r'[A-Za-z]')
GENERIC_MAIL = {'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'live.com'}
SOCIAL_HOSTS = ('instagram.com', 'twitter.com', 'x.com', 'facebook.com', 'fb.com', 'tiktok.com', 'snapchat.com', 'linktr.ee',
                'linkfly.to', 'youtube.com', 'wa.me', 'whatsapp.com', 't.me', 'linkedin.com')
SOCIAL_KEEP = ('instagram.com', 'twitter.com', 'x.com', 'facebook.com', 'fb.com', 'tiktok.com', 'snapchat.com')
NOT_WEBSITE = ('fresha.com', 'zid.store', 'salla.sa', 'google.com/maps', 'maps.google', 'goo.gl/maps', 'maps.app.goo.gl',
               'canva.site', 'simdif.com', 'sentry.io', 'bugsnag.com', 'showlogin.action', 'linktr.ee', 'linkfly.to',
               'wa.me', 'bit.ly')
DOMAIN_WORDS_IGNORED = {'www', 'com', 'sa', 'net', 'org', 'co', 'info', 'store', 'shop', 'online', 'app', 'site', 'ksa', 'gov', 'edu'}
NAME_WORDS_IGNORED = {'the', 'and', 'for', 'co', 'company', 'est', 'establishment', 'llc', 'ltd', 'group', 'trading', 'al', 'el'}

# Food places that serve (the standard's «food POI»): restaurants, cafes, fast food, bakeries, juice, sweets, hookah
SERVING = {'food.restaurant', 'food.fast_food', 'food.buffet_popular', 'food.cafe', 'food.juice_icecream', 'food.hookah',
           'food.bakery', 'food.sweets', 'food.food_truck', 'food.cloud_kitchen', 'food.catering'}
CAFE = {'food.cafe', 'food.hookah', 'food.juice_icecream'}
MEDICAL = {'health.hospital', 'health.clinic', 'health.dental', 'health.lab', 'health.radiology', 'health.physio', 'health.vet',
           'beauty.spa_massage', 'beauty.aesthetic_clinic'}
HOSPITAL = {'health.hospital'}
MOSQUE = {'noncom.mosque'}
TICKETED = {'sports.cinema', 'sports.theme_park', 'sports.entertainment_center', 'noncom.museum', 'media.events_entertainment'}
HOTELS = {'hosp.hotel'}
GOV_EDU_FIN = {'noncom.government', 'noncom.embassy', 'edu.school', 'edu.kindergarten', 'edu.university', 'edu.nursery',
               'fin.bank', 'fin.insurance', 'fin.investment', 'fin.financing', 'biz.law'}
LANDMARK = {'noncom.mosque', 'health.hospital', 'edu.school', 'edu.kindergarten', 'fin.bank', 'hosp.hotel', 'noncom.landmark'}
CHAINS = ('starbucks', 'mcdonald', 'kfc', 'burger king', 'subway', 'domino', 'dunkin', 'pizza hut', 'hardee', 'baskin',
          'krispy kreme', 'costa', 'tim hortons', 'papa john', 'herfy', 'cinnabon', 'ستاربكس', 'ماكدونالدز', 'كنتاكي',
          'برجر كنج', 'صب واي', 'دومينوز', 'دانكن', 'بيتزا هت', 'هارديز', 'باسكن', 'كرسبي كريم', 'كوستا', 'تيم هورتنز', 'بابا جونز', 'هرفي')
DRIVE_THRU = ('mcdonald', 'starbucks', 'kfc', 'burger king', 'herfy', 'hardee', 'dunkin', 'pizza hut', 'domino',
              'ماكدونالدز', 'ستاربكس', 'كنتاكي', 'برجر كنج', 'هرفي', 'هارديز', 'دانكن', 'بيتزا هت', 'دومينوز')
CHILDREN_CHAINS = ('mcdonald', 'kfc', 'burger king', 'ماكدونالدز', 'كنتاكي', 'برجر كنج')
CASUAL = ('shawarma', 'shawerma', 'falafel', 'falafil', 'broasted', 'bufia', 'kebda', 'bakery', 'sweet', 'شاورما', 'فلافل',
          'بروستد', 'بوفية', 'كبدة', 'مخبز', 'حلويات')
LOUNGE = ('lounge', 'shisha', 'hookah', 'معسل', 'شيشة', 'أرجيلة', 'ارجيلة')
WAITING = ('mall', 'plaza', 'hospital', 'avenue', 'مول', 'بلازا', 'مستشفى', 'افنيو')
CUISINE = [   # (keywords in the name, cuisine), first match wins; the standard's keyword table
    (('kabsa', 'bukhari', 'mandi', 'hjazi', 'grills', 'shawaya', 'bufia', 'tabakh', 'كبسة', 'بخاري', 'مندي', 'حجازي', 'مشويات', 'شواية', 'مطبخ'), 'Saudi / Arabic'),
    (('shawarma', 'shawerma', 'شاورما'), 'Shawarma'),
    (('falafel', 'falafil', 'فلافل'), 'Falafel / Levantine'),
    (('burger', 'wings', 'برجر', 'برقر', 'وينقز'), 'Burger / American'),
    (('pizza', 'domino', 'بيتزا'), 'Pizza / Italian'),
    (('pasta', 'pastaria', 'باستا'), 'Pizza / Italian'),
    (('sushi', 'ramen', 'wok', 'سوشي', 'رامن'), 'Japanese / Asian'),
    (('korean', 'كوري'), 'Korean / Asian'),
    (('coffee', 'cafe', 'café', 'قهوة', 'كافيه', 'كوفي', 'مقهى'), 'Coffee / Cafe'),
    (('bakery', 'pastry', 'مخبز', 'معجنات', 'فطائر'), 'Bakery / Pastry'),
    (('sweet', 'confectionery', 'حلويات', 'حلا'), 'Bakery / Pastry'),
    (('juice', 'smoothie', 'عصير', 'عصائر'), 'Juice / Smoothie'),
    (('lounge', 'hookah', 'shisha', 'معسل', 'شيشة'), 'Lounge / Hookah'),
    (('seafood', 'fish', 'أسماك', 'اسماك', 'سمك', 'بحري'), 'Seafood'),
    (('healthy', 'salad', 'صحي', 'سلطة'), 'Healthy Food'),
    (('sham', 'damascus', 'شامي', 'دمشق', 'سوري'), 'Syrian / Levantine'),
    (('pakistan', 'kashmir', 'biryani', 'indian', 'باكستان', 'كشمير', 'برياني', 'هندي'), 'Indian / South Asian'),
]
LANG_HINTS = [(('indian', 'هندي', 'kerala', 'كيرلا'), 'Hindi'), (('pakistan', 'باكستان', 'lahore', 'لاهور', 'karachi'), 'Urdu'),
              (('filipino', 'فلبين', 'manila'), 'Tagalog'), (('chinese', 'صيني', 'china'), 'Chinese'), (('french', 'فرنسي', 'paris'), 'French')]
DEFAULT_PAYMENT = 'Cash, Mada, Visa, Mastercard, Apple Pay'
PAYMENT_ORDER = ['Cash', 'Cash on Delivery', 'Mada', 'Visa', 'Mastercard', 'Apple Pay', 'Online Payment', 'Bank Transfer']
PAYMENT_WORDS = {'cash on delivery': 'Cash on Delivery', 'cod': 'Cash on Delivery', 'cash': 'Cash', 'نقد': 'Cash', 'mada': 'Mada',
                 'مدى': 'Mada', 'visa': 'Visa', 'فيزا': 'Visa', 'master': 'Mastercard', 'ماستر': 'Mastercard', 'apple': 'Apple Pay',
                 'ابل': 'Apple Pay', 'أبل': 'Apple Pay', 'online': 'Online Payment', 'stc': 'Online Payment', 'transfer': 'Bank Transfer',
                 'تحويل': 'Bank Transfer'}



def text(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ''
    if isinstance(v, (list, tuple)):
        return ' | '.join(text(x) for x in v if text(x))
    s = str(v).strip()
    return '' if s.lower() in {'', 'none', 'null', 'nan', 'false', 'unavailable', 'n/a', '-'} else s


# ---- 2. names --------------------------------------------------------------------------------------------------

def _before_comma(s):
    return re.split(r'\s*[,،]\s*', s, maxsplit=1)[0].strip()


def name_ar(raw):
    """Arabic characters only, no category suffix after a comma."""
    s = _before_comma(text(raw))
    s = re.sub(r'[^؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿0-9\s\-&\'.()]', ' ', s)
    s = re.sub(r'[A-Za-z]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' -.&()')
    return s if ARABIC.search(s) else ''


def name_en(raw):
    """Latin characters only, no category suffix after a comma."""
    s = _before_comma(text(raw))
    s = ARABIC.sub(' ', s)
    s = re.sub(r'[^A-Za-z0-9\s\-&\'.()]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' -.&()')
    return s if LATIN.search(s) else ''


# ---- 3. floor ---------------------------------------------------------------------------------------------------

def floor(raw):
    """(value, inferred): «G» for the ground-floor spellings and, by the standard's default, for a missing floor."""
    s = text(raw).lower().replace('floor', '').strip()
    if not s:
        return 'G', True
    if s in {'g', 'ground', '0', 'gf', 'أرضي', 'ارضي', 'الأرضي', 'الارضي'}:
        return 'G', False
    m = re.match(r'^(?:b|basement|قبو)\s*-?\s*(\d+)$', s) or re.match(r'^-(\d+)$', s)
    if m:
        return f'B{int(m.group(1))}', False
    m = re.match(r'^(\d+)(?:st|nd|rd|th)?$', s)
    if m:
        return str(int(m.group(1))), False
    return '', False


# ---- 4. phone ---------------------------------------------------------------------------------------------------

def phone(raw):
    """The standard's format: «+966 XX XXX XXXX», «920 XXX XXX», «800 XXX XXXX»; '' when it is not a valid Saudi number."""
    s = text(raw)
    if not s:
        return ''
    if re.fullmatch(r'\d(\.\d+)?[eE]\+\d+', s):   # Excel's 9.67E+11: back to digits, the lost tail cannot be read
        s = str(int(float(s)))
    d = re.sub(r'[^\d+]', '', s.replace(' ', ''))
    d = d.lstrip('+')
    if d.startswith('00'):
        d = d[2:]
    if re.fullmatch(r'800\d{7}', d):
        return f'800 {d[3:6]} {d[6:]}'
    if re.fullmatch(r'920\d{6}', d):
        return f'920 {d[3:6]} {d[6:]}'
    if d.startswith('966'):
        d = d[3:]
        if re.fullmatch(r'920\d{6}', d):   # a unified number written with the country code
            return f'920 {d[3:6]} {d[6:]}'
    elif d.startswith('0'):
        d = d[1:]
    if re.fullmatch(r'[1-9]\d{8}', d):
        return f'+966 {d[:2]} {d[2:5]} {d[5:]}'
    return ''


# ---- 6-8. website, e-mail, social ---------------------------------------------------------------------------------

def _host(url):
    s = text(url).lower()
    s = re.sub(r'^[a-z]+://', '', s)
    return s.split('/')[0].split('?')[0].split(':')[0].removeprefix('www.')


def _words(s):
    return {w for w in re.findall(r'[a-z0-9]+', s.lower()) if len(w) >= 3}


def domain_matches(domain, name):
    """The domain says the business's name: a word of the name in the domain, or the domain's word starting a name word
    (transliterations, abbreviations and parent companies the standard accepts as exceptions are kept by the second test)."""
    parts = [p for p in re.split(r'[.\-]', domain) if p and p not in DOMAIN_WORDS_IGNORED]
    words = _words(name) - NAME_WORDS_IGNORED
    if not parts or not words:
        return False
    joined = ''.join(parts)
    initials = ''.join(w[0] for w in re.findall(r'[a-z0-9]+', name.lower()) if w not in NAME_WORDS_IGNORED)
    return any(w in joined for w in words) or any(p in w or w.startswith(p[:4]) for p in parts for w in words if len(p) >= 3) \
        or (len(initials) >= 3 and initials in joined)


def website(raw_site, raw_email, name):
    """(website, social links moved out of it, flags, inferred). A social, booking or map link is not a website; a
    website whose domain is another business's is blanked (flagged); a company e-mail's domain gives a website."""
    flags, inferred, social = [], [], []
    url = text(raw_site)
    if url:
        low = url.lower()
        host = _host(url)
        if any(h in host for h in SOCIAL_HOSTS):
            if any(h in host for h in SOCIAL_KEEP):
                social.append(url if low.startswith('http') else 'https://' + url)
            flags.append('website:social_moved')
            url = ''
        elif any(b in low for b in NOT_WEBSITE):
            flags.append('website:not_a_business_site')
            url = ''
        elif '.' not in host:
            flags.append('website:invalid')
            url = ''
        elif name and not domain_matches(host, name):
            flags.append('website:other_business')
            url = ''
        else:
            url = url if low.startswith(('http://', 'https://')) else 'https://' + url
    if not url:
        mail = text(raw_email).lower()
        dom = mail.split('@')[-1] if '@' in mail else ''
        if dom and '.' in dom and dom not in GENERIC_MAIL and not any(b in dom for b in NOT_WEBSITE) and name and domain_matches(dom, name):
            url = f'https://{dom}'
            inferred.append('website:from_email_domain')
    return url, social, flags, inferred


PLACEHOLDER_MAIL = re.compile(r'^(johndoe|test|example|user|email|name)@|@(domain|example|test)\.|sentry|bugsnag|@[^@]*:\d+$')


def email(raw, site, name, medical):
    """(email, flags, inferred). Error-tracking, placeholder and malformed addresses are dropped; a company address of
    another business is dropped; personal mail is kept; with a verified website and no address, info@ (care@ for medical)."""
    flags, inferred = [], []
    mail = text(raw).lower()
    if mail:
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[a-z]{2,}', mail) or PLACEHOLDER_MAIL.search(mail):
            flags.append('email:invalid')
            mail = ''
        else:
            dom = mail.split('@')[1]
            if dom not in GENERIC_MAIL and name and not domain_matches(dom, name):
                flags.append('email:other_business')
                mail = ''
    if not mail and site:
        dom = _host(site)
        if '.' in dom and dom not in GENERIC_MAIL:
            mail = f"{'care' if medical else 'info'}@{dom}"
            inferred.append('email:generated')   # never a send target
    return mail, flags, inferred


def socials(values):
    out = []
    for v in values:
        for part in re.split(r'[\s|,]+', text(v)):
            host = _host(part)
            if part and any(h in host for h in SOCIAL_KEEP):
                url = part if part.lower().startswith('http') else 'https://' + part
                url = url.split('?')[0].rstrip('/')
                if url not in out:
                    out.append(url)
    return ' | '.join(out)


# ---- 9-11. hours, days, break ---------------------------------------------------------------------------------------

def hours(raw):
    """(working hours, working days, break): the standard's «Sun: 09:00-23:00; …», from any format the directory's hours
    build writes (READABLE). Friday is never filled as closed; a day the source does not give is left out."""
    readable = text(raw)
    if not readable or not READABLE.match(readable):
        return '', '', ''
    days = {}
    for part in readable.split(' | '):
        day, spans = part.split(': ', 1)
        days[day] = [s.replace(' - ', '-') for s in spans.split(', ')]
    order = [d for d in DAYS if d in days]
    if len(order) == 7 and all(days[d] == ['00:00-24:00'] for d in order):
        return 'Open 24 Hours', 'Daily', 'No Break'
    text_hours = '; '.join(f"{d}: {', '.join(days[d])}" for d in order)
    working = 'Daily' if len(order) == 7 else ', '.join(order)
    brk = 'No Break'
    for d in order:
        spans = days[d]
        if len(spans) >= 2:
            first_end, second_start = spans[0].split('-')[1], spans[1].split('-')[0]
            if first_end < second_start:
                brk = f'{first_end}-{second_start}'
            break
    return text_hours, working, brk


# ---- 5. category, and the category-derived fields ------------------------------------------------------------------

def load_category_map(path):
    with open(path, encoding='utf-8-sig') as handle:
        return {row['sub_id']: row for row in csv.DictReader(handle)}


def _has(name, words):
    low = name.lower()
    return any(w in low for w in words)


def cuisine(name):
    for words, value in CUISINE:
        if _has(name, words):
            return value
    return ''


def payment(raw):
    s = text(raw).lower()
    found = {value for word, value in PAYMENT_WORDS.items() if word in s}
    if 'Cash on Delivery' in found and not re.search(r'\bcash\b(?! on)', s) and 'نقد' not in s:
        found.discard('Cash')
    return ', '.join(m for m in PAYMENT_ORDER if m in found)


def holidays(sub, main):
    if sub in MOSQUE or sub in {'health.hospital', 'health.pharmacy'}:
        return 'No holidays'
    if sub in GOV_EDU_FIN or main in {'fin', 'edu'}:
        return 'National Day (Sep 23), Founding Day (Feb 22), Eid Al-Fitr, Eid Al-Adha'
    if sub in SERVING:
        return 'Eid Al-Fitr (partial), Eid Al-Adha (partial)'
    return 'Eid Al-Fitr, Eid Al-Adha'


def license_no(raw):
    d = re.sub(r'\D', '', text(raw))
    return d if len(d) == 11 else ''


def legal_name(raw_legal, raw_form, en):
    legal = text(raw_legal)
    if not legal:
        return ''
    form = text(raw_form).lower()
    prefix = 'LLC' if ('llc' in form or 'ذات مسؤولية' in form or 'limited' in form) else 'EST' if ('est' in form or 'مؤسسة' in form) else ''
    return f'{prefix} {legal}'.strip() if prefix and not legal.upper().startswith(prefix) else legal


def business_words(taxonomy_json):
    """Arabic → English business words from the Farq taxonomy (single-word sub-categories, «صيدلية» → «Pharmacy»)."""
    if not taxonomy_json or not os.path.isfile(taxonomy_json):
        return {}
    with open(taxonomy_json, encoding='utf-8') as handle:
        subs = json.load(handle)['subs']
    return {s['sub_ar']: s['sub_en'].split('/')[0].strip() for s in subs
            if len(s.get('sub_ar', '').split()) == 1 and s.get('sub_en') and len(s['sub_en'].split('/')[0].split()) <= 2}


DEFAULT_TRANSLATOR = name_translation.Translator()


def standardize(row, category_map, translator=None):
    """One directory record in the standard. Returns (values, inferred, flags); empty strings for what is not found."""
    inferred, flags = [], []
    sub, main = text(row.get('sub_id')), text(row.get('main_id'))
    cat = category_map.get(sub) or {}
    ar, en = name_ar(row.get('name_ar')), name_en(row.get('name_en'))
    if not en:
        moved = name_en(row.get('name_ar'))          # English written inside the Arabic name
        if moved:
            en = moved
            inferred.append('name_en:from_name_ar_text')
        elif ar:
            en, method = (translator or DEFAULT_TRANSLATOR).translate(ar)
            if en:
                inferred.append(f'name_en:{method}')
    if not ar and name_ar(row.get('name_en')):
        ar = name_ar(row.get('name_en'))
        inferred.append('name_ar:from_name_en_text')
    name = ' '.join(x for x in (en, ar) if x)
    serving, cafe, medical, mosque = sub in SERVING, sub in CAFE, sub in MEDICAL, sub in MOSQUE
    chain = _has(name, CHAINS)
    lounge = _has(name, LOUNGE) or sub == 'food.hookah'
    fine = serving and sub in {'food.restaurant'} and not chain and not _has(name, CASUAL)
    mall = _has(name, ('mall', 'plaza', 'avenue', 'مول', 'بلازا', 'افنيو'))
    na = 'UNAPPLICABLE'

    def rule(field, value):
        inferred.append(f'{field}:rule')
        return value

    lat, lon = row.get('latitude'), row.get('longitude')
    lat = round(float(lat), 6) if lat is not None and text(lat) else None
    lon = round(float(lon), 6) if lon is not None and text(lon) else None
    site, moved_social, site_flags, site_inferred = website(row.get('website'), row.get('email'), en)
    flags += site_flags
    inferred += site_inferred
    mail, mail_flags, mail_inferred = email(row.get('email'), site, en, medical)
    flags += mail_flags
    inferred += mail_inferred
    social = socials([*moved_social, row.get('instagram'), row.get('twitter'), row.get('x_link'), row.get('snapchat'),
                      row.get('tiktok'), row.get('facebook'), row.get('overture_socials')])
    wh, wd, brk = hours(row.get('working_hours') if text(row.get('working_hours')) else row.get('opening_hours'))
    fl, fl_inferred = floor(row.get('floor_no') if text(row.get('floor_no')) else row.get('floor'))
    if fl_inferred:
        inferred.append('floor:default_ground')
    pay = payment(row.get('payment_methods'))
    if not pay:
        pay = na if mosque else rule('payment', DEFAULT_PAYMENT)
    menu = text(row.get('menu_link'))
    if not serving:
        menu_url, menu_flag = na, na
    else:
        menu_url, menu_flag = (menu, 'Yes') if menu else ('', 'No')
    langs = ['Arabic'] if mosque else ['Arabic', 'English'] + [lang for words, lang in LANG_HINTS if _has(name, words)]
    lang = rule('language', ', '.join(dict.fromkeys(langs)))
    hours_late = bool(re.search(r'-(0[1-5]):|Open 24 Hours|-24:00', wh))
    status = text(row.get('company_status')).lower()
    values = {
        'poi_key': row.get('poi_key'),
        'std_global_id': '{' + str(uuid.uuid5(NAMESPACE, str(row.get('poi_key')))).upper() + '}',
        'std_name_ar': ar, 'std_name_en': en,
        'std_legal_name': legal_name(row.get('legal_name'), row.get('legal_form'), en),
        'std_category': cat.get('category', ''), 'std_secondary_category': cat.get('secondary_category', ''),
        'std_category_level_3': cat.get('category_level_3', ''),
        # the standard accepts only «Open»; a closure the directory knows is kept, never rewritten as open
        'std_company_status': 'Open' if status in {'', 'open', 'operational', 'active'} else text(row.get('company_status')),
        'std_latitude': lat, 'std_longitude': lon,
        'std_google_map_url': f'https://www.google.com/maps?q={lat},{lon}' if lat is not None and lon is not None else '',
        'std_building_number': text(row.get('building_no')),
        'std_floor_number': fl,
        'std_entrance_location': rule('entrance', 'Main entrance, street-facing side'),
        'std_phone': phone(row.get('phone_norm') if text(row.get('phone_norm')) else row.get('phone')),
        'std_email': mail, 'std_website': site, 'std_social_media': social,
        'std_working_days': wd, 'std_working_hours': wh, 'std_break_time': brk,
        'std_holidays': rule('holidays', holidays(sub, main)),
        'std_menu_barcode_url': menu_url, 'std_language': lang,
        'std_cuisine': (cuisine(name) if serving else na),
        'std_payment_methods': pay,
        'std_commercial_license': license_no(row.get('commercial_license') if text(row.get('commercial_license')) else row.get('license_no')),
        # 28-55: the standard's rules by category and name, each marked as a rule
        'std_menu': menu_flag,
        'std_drive_thru': rule('drive_thru', ('Yes' if _has(name, DRIVE_THRU) else 'No') if serving else na),
        'std_dine_in': rule('dine_in', 'Yes' if serving else na),
        'std_only_delivery': rule('only_delivery', ('Yes' if sub == 'food.cloud_kitchen' else 'No') if serving or sub in {'food.grocery', 'health.pharmacy'} else na),
        'std_reservation': rule('reservation', 'Yes' if fine or medical else 'No'),
        'std_require_ticket': rule('require_ticket', 'Yes' if sub in TICKETED else 'No'),
        'std_order_from_car': rule('order_from_car', ('Yes' if _has(name, DRIVE_THRU) else 'No') if serving else na),
        'std_pickup_point_exists': rule('pickup_point', ('Yes' if chain else 'No') if serving else na),
        'std_wifi': rule('wifi', 'Yes' if cafe or lounge or fine or mall else 'No'),
        'std_music': rule('music', 'Yes' if cafe or lounge or fine else 'No'),
        'std_valet_parking': rule('valet', 'Yes' if fine or mall or sub in HOTELS else 'No'),
        'std_has_parking_lot': rule('parking', 'Yes'),
        'std_is_wheelchair_accessible': rule('wheelchair', 'Yes'),
        'std_has_family_seating': rule('family_seating', 'Yes' if serving else na),
        'std_has_a_waiting_area': rule('waiting_area', 'Yes' if _has(name, WAITING) or medical else 'No'),
        'std_has_separate_rooms_for_dining': rule('separate_rooms', ('Yes' if fine else 'No') if serving else na),
        'std_has_smoking_area': rule('smoking_area', ('Yes' if lounge else 'No') if serving else na),
        'std_children_area': rule('children_area', 'Yes' if mall or _has(name, CHILDREN_CHAINS) or sub in {'noncom.park', 'sports.entertainment_center', 'sports.theme_park'} else 'No'),
        'std_shisha': rule('shisha', ('Yes' if lounge else 'No') if serving else na),
        'std_live_sport_broadcasting': rule('live_sport', ('Yes' if lounge else 'No') if serving else na),
        'std_is_landmark': rule('landmark', 'Yes' if sub in LANDMARK or chain or fine or mall else 'No'),
        'std_is_trending': rule('trending', 'Yes' if chain or fine else 'No'),
        'std_large_groups_can_be_seated': rule('large_groups', ('Yes' if fine or chain else 'No') if serving else na),
        'std_has_women_only_prayer_room': rule('women_prayer_room', 'Yes' if mall or sub in HOSPITAL or sub in {'noncom.government', 'edu.university'} else 'No'),
        'std_provides_iftar_tent': rule('iftar_tent', 'Yes' if mosque else 'No'),
        'std_offers_iftar_menu': rule('iftar_menu', 'Yes' if serving else na),
        'std_is_open_during_suhoor': rule('suhoor', na if mosque else ('Yes' if hours_late else 'No')),
        'std_is_free_entry': rule('free_entry', 'No' if sub in TICKETED else 'Yes'),
    }
    if lat is None or lon is None:
        flags.append('location:missing')
    return values, inferred, flags


def run(targets, taxonomy, category_map_path, out, taxonomy_json=None):
    """Standardize every directory record, then the dataset-wide checks (duplicates), and write the layer."""
    import duckdb
    import pyarrow as pa
    import pyarrow.parquet as pq
    category_map = load_category_map(category_map_path)
    db = duckdb.connect()
    have = {r[0] for r in db.execute('describe select * from read_parquet(?)', [str(targets)]).fetchall()}
    wanted = ['poi_key', 'name_ar', 'name_en', 'latitude', 'longitude', 'website', 'email', 'instagram', 'twitter', 'x_link',
              'snapchat', 'tiktok', 'facebook', 'overture_socials', 'working_hours', 'opening_hours', 'floor_no', 'floor',
              'phone_norm', 'phone', 'payment_methods', 'menu_link', 'company_status', 'building_no', 'commercial_license',
              'license_no', 'legal_name', 'legal_form']
    cols = ', '.join(f'p.{c}' if c in have else f'null as {c}' for c in wanted)
    own = ', '.join(f'p.{c}' if c in have else f'null as {c}' for c in ('sub_id', 'main_id'))
    cls = "c.sub_id, t.main_id" if taxonomy else own
    join = ("left join (select poi_key, any_value(sub_id) sub_id from read_parquet(?) where confidence in ('high','medium') "
            "and sub_id not like 'unc.%' group by poi_key) c using (poi_key) left join tx t on t.sub_id = c.sub_id") if taxonomy else ''
    if taxonomy:
        db.execute('create table tx(sub_id varchar, main_id varchar)')
        db.executemany('insert into tx values (?, ?)', [(k, v['main_id']) for k, v in category_map.items()])
    # English names for Arabic-only businesses are learned from the businesses that carry both (name_translation)
    words = business_words(taxonomy_json or os.path.join(os.path.dirname(os.path.abspath(category_map_path)), 'farq_taxonomy.json'))
    pairs = [(name_ar(a), name_en(e)) for a, e in db.execute(
        f"select {'name_ar' if 'name_ar' in have else 'null'}, {'name_en' if 'name_en' in have else 'null'} from read_parquet(?)",
        [str(targets)]).fetchall()]
    pairs = [(a, e) for a, e in pairs if a and e]
    translator = name_translation.Translator(words).learn(pairs)
    counts_names = {'pairs': len(pairs), 'known_names': len(translator.exact), 'proper_words': len(translator.proper),
                    'held_out_quality': name_translation.evaluate(pairs, words)}
    cursor = db.execute(f"select {cols}, {cls} from read_parquet(?) p {join} qualify row_number() over (partition by p.poi_key) = 1",
                        [str(targets)] + ([str(taxonomy)] if taxonomy else []))
    names = [d[0] for d in cursor.description]
    partial = out + '.rows.parquet'
    writer = None
    counts = {'rows': 0, 'inferred': {}, 'flags': {}, 'english_names': counts_names}
    while batch := cursor.fetchmany(50000):
        records = []
        for raw in batch:
            values, inferred, flags = standardize(dict(zip(names, raw)), category_map, translator)
            values['std_inferred'] = '|'.join(inferred)
            values['std_flags'] = '|'.join(flags)
            records.append(values)
            for key in inferred:
                counts['inferred'][key] = counts['inferred'].get(key, 0) + 1
            for key in flags:
                counts['flags'][key] = counts['flags'].get(key, 0) + 1
        table = pa.Table.from_pylist(records)
        writer = writer or pq.ParquetWriter(partial, table.schema)
        writer.write_table(table)
        counts['rows'] += len(records)
    if writer:
        writer.close()
    # 5 and 6-7: a phone, website or e-mail on unrelated businesses is kept for one and blanked (flagged) on the rest;
    # the same name (a chain's branches) may share it. A phone on two records at the same point is kept for the first.
    db.execute(f"create table s as select * from read_parquet('{partial}')")
    db.execute("""create table name_key as select poi_key, lower(regexp_replace(coalesce(nullif(std_name_en, ''), std_name_ar), '[^[:alnum:]]', '', 'g')) nk from s""")
    # phone: blank when more than 2 businesses share it, or 2 share it at one point; website/e-mail: any second business.
    # In both, the records carrying the first record's name (its branches) keep the value.
    for field, flag, phone_rule in (('std_phone', 'phone:duplicate', True), ('std_website', 'website:duplicate', False),
                                    ('std_email', 'email:duplicate', False)):
        shared = '(g.n > 2 or r.same_point > 1)' if phone_rule else 'true'
        db.execute(f"""create or replace table dup as
            with v as (select s.poi_key, s.{field} val, n.nk, s.std_latitude lat, s.std_longitude lon from s join name_key n using (poi_key)
                       where s.{field} <> '' and s.{field} is not null),
            g as (select val, count(*) n, count(distinct nk) n_names from v group by val),
            r as (select v.*, first_value(v.nk) over (partition by v.val order by v.poi_key) first_nk,
                         count(*) over (partition by v.val, v.lat, v.lon) same_point from v)
            select r.poi_key from r join g using (val)
            where g.n_names > 1 and r.nk is distinct from r.first_nk and {shared}""")
        db.execute(f"""update s set {field} = '', std_flags = trim(concat_ws('|', nullif(std_flags, ''), '{flag}'), '|')
                       where poi_key in (select poi_key from dup)""")
        counts['flags'][flag] = db.execute('select count(*) from dup').fetchone()[0]
    db.execute(f"copy s to '{out}' (format parquet, compression zstd)")
    os.remove(partial)
    counts['version'] = VERSION
    with open(os.path.splitext(out)[0] + '.report.json', 'w', encoding='utf-8') as handle:
        json.dump(counts, handle, ensure_ascii=False, indent=1)
    return counts


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--targets', required=True)
    p.add_argument('--taxonomy', help='poi_taxonomy.parquet; without it the sub/main columns of the directory are read')
    p.add_argument('--category-map', required=True)
    p.add_argument('--out', required=True)
    a = p.parse_args(argv)
    for path in (a.out, os.path.splitext(a.out)[0] + '.report.json'):
        if os.path.exists(path):
            sys.exit(f'refusing to overwrite {path}')
    print(json.dumps(run(a.targets, a.taxonomy, a.category_map, a.out), ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
