#!/usr/bin/env python3
"""POI validator: an automated quality gate modelled on the owner's human review dashboard (POI_FINAL_Review.xlsx).

Each dashboard sheet is a rule here, with the same severity and an `_Issue`-style detail per row:

  1_Location   MEDIUM  shared coordinates (rounded to 6 decimals) between different POIs
  2_Names      HIGH    Name_EN contains Arabic script / Name_AR has no Arabic script
  3_Categories HIGH    missing category
  4_Phone      HIGH    scientific notation or numeric-cell artefact (9.66E+11, 966…000.0)
               LOW     non-standard format (standard: «+966 XX XXX XXXX», «920 XXX XXX», «800 XXX XXXX»)
  5_Website    HIGH    Google Maps link / social-media URL / numeric value stored as website
               LOW     missing http(s) protocol
  6_PhoneShared LOW    a phone shared by more than 2 POIs that do not carry the same name
  7_Placeholder LOW    a cell equal to UNAVAILABLE / UNAPPLICABLE (owner decision 2026-11-02: the tokens are forbidden)
  7_FoodFields  LOW    food-only fields (menu, drive_thru, dine_in, …, cuisine) filled on a non-food POI
  8_Mandatory  HIGH    name_ar, name_en, category, latitude, longitude empty (or a placeholder)
  9_Standards  LOW     value outside the accepted values of an enum field (Yes/No, floor, status, language,
                       working days, working hours)
  10_Bbox      HIGH    coordinates outside Saudi Arabia (lat 16–33, lon 34–56)

Usage:
  python3 poi_validator.py INPUT.(parquet|csv) --profile std|golden|directory --out /path/prefix
Writes  <out>_issues.parquet  (id, rule, severity, field, detail)  and  <out>_summary.json, prints the summary and
exits 1 when any HIGH issue exists (the gate).  Everything runs in duckdb SQL with `threads=2`.
"""
import argparse
import json
import os
import re
import shutil
import sys

import duckdb

PLACEHOLDERS = ('UNAVAILABLE', 'UNAPPLICABLE')
SA_BBOX = {'lat_min': 16.0, 'lat_max': 33.0, 'lon_min': 34.0, 'lon_max': 56.0}
COORD_DECIMALS = 6          # the dashboard matched 24.784385000000043 with 24.784385
NAME_LIST_LIMIT = 5         # names listed in a «Shared coords» detail
FIELD_LIST_LIMIT = 8        # fields listed in a placeholder / food-fields detail

# ---- accepted formats (RE2 syntax, used inside duckdb) -----------------------------------------------------------
PHONE_STANDARD = [r'^\+966 [0-9]{2} [0-9]{3} [0-9]{4}$', r'^920 [0-9]{3} [0-9]{3}$', r'^800 [0-9]{3} [0-9]{4}$']
PHONE_E164_DIGITS = [r'^966[0-9]{9}$', r'^920[0-9]{6}$', r'^800[0-9]{7}$']   # the served directory's phone_norm
PHONE_SCIENTIFIC = r'^[0-9]+(\.[0-9]+)?[eE]\+?[0-9]+$'
PHONE_FLOAT_ARTEFACT = r'^[0-9]+\.[0-9]+$'
WEB_GOOGLE_MAPS = r'(google\.[a-z.]+/maps|maps\.google\.|goo\.gl/maps|maps\.app\.goo\.gl)'
WEB_SOCIAL = (r'^(https?://)?([a-z0-9-]+\.)*(instagram|facebook|fb|twitter|x|tiktok|snapchat|linkedin|youtube|threads'
              r'|wa|whatsapp|t|telegram)\.(com|me)(/|$)')   # the host only; a social host in a path is not social
WEB_NUMERIC = r'^[0-9.+ ]+$'
WEB_PROTOCOL = r'^https?://'
DAY = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat)'
TIME = '[0-9]{2}:[0-9]{2}'
SPAN = f'{TIME}-{TIME}'
HOURS_DAY = f'{DAY}: ({SPAN}(, {SPAN})*|Closed|Open 24 Hours)'
ENUM_PATTERNS = {
    'floor_number': r'^(G|B[1-9][0-9]*|[1-9][0-9]*)$',
    'company_status': r'^(Open|Closed|Temporarily Closed|Permanently Closed)$',
    'language': r'^Arabic(, [A-Z][A-Za-z]+)*$',
    'working_days': f'^(Daily|{DAY}(, {DAY})*)$',
    'working_hours': f'^(Open 24 Hours|{HOURS_DAY}(; {HOURS_DAY})*)$',
}
ENUM_HINT = {
    'floor_number': 'G | 1.. | B1..',
    'company_status': 'Open | Closed | Temporarily Closed | Permanently Closed',
    'language': 'Arabic, …',
    'working_days': 'Daily | Sun, Mon, …',
    'working_hours': 'Sun: HH:MM-HH:MM; … | Open 24 Hours',
}

# ---- profiles: logical field -> physical column ------------------------------------------------------------------
GOLDEN_BOOLS = ['menu', 'drive_thru', 'dine_in', 'only_delivery', 'reservation', 'require_ticket', 'order_from_car',
                'pickup_point_exists', 'wifi', 'music', 'valet_parking', 'has_parking_lot', 'is_wheelchair_accessible',
                'has_family_seating', 'has_a_waiting_area', 'has_separate_rooms_for_dining', 'has_smoking_area',
                'children_area', 'shisha', 'live_sport_broadcasting', 'is_landmark', 'is_trending',
                'large_groups_can_be_seated', 'has_women_only_prayer_room', 'provides_iftar_tent', 'offers_iftar_menu',
                'is_open_during_suhoor', 'is_free_entry']
GOLDEN_FOOD_ONLY = ['menu', 'drive_thru', 'dine_in', 'only_delivery', 'order_from_car', 'pickup_point_exists',
                    'has_family_seating', 'has_separate_rooms_for_dining', 'has_smoking_area', 'shisha',
                    'live_sport_broadcasting', 'large_groups_can_be_seated', 'offers_iftar_menu', 'cuisine']
DIRECTORY_FOOD_CATEGORIES = ['Restaurant', 'Cafe / Coffee Shop', 'Fast Food', 'Buffet / Popular Eatery',
                             'Bakery & Pastry', 'Sweets & Chocolate Shop', 'Juice & Ice Cream', 'Hookah Lounge',
                             'Food Truck', 'Cloud Kitchen', 'Catering']

PROFILES = {
    'golden': {
        'id': 'globalid',
        'cols': {'name_ar': 'name_ar', 'name_en': 'name_en', 'category': 'category', 'latitude': 'latitude',
                 'longitude': 'longitude', 'phone': 'phone_number', 'website': 'website', 'email': 'email',
                 'floor_number': 'floor_number', 'company_status': 'company_status', 'language': 'language',
                 'working_days': 'working_days', 'working_hours': 'working_hours_for_each_day', 'cuisine': 'cuisine'},
        'yes_no': GOLDEN_BOOLS,
        'food_only': GOLDEN_FOOD_ONLY,
        'food_sql': "category = 'Restaurants'",
        'phone_patterns': PHONE_STANDARD,
    },
    'std': {
        'id': 'poi_key',
        'cols': {'name_ar': 'std_name_ar', 'name_en': 'std_name_en', 'category': 'std_category',
                 'latitude': 'std_latitude', 'longitude': 'std_longitude', 'phone': 'std_phone',
                 'website': 'std_website', 'email': 'std_email', 'floor_number': 'std_floor_number',
                 'company_status': 'std_company_status', 'language': 'std_language',
                 'working_days': 'std_working_days', 'working_hours': 'std_working_hours', 'cuisine': 'std_cuisine'},
        'yes_no': ['std_' + c for c in GOLDEN_BOOLS],
        'food_only': ['std_' + c for c in GOLDEN_FOOD_ONLY],
        'food_sql': "(std_category = 'Restaurants' OR (std_cuisine IS NOT NULL AND trim(std_cuisine) <> '' "
                    "AND upper(trim(std_cuisine)) NOT IN ('UNAVAILABLE', 'UNAPPLICABLE')))",
        'phone_patterns': PHONE_STANDARD,
    },
    'directory': {
        'id': 'poi_key',
        'cols': {'name_ar': 'name_ar', 'name_en': 'name_en', 'category': 'category', 'latitude': 'latitude',
                 'longitude': 'longitude', 'phone': 'phone_norm', 'website': 'website', 'email': 'email',
                 'floor_number': 'floor_no', 'company_status': 'company_status', 'language': None,
                 'working_days': None, 'working_hours': None, 'cuisine': None},
        'yes_no': [],
        'food_only': [],
        'food_sql': "(secondary_category LIKE '%أغذية%' OR category IN ("
                    + ', '.join(f"'{c}'" for c in DIRECTORY_FOOD_CATEGORIES) + '))',
        'phone_patterns': PHONE_E164_DIGITS,
    },
}

SEVERITY_ORDER = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}


def q(s):
    """SQL string literal."""
    return "'" + str(s).replace("'", "''") + "'"


def ident(c):
    return '"' + c.replace('"', '""') + '"'


def v(col):
    """The trimmed text of a column, NULL when empty."""
    return f"NULLIF(trim(CAST({ident(col)} AS VARCHAR)), '')"


def is_placeholder(col):
    return f"upper(trim(CAST({ident(col)} AS VARCHAR))) IN ({', '.join(q(p) for p in PLACEHOLDERS)})"


def filled(col):
    """Non-empty and not a placeholder token."""
    return f"({v(col)} IS NOT NULL AND NOT {is_placeholder(col)})"


def short(expr, n=60):
    return f"left({expr}, {n})"


class Validator:
    def __init__(self, input_path, profile_name, threads=2, memory_limit='2GB', temp_dir=None):
        if profile_name not in PROFILES:
            raise ValueError(f'unknown profile {profile_name!r}; choose one of {sorted(PROFILES)}')
        self.input_path = input_path
        self.profile_name = profile_name
        self.profile = PROFILES[profile_name]
        self.con = duckdb.connect()
        self.con.execute(f'SET threads={int(threads)}')
        self.con.execute(f"SET memory_limit={q(memory_limit)}")
        if temp_dir:
            os.makedirs(temp_dir, exist_ok=True)
            self.con.execute(f"SET temp_directory={q(temp_dir)}")
        self.skipped = []
        self._load()

    # ---- source ----------------------------------------------------------------------------------------------------
    def _reader(self):
        p = self.input_path
        if p.lower().endswith('.csv'):
            return (f"read_csv({q(p)}, all_varchar=true, header=true, delim=',', quote='\"', escape='\"', "
                    f"null_padding=true, strict_mode=false)")
        return f"read_parquet({q(p)})"

    def _load(self):
        con, prof = self.con, self.profile
        reader = self._reader()
        if self.input_path.lower().endswith('.csv'):
            con.execute(f"CREATE TEMP TABLE raw AS SELECT * FROM {reader}")   # a human sheet: small, parse once
            source = 'raw'
        else:
            con.execute(f"CREATE VIEW raw AS SELECT * FROM {reader}")        # a parquet: projection pushdown per rule
            source = 'raw'
        self.columns = {r[0]: r[1] for r in con.execute(f"DESCRIBE {source}").fetchall()}
        self.text_columns = [c for c, t in self.columns.items() if t == 'VARCHAR']
        # resolve the profile against the columns that exist
        self.cols = {}
        for logical, physical in prof['cols'].items():
            if physical and physical in self.columns:
                self.cols[logical] = physical
            else:
                self.cols[logical] = None
                if physical:
                    self.skipped.append(physical)
        self.yes_no = [c for c in prof['yes_no'] if c in self.columns]
        self.food_only = [c for c in prof['food_only'] if c in self.columns]
        id_col = prof['id'] if prof['id'] in self.columns else None
        id_expr = (f"COALESCE({v(id_col)}, 'row:' || CAST(row_number() OVER () AS VARCHAR))" if id_col
                   else "'row:' || CAST(row_number() OVER () AS VARCHAR)")
        lat = self.cols['latitude']
        lon = self.cols['longitude']
        lat_expr = f"TRY_CAST({ident(lat)} AS DOUBLE)" if lat else 'NULL::DOUBLE'
        lon_expr = f"TRY_CAST({ident(lon)} AS DOUBLE)" if lon else 'NULL::DOUBLE'
        try:
            food_ok = all(c in self.columns for c in re.findall(r'\b([a-z_]+)\s*(?:=|IN|LIKE|IS)', prof['food_sql']))
        except Exception:
            food_ok = False
        food_expr = f"COALESCE({prof['food_sql']}, false)" if food_ok else 'false'
        con.execute(f"""
            CREATE VIEW src AS
            SELECT {id_expr} AS _id, {lat_expr} AS _lat, {lon_expr} AS _lon, {food_expr} AS _food, *
            FROM {source}""")
        con.execute("CREATE TEMP TABLE issues (id VARCHAR, rule VARCHAR, severity VARCHAR, field VARCHAR, detail VARCHAR)")
        self.total_rows = con.execute("SELECT count(*) FROM src").fetchone()[0]

    def _add(self, sql):
        self.con.execute(f"INSERT INTO issues {sql}")

    # ---- rules -----------------------------------------------------------------------------------------------------
    def rule_location(self):
        """1_Location (MEDIUM): shared coordinates between different POIs."""
        if not (self.cols['latitude'] and self.cols['longitude']):
            return
        name = self._name_expr()
        self._add(f"""
            SELECT _id, '1_Location', 'MEDIUM', 'coordinates',
                   'Shared coords with ' || CAST(n - 1 AS VARCHAR) || ' others: ' ||
                   array_to_string(list_slice(names, 1, {NAME_LIST_LIMIT}), ', ') ||
                   CASE WHEN n > {NAME_LIST_LIMIT} THEN ', …' ELSE '' END
            FROM (
                SELECT _id,
                       count(*) OVER w AS n,
                       list(COALESCE(_name, _id)) OVER w AS names
                FROM (SELECT _id, {name} AS _name, round(_lat, {COORD_DECIMALS}) AS la, round(_lon, {COORD_DECIMALS}) AS lo
                      FROM src WHERE _lat IS NOT NULL AND _lon IS NOT NULL)
                WINDOW w AS (PARTITION BY la, lo)
            ) WHERE n > 1""")

    def _name_expr(self):
        parts = [v(self.cols[k]) for k in ('name_ar', 'name_en') if self.cols[k]]
        return f"COALESCE({', '.join(parts)})" if parts else 'NULL'

    def rule_names(self):
        """2_Names (HIGH): Name_EN contains Arabic script; Name_AR has no Arabic script."""
        en, ar = self.cols['name_en'], self.cols['name_ar']
        if en:
            self._add(f"""
                SELECT _id, '2_Names', 'HIGH', {q(en)}, 'Name_EN is Arabic: "' || {short(v(en), 40)} || '"'
                FROM src WHERE {filled(en)} AND regexp_matches({v(en)}, '\\p{{Arabic}}')""")
        if ar:
            self._add(f"""
                SELECT _id, '2_Names', 'HIGH', {q(ar)}, 'Name_AR has no Arabic: "' || {short(v(ar), 40)} || '"'
                FROM src WHERE {filled(ar)} AND NOT regexp_matches({v(ar)}, '\\p{{Arabic}}')""")

    def rule_categories(self):
        """3_Categories (HIGH): missing category (empty or a placeholder)."""
        cat = self.cols['category']
        if cat:
            self._add(f"""
                SELECT _id, '3_Categories', 'HIGH', {q(cat)}, 'Missing category'
                FROM src WHERE NOT {filled(cat)}""")

    def rule_phone(self):
        """4_Phone: scientific notation / numeric artefact (HIGH); non-standard format (LOW)."""
        ph = self.cols['phone']
        if not ph:
            return
        std = ' OR '.join(f"regexp_matches({v(ph)}, {q(p)})" for p in self.profile['phone_patterns'])
        self._add(f"""
            SELECT _id, '4_Phone',
                   CASE WHEN regexp_matches({v(ph)}, {q(PHONE_SCIENTIFIC)}) OR regexp_matches({v(ph)}, {q(PHONE_FLOAT_ARTEFACT)})
                        THEN 'HIGH' ELSE 'LOW' END,
                   {q(ph)},
                   CASE WHEN regexp_matches({v(ph)}, {q(PHONE_SCIENTIFIC)}) THEN 'Scientific notation: '
                        WHEN regexp_matches({v(ph)}, {q(PHONE_FLOAT_ARTEFACT)}) THEN 'Numeric cell artefact: '
                        ELSE 'Non-standard format: ' END || {short(v(ph), 40)}
            FROM src WHERE {filled(ph)} AND NOT ({std})""")

    def rule_website(self):
        """5_Website: Google Maps link / social URL / numeric value (HIGH); missing protocol (LOW)."""
        w = self.cols['website']
        if not w:
            return
        lw = f"lower({v(w)})"
        self._add(f"""
            SELECT _id, '5_Website',
                   CASE WHEN regexp_matches({lw}, {q(WEB_GOOGLE_MAPS)}) OR regexp_matches({lw}, {q(WEB_SOCIAL)})
                             OR regexp_matches({lw}, {q(WEB_NUMERIC)}) THEN 'HIGH' ELSE 'LOW' END,
                   {q(w)},
                   CASE WHEN regexp_matches({lw}, {q(WEB_GOOGLE_MAPS)}) THEN 'Google link: '
                        WHEN regexp_matches({lw}, {q(WEB_SOCIAL)}) THEN 'Social media link: '
                        WHEN regexp_matches({lw}, {q(WEB_NUMERIC)}) THEN 'Numeric value: '
                        ELSE 'Missing protocol: ' END || {short(v(w), 60)}
            FROM src
            WHERE {filled(w)} AND (regexp_matches({lw}, {q(WEB_GOOGLE_MAPS)}) OR regexp_matches({lw}, {q(WEB_SOCIAL)})
                                   OR regexp_matches({lw}, {q(WEB_NUMERIC)}) OR NOT regexp_matches({lw}, {q(WEB_PROTOCOL)}))""")

    def rule_phone_shared(self):
        """6_PhoneShared (LOW): a phone on more than 2 POIs that do not all carry the same name."""
        ph = self.cols['phone']
        if not ph:
            return
        name = f"lower(regexp_replace(COALESCE({self._name_expr()}, ''), '\\s+', ' ', 'g'))"
        self._add(f"""
            SELECT _id, '6_PhoneShared', 'LOW', {q(ph)},
                   'Phone shared by ' || CAST(n AS VARCHAR) || ' POIs (' || CAST(names AS VARCHAR) || ' different names)'
            FROM (SELECT _id, count(*) OVER w AS n, count(DISTINCT _name) OVER w AS names
                  FROM (SELECT _id, {v(ph)} AS _phone, {name} AS _name FROM src WHERE {filled(ph)})
                  WINDOW w AS (PARTITION BY _phone))
            WHERE n > 2 AND names > 1""")

    def rule_placeholder(self):
        """7_Placeholder (LOW): any cell equal to UNAVAILABLE / UNAPPLICABLE (one issue per row, fields listed)."""
        if not self.text_columns:
            return
        cases = ', '.join(f"CASE WHEN {is_placeholder(c)} THEN {q(c)} END" for c in self.text_columns)
        self._add(f"""
            SELECT _id, '7_Placeholder', 'LOW', 'cells',
                   'Forbidden placeholder in ' || CAST(len(f) AS VARCHAR) || ' field(s): ' ||
                   array_to_string(list_slice(f, 1, {FIELD_LIST_LIMIT}), ', ') ||
                   CASE WHEN len(f) > {FIELD_LIST_LIMIT} THEN ', …' ELSE '' END
            FROM (SELECT _id, list_filter([{cases}], x -> x IS NOT NULL) AS f FROM src)
            WHERE len(f) > 0""")

    def rule_food_fields(self):
        """7_FoodFields (LOW): food-only fields filled on a non-food POI."""
        if not self.food_only:
            return
        cases = ', '.join(f"CASE WHEN {filled(c)} THEN {q(c)} || '=' || {short(v(c), 20)} END" for c in self.food_only)
        self._add(f"""
            SELECT _id, '7_FoodFields', 'LOW', 'food_fields',
                   'Non-food: ' || array_to_string(list_slice(f, 1, {FIELD_LIST_LIMIT}), ', ') ||
                   CASE WHEN len(f) > {FIELD_LIST_LIMIT} THEN ', …' ELSE '' END
            FROM (SELECT _id, list_filter([{cases}], x -> x IS NOT NULL) AS f FROM src WHERE NOT _food)
            WHERE len(f) > 0""")

    def rule_mandatory(self):
        """8_Mandatory (HIGH): name_ar, name_en, category, latitude, longitude empty (or a placeholder)."""
        for logical in ('name_ar', 'name_en', 'category'):
            c = self.cols[logical]
            if c:
                self._add(f"""
                    SELECT _id, '8_Mandatory', 'HIGH', {q(c)},
                           {q(logical)} || CASE WHEN {is_placeholder(c)} THEN ' is ' || upper(trim({v(c)})) ELSE ' is empty' END
                    FROM src WHERE NOT {filled(c)}""")
        for logical, expr in (('latitude', '_lat'), ('longitude', '_lon')):
            c = self.cols[logical]
            if c:
                self._add(f"""
                    SELECT _id, '8_Mandatory', 'HIGH', {q(c)}, {q(logical)} || ' is empty'
                    FROM src WHERE {expr} IS NULL""")

    def rule_standards(self):
        """9_Standards (LOW): a value outside the accepted values of an enum field."""
        if self.yes_no:
            structs = ', '.join(f"{{'field': {q(c)}, 'value': {v(c)}, 'bad': ({filled(c)} AND {v(c)} NOT IN ('Yes', 'No'))}}"
                                for c in self.yes_no)
            self._add(f"""
                SELECT _id, '9_Standards', 'LOW', u.field, u.field || '="' || left(u.value, 50) || '" (not Yes/No)'
                FROM (SELECT _id, unnest([{structs}]) AS u FROM src)
                WHERE u.bad""")
        for logical, pattern in ENUM_PATTERNS.items():
            c = self.cols.get(logical)
            if c:
                self._add(f"""
                    SELECT _id, '9_Standards', 'LOW', {q(c)},
                           {q(c)} || '="' || {short(v(c), 50)} || '" (expected ' || {q(ENUM_HINT[logical])} || ')'
                    FROM src WHERE {filled(c)} AND NOT regexp_matches({v(c)}, {q(pattern)})""")

    def rule_bbox(self):
        """10_Bbox (HIGH): coordinates outside Saudi Arabia."""
        if not (self.cols['latitude'] and self.cols['longitude']):
            return
        b = SA_BBOX
        self._add(f"""
            SELECT _id, '10_Bbox', 'HIGH', 'coordinates',
                   'Outside Saudi Arabia: ' || CAST(_lat AS VARCHAR) || ', ' || CAST(_lon AS VARCHAR)
            FROM src WHERE _lat IS NOT NULL AND _lon IS NOT NULL
              AND (_lat < {b['lat_min']} OR _lat > {b['lat_max']} OR _lon < {b['lon_min']} OR _lon > {b['lon_max']})""")

    RULES = ('rule_location', 'rule_names', 'rule_categories', 'rule_phone', 'rule_website', 'rule_phone_shared',
             'rule_placeholder', 'rule_food_fields', 'rule_mandatory', 'rule_standards', 'rule_bbox')

    # ---- run -------------------------------------------------------------------------------------------------------
    def run(self, out_prefix=None, verbose=False):
        for name in self.RULES:
            if verbose:
                print(f'  {name}…', file=sys.stderr, flush=True)
            getattr(self, name)()
        summary = self.summary()
        if out_prefix:
            os.makedirs(os.path.dirname(os.path.abspath(out_prefix)) or '.', exist_ok=True)
            self.con.execute(f"""COPY (SELECT * FROM issues ORDER BY
                                     CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, rule, id)
                                 TO {q(out_prefix + '_issues.parquet')} (FORMAT PARQUET, COMPRESSION ZSTD)""")
            with open(out_prefix + '_summary.json', 'w', encoding='utf-8') as fh:
                json.dump(summary, fh, ensure_ascii=False, indent=1)
            summary['issues_path'] = out_prefix + '_issues.parquet'
            summary['summary_path'] = out_prefix + '_summary.json'
        return summary

    def issues(self):
        """All issues as a list of dicts (small inputs / tests)."""
        rows = self.con.execute("SELECT id, rule, severity, field, detail FROM issues").fetchall()
        return [dict(zip(('id', 'rule', 'severity', 'field', 'detail'), r)) for r in rows]

    def summary(self):
        con = self.con
        by_sev = dict(con.execute("SELECT severity, count(*) FROM issues GROUP BY 1").fetchall())
        by_rule = {}
        for rule, sev, n in con.execute("SELECT rule, severity, count(*) FROM issues GROUP BY 1, 2 ORDER BY 1, 2").fetchall():
            by_rule.setdefault(rule, {'total': 0})
            by_rule[rule][sev] = n
            by_rule[rule]['total'] += n
        by_rule = dict(sorted(by_rule.items(), key=lambda kv: int(re.match(r'\d+', kv[0]).group())))
        rows_high = con.execute("SELECT count(DISTINCT id) FROM issues WHERE severity = 'HIGH'").fetchone()[0]
        rows_any = con.execute("SELECT count(DISTINCT id) FROM issues").fetchone()[0]
        total = sum(by_sev.values())
        return {
            'input': self.input_path,
            'profile': self.profile_name,
            'total_rows': self.total_rows,
            'total_issues': total,
            'by_severity': {s: by_sev.get(s, 0) for s in ('HIGH', 'MEDIUM', 'LOW')},
            'by_rule': by_rule,
            'rows_with_high': rows_high,
            'rows_with_any_issue': rows_any,
            'skipped_columns': self.skipped,
            'gate': 'FAIL' if by_sev.get('HIGH', 0) else 'PASS',
        }


def validate(input_path, profile, out_prefix=None, threads=2, verbose=False, temp_dir=None):
    val = Validator(input_path, profile, threads=threads, temp_dir=temp_dir)
    try:
        return val.run(out_prefix, verbose=verbose)
    finally:
        val.con.close()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('input', help='parquet or csv path')
    ap.add_argument('--profile', required=True, choices=sorted(PROFILES))
    ap.add_argument('--out', help='output prefix: writes <out>_issues.parquet and <out>_summary.json')
    ap.add_argument('--threads', type=int, default=2)
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args(argv)
    temp_dir = (os.path.join(os.path.dirname(os.path.abspath(args.out)), '.duckdb_tmp') if args.out else None)
    try:
        summary = validate(args.input, args.profile, args.out, threads=args.threads, verbose=args.verbose, temp_dir=temp_dir)
    finally:
        if temp_dir and os.path.isdir(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 1 if summary['by_severity']['HIGH'] else 0


if __name__ == '__main__':
    sys.exit(main())
