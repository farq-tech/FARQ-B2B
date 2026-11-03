"""Requests for an Atlas account («اطلب حساباً»), kept for the owner to review by hand.

Atlas (apps/atlas/app/api/access-request/route.ts) forwards one validated request with the service token; this module
checks it again, appends it to `access_requests.jsonl` in the service's writable runtime folder (FARQ_TARGETING_RUNTIME_DIR,
the same folder as send_log.csv) and lists them for the owner's console (GET /access-requests behind the console
password). The owner's decisions (reviewed, approved, rejected, with a note) are appended to
`access_request_reviews.jsonl` beside it; the latest decision is a request's status. Nothing here sends an email or a
message, and nothing creates an account: approving records the decision and shows the details the owner copies to make
the account by hand in Farq (there is no admin path that creates one). Contact details never leave these files except
to the owner's console.

Personal details are not kept forever: `redact` empties a request's name, company, contact, purpose, page and the notes
on it (the owner's «احذف بيانات التواصل», on the person's request), and `apply_retention` does the same to every
request older than RETENTION_DAYS (FARQ_ACCESS_REQUEST_RETENTION_DAYS, 365 by default). Only these two rewrite the
files, atomically; what stays is the id, the time, the city, the category and the decisions, so counts still add up.

Limits, so a script cannot fill the disk: a contact with a request still open (new or reviewed), or any request in the
last 24 hours, is stored once (the second answer says the request is under review), at most DAILY_CAP requests a day in
total, and a fixed size for every field.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import secrets
import threading
import time
import urllib.parse

FILE_NAME = 'access_requests.jsonl'
REVIEWS_NAME = 'access_request_reviews.jsonl'
# «احذف بياناتي» from Atlas: the contact's hash and the time only, matched to the requests in the owner's list
DELETIONS_NAME = 'access_deletion_requests.jsonl'
# the owner's decisions, by hand: approving records the decision only, the account is made by hand in Farq
REVIEW_STATUSES = {'reviewed': 'روجع', 'approved': 'موافق عليه', 'rejected': 'مرفوض'}
STATUS_LABELS = {'new': 'جديد', **REVIEW_STATUSES}
OPEN_STATUSES = {'new', 'reviewed'}
NOTE_MAX = 500
DAILY_CAP = 300
SAME_CONTACT_WINDOW = 24 * 3600
# the fields that name or reach a person: emptied by `redact` and by the retention period
PERSONAL_FIELDS = ('name', 'company', 'contact', 'contact_kind', 'contact_key', 'purpose', 'next')
LIMITS = {'name': (2, 80), 'company': (2, 120), 'purpose': (0, 500)}
# the customer groups as the landing page words them (apps/atlas/lib/access-request.ts keeps the same ids)
CATEGORIES = {
    'shops': 'أفتح محلاً أو أوسّع نشاطي',
    'marketers': 'أصل إلى جمهوري بحملة',
    'distributors': 'أوزّع وأغطّي المناطق',
    'analysts': 'أفهم السوق والأحياء',
    'property': 'أبحث عن عقار مناسب',
    'supplier': 'أبحث عن مورد',
}
_LOCK = threading.Lock()
_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
_EMAIL = re.compile(r'^[^\s@<>"\']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$')
_CITY = re.compile(r"^[A-Za-z][A-Za-z .'\-]{0,79}$")
_NEXT = re.compile(r'^/[A-Za-z0-9/_\-.?=&%:,+~]{0,500}$')
_ID = re.compile(r'[0-9a-f]{16}')


def retention_days():
    """How long a request keeps its personal details (FARQ_ACCESS_REQUEST_RETENTION_DAYS, 30 at the least)."""
    try:
        return max(30, int(os.environ.get('FARQ_ACCESS_REQUEST_RETENTION_DAYS', '365')))
    except ValueError:
        return 365


def clean_text(value, low, high):
    """A typed line: control characters and angle brackets dropped, spaces folded; None outside [low, high]."""
    if not isinstance(value, str):
        return None if low else ''
    text = re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f<>]', ' ', value)).strip()
    return text if low <= len(text) <= high else None


def contact(value):
    """('email', address) or ('mobile', '+9665XXXXXXXX'), or None. A Saudi mobile in any of its usual spellings."""
    if not isinstance(value, str):
        return None
    text = value.translate(_DIGITS).strip()
    if '@' in text:
        text = text.lower()
        return ('email', text) if len(text) <= 254 and _EMAIL.match(text) else None
    digits = re.sub(r'[\s\-()]', '', text)
    match = re.fullmatch(r'(?:\+?966|00966|0)?(5\d{8})', digits)
    return ('mobile', '+966' + match.group(1)) if match else None


def validate(body, known_cities=None):
    """(record, None) or (None, {field: code}). `known_cities` (English names) limits the city when given."""
    body = body if isinstance(body, dict) else {}
    errors, record = {}, {}
    for field, (low, high) in LIMITS.items():
        value = clean_text(body.get(field), low, high)
        if value is None:
            errors[field] = 'INVALID'
        else:
            record[field] = value
    reach = contact(body.get('contact'))
    if reach is None:
        errors['contact'] = 'INVALID'
    else:
        record['contact_kind'], record['contact'] = reach
    city = body.get('city')
    if not isinstance(city, str) or not _CITY.match(city) or (known_cities is not None and city not in known_cities):
        errors['city'] = 'INVALID'
    else:
        record['city'] = city
    category = body.get('category')
    if category not in CATEGORIES:
        errors['category'] = 'INVALID'
    else:
        record['category'] = category
    nxt = body.get('next')
    record['next'] = nxt if isinstance(nxt, str) and _NEXT.match(nxt) and not nxt.startswith('//') else None
    return (None, errors) if errors else (record, None)


def _read_lines(path, keep):
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and row.get('id') and keep(row):
                rows.append(row)
    return rows


def _append(folder, name, row):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), 'a', encoding='utf-8') as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + '\n')


def _rewrite(folder, name, rows):
    """Replaces a file in one step (a reader sees the old file or the new one, never half of it)."""
    path = os.path.join(folder, name)
    temp = f'{path}.{secrets.token_hex(4)}.tmp'
    with open(temp, 'w', encoding='utf-8') as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    os.replace(temp, path)


def read_all(folder):
    """Every stored request, oldest first; a line that does not read back is skipped."""
    return _read_lines(os.path.join(folder, FILE_NAME), lambda row: True)


def read_reviews(folder):
    """Every decision, oldest first (a later decision on a request replaces the earlier one)."""
    return _read_lines(os.path.join(folder, REVIEWS_NAME), lambda row: row.get('status') in REVIEW_STATUSES)


def contact_key(value):
    """The contact as a hash: what the duplicate check compares, so the check needs no second copy of it."""
    return hashlib.sha256(('farq-access-v1:' + value).encode()).hexdigest()[:32]


def read_deletions(folder):
    """The people who asked for their details to be deleted: the time and their contact's hash, nothing else."""
    return _read_lines(os.path.join(folder, DELETIONS_NAME), lambda row: isinstance(row.get('contact_key'), str))


def _joined(requests, reviews, deletions=()):
    """Each request with its latest decision, and two flags for the owner: `prior_approved` (the same contact was
    approved on an earlier request: an account may exist already) and `deletion_asked` (the person asked for their
    details to be deleted)."""
    latest = {review['id']: review for review in reviews}
    rows = []
    for row in requests:
        review = latest.get(row['id'])
        rows.append({**row, 'status': review['status'], 'note': review.get('note') or '', 'reviewed_at': review.get('reviewed_at')} if review
                    else {**row, 'status': 'new', 'note': '', 'reviewed_at': None})
    approved = {}
    for row in rows:
        key = row.get('contact_key')
        if key and row['status'] == 'approved':
            approved.setdefault(key, []).append(row)
    asked, confirmed = {}, {}
    for entry in deletions:
        asked[entry['contact_key']] = entry.get('asked_at')
        if entry.get('confirmed_at'):
            confirmed[entry['contact_key']] = entry['confirmed_at']
    same = {}
    for row in rows:
        if row.get('contact_key'):
            same[row['contact_key']] = same.get(row['contact_key'], 0) + 1
    for row in rows:
        key = row.get('contact_key')
        earlier = [other for other in approved.get(key, []) if other['id'] != row['id'] and float(other.get('ts', 0)) <= float(row.get('ts', 0))]
        row['prior_approved'] = earlier[-1].get('reviewed_at') if earlier else None
        row['deletion_asked'] = asked.get(key) if key else None
        # «تم التأكد»: the owner ticked that they checked, by hand, that the ask comes from this person
        row['deletion_confirmed'] = confirmed.get(key) if key else None
        row['same_contact'] = same.get(key, 0) if key else 0
    return rows


def with_reviews(folder):
    """The requests, oldest first, each with its latest decision: status, note and when (status 'new' before any)."""
    return _joined(read_all(folder), read_reviews(folder), read_deletions(folder))


def submit(folder, body, known_cities=None, now=None):
    """Validates and stores one request. Returns (status, answer): 201 stored; 200 with `duplicate` when the same
    contact already has a request open (new or reviewed) or sent one in the last 24 hours (nothing new is stored; Atlas
    answers «وصل طلبك» either way, so no one learns whether a contact has a request); 400 with the fields that do not
    pass; 429 when today's cap is reached."""
    record, errors = validate(body, known_cities)
    if errors:
        return 400, {'ok': False, 'error': 'INVALID', 'fields': errors}
    now = time.time() if now is None else now
    key = contact_key(record['contact'])
    with _LOCK:
        rows = _joined(read_all(folder), read_reviews(folder))
        same = [row for row in rows if row.get('contact_key') == key]
        if any(row['status'] in OPEN_STATUSES or now - float(row.get('ts', 0)) < SAME_CONTACT_WINDOW for row in same):
            return 200, {'ok': True, 'duplicate': True}
        if sum(1 for row in rows if now - float(row.get('ts', 0)) < 86400) >= DAILY_CAP:
            return 429, {'ok': False, 'error': 'DAILY_CAP'}
        stored = {'id': secrets.token_hex(8), 'ts': now, 'received_at': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now)),
                  'contact_key': key, **record}
        _append(folder, FILE_NAME, stored)
    return 201, {'ok': True, 'id': stored['id']}


def request_deletion(folder, raw_contact, now=None):
    """«احذف بياناتي»: keeps the contact's hash and the time for the owner, who deletes by hand. (status, answer):
    200 always for a well-formed contact, whether or not it has a request (nothing is revealed), 400 otherwise, 429 at
    the daily cap. Repeats of the same contact within a day are kept once."""
    reach = contact(raw_contact)
    if reach is None:
        return 400, {'ok': False, 'error': 'INVALID', 'fields': {'contact': 'INVALID'}}
    now = time.time() if now is None else now
    key = contact_key(reach[1])
    with _LOCK:
        entries = read_deletions(folder)
        if any(entry['contact_key'] == key and now - float(entry.get('ts', 0)) < SAME_CONTACT_WINDOW for entry in entries):
            return 200, {'ok': True}
        if sum(1 for entry in entries if now - float(entry.get('ts', 0)) < 86400) >= DAILY_CAP:
            return 429, {'ok': False, 'error': 'DAILY_CAP'}
        _append(folder, DELETIONS_NAME, {'id': secrets.token_hex(8), 'ts': now, 'contact_key': key,
                                         'asked_at': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now))})
    return 200, {'ok': True}


def unread_count(folder):
    """Requests no one has decided on yet."""
    return sum(1 for row in with_reviews(folder) if row['status'] == 'new')


def review(folder, request_id, status, note='', now=None):
    """Records the owner's decision on one request. (status, answer): 200, 400 for a wrong status or note, 404 for no
    such request. Nothing is sent to the person and no account is created; approving is a note for the owner."""
    if status not in REVIEW_STATUSES:
        return 400, {'ok': False, 'error': 'STATUS'}
    clean = clean_text(note, 0, NOTE_MAX)
    if clean is None:
        return 400, {'ok': False, 'error': 'NOTE'}
    if not isinstance(request_id, str) or not _ID.fullmatch(request_id):
        return 404, {'ok': False, 'error': 'NOT_FOUND'}
    now = time.time() if now is None else now
    with _LOCK:
        if not any(row['id'] == request_id for row in read_all(folder)):
            return 404, {'ok': False, 'error': 'NOT_FOUND'}
        _append(folder, REVIEWS_NAME, {'id': request_id, 'status': status, 'note': clean, 'ts': now,
                                       'reviewed_at': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now))})
    return 200, {'ok': True, 'status': status}


def _redact_rows(folder, should, now, reason):
    """Empties the personal fields of every request `should` picks, and the notes on it. Returns how many."""
    requests, reviews = read_all(folder), read_reviews(folder)
    picked = {row['id'] for row in requests if not row.get('redacted_at') and should(row)}
    if not picked:
        return 0
    stamp = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now))
    _rewrite(folder, FILE_NAME, [
        {**{k: v for k, v in row.items() if k not in PERSONAL_FIELDS}, 'redacted_at': stamp, 'redacted_why': reason} if row['id'] in picked else row
        for row in requests])
    if any(review['id'] in picked and review.get('note') for review in reviews):
        _rewrite(folder, REVIEWS_NAME, [{**review, 'note': ''} if review['id'] in picked else review for review in reviews])
    return len(picked)


def redact(folder, request_id, now=None):
    """The owner removes a person's details on their request: name, company, contact, purpose, page and notes go;
    the id, time, city, category and decisions stay. (status, answer): 200 or 404."""
    if not isinstance(request_id, str) or not _ID.fullmatch(request_id):
        return 404, {'ok': False, 'error': 'NOT_FOUND'}
    now = time.time() if now is None else now
    with _LOCK:
        if not any(row['id'] == request_id for row in read_all(folder)):
            return 404, {'ok': False, 'error': 'NOT_FOUND'}
        _redact_rows(folder, lambda row: row['id'] == request_id, now, 'owner')
    return 200, {'ok': True}


def confirm_deletion(folder, request_id, confirmed=True, now=None):
    """The owner's «تم التأكد» on a flagged request: they checked by hand (the person's own channel, by the owner,
    never sent from here) that the deletion ask is genuine. Only a request with a deletion ask can be ticked.
    (status, answer): 200, 404, 409 when there is no ask to confirm."""
    if not isinstance(request_id, str) or not _ID.fullmatch(request_id):
        return 404, {'ok': False, 'error': 'NOT_FOUND'}
    now = time.time() if now is None else now
    with _LOCK:
        row = next((item for item in read_all(folder) if item['id'] == request_id), None)
        if row is None:
            return 404, {'ok': False, 'error': 'NOT_FOUND'}
        key = row.get('contact_key')
        asks = read_deletions(folder)
        if not key or not any(entry['contact_key'] == key for entry in asks):
            return 409, {'ok': False, 'error': 'NO_DELETION_ASK'}
        stamp = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now)) if confirmed else None
        _rewrite(folder, DELETIONS_NAME, [{**entry, 'confirmed_at': stamp} if entry['contact_key'] == key else entry for entry in asks])
    return 200, {'ok': True, 'confirmed': bool(confirmed)}


def redact_person(folder, request_id, now=None):
    """«احذف كل بيانات هذا الشخص»: every request with the same contact is emptied at once, and the deletion ask goes
    too (its hash would match nothing). Only for a flagged request the owner has ticked «تم التأكد».
    (status, answer): 200 with how many, 404, 409 when not flagged or not confirmed."""
    if not isinstance(request_id, str) or not _ID.fullmatch(request_id):
        return 404, {'ok': False, 'error': 'NOT_FOUND'}
    now = time.time() if now is None else now
    with _LOCK:
        row = next((item for item in read_all(folder) if item['id'] == request_id), None)
        if row is None:
            return 404, {'ok': False, 'error': 'NOT_FOUND'}
        key = row.get('contact_key')
        asks = read_deletions(folder)
        ask = [entry for entry in asks if key and entry['contact_key'] == key]
        if not ask:
            return 409, {'ok': False, 'error': 'NO_DELETION_ASK'}
        if not any(entry.get('confirmed_at') for entry in ask):
            return 409, {'ok': False, 'error': 'NOT_CONFIRMED'}
        cleared = _redact_rows(folder, lambda item: item.get('contact_key') == key, now, 'owner')
        _rewrite(folder, DELETIONS_NAME, [entry for entry in asks if entry['contact_key'] != key])
    return 200, {'ok': True, 'cleared': cleared}


# what the scheduled job has done since the service started, for /metrics (numbers only)
RETENTION_STATS = {'runs': 0, 'failures': 0, 'cleared': 0, 'last_run': 0.0, 'last_success': 0.0}


def apply_retention(folder, now=None, days=None):
    """Empties the personal details of every request older than the retention period. Returns how many."""
    now = time.time() if now is None else now
    limit = (days or retention_days()) * 86400
    with _LOCK:
        cleared = _redact_rows(folder, lambda row: now - float(row.get('ts', 0)) > limit, now, 'retention')
        # a deletion ask older than the period has nothing left to match once those requests are cleared
        asks = read_deletions(folder)
        kept = [entry for entry in asks if now - float(entry.get('ts', 0)) <= limit]
        if len(kept) != len(asks):
            _rewrite(folder, DELETIONS_NAME, kept)
        return cleared


def start_retention(folder, every=86400, first_after=60, stop=None, log=None):
    """The retention period as a scheduled job: a daemon thread that clears old details `first_after` seconds after
    start and then every `every` seconds, so they go even if no one opens the list. Returns the thread; `stop`
    (a threading.Event) ends it."""
    stop = stop or threading.Event()

    def loop():
        wait = first_after
        while not stop.wait(wait):
            RETENTION_STATS['runs'] += 1
            RETENTION_STATS['last_run'] = time.time()
            try:
                cleared = apply_retention(folder)
                RETENTION_STATS['cleared'] += cleared
                RETENTION_STATS['last_success'] = time.time()
                if log:
                    log(cleared)
            except Exception:   # a full disk or a bad line must not end the job
                RETENTION_STATS['failures'] += 1
                if log:
                    log(-1)
            wait = every
    thread = threading.Thread(target=loop, name='access-request-retention', daemon=True)
    thread.start()
    return thread


def metric_lines(folder):
    """Prometheus lines for /metrics: the retention job's runs, failures, cleared count and last success (a stopped job
    shows as a last success that stops moving), and how many requests wait for a decision or a deletion. Counts only."""
    rows = with_reviews(folder)
    waiting_decision = sum(1 for row in rows if row['status'] == 'new')
    waiting_deletion = len({row['contact_key'] for row in rows if row.get('deletion_asked') and not row.get('redacted_at') and row.get('contact_key')})
    stats = dict(RETENTION_STATS)
    return [
        '# HELP atlas_access_request_retention_runs_total Runs of the account-request retention job since start.',
        '# TYPE atlas_access_request_retention_runs_total counter',
        f'atlas_access_request_retention_runs_total {stats["runs"]}',
        '# HELP atlas_access_request_retention_failures_total Runs of the retention job that failed.',
        '# TYPE atlas_access_request_retention_failures_total counter',
        f'atlas_access_request_retention_failures_total {stats["failures"]}',
        '# HELP atlas_access_request_retention_cleared_total Requests whose personal details the job cleared.',
        '# TYPE atlas_access_request_retention_cleared_total counter',
        f'atlas_access_request_retention_cleared_total {stats["cleared"]}',
        '# HELP atlas_access_request_retention_last_success_timestamp_seconds When the job last finished without error (0 = not yet).',
        '# TYPE atlas_access_request_retention_last_success_timestamp_seconds gauge',
        f'atlas_access_request_retention_last_success_timestamp_seconds {stats["last_success"]:.0f}',
        '# HELP atlas_access_requests_waiting Account requests waiting for the owner, by what they wait for.',
        '# TYPE atlas_access_requests_waiting gauge',
        f'atlas_access_requests_waiting{{kind="decision"}} {waiting_decision}',
        f'atlas_access_requests_waiting{{kind="deletion"}} {waiting_deletion}',
    ]


def week_counts(rows, now=None):
    """Requests received in the last 7 days and in the 7 before (cleared ones count too: the time stays)."""
    now = time.time() if now is None else now
    ages = [now - float(row.get('ts', 0)) for row in rows]
    return sum(1 for age in ages if 0 <= age < 7 * 86400), sum(1 for age in ages if 7 * 86400 <= age < 14 * 86400)


def aggregate(rows):
    """Demand without anyone's details: requests per month, city and category (what clearing keeps), newest month
    first, then the largest count."""
    counts = {}
    for row in rows:
        month = time.strftime('%Y-%m', time.gmtime(float(row.get('ts', 0))))
        key = (month, row.get('city') or '', row.get('category') or '')
        counts[key] = counts.get(key, 0) + 1
    rows_out = [(month, city, category, n) for (month, city, category), n in counts.items()]
    return sorted(rows_out, key=lambda item: (-int(item[0].replace('-', '')), -item[3], item[1], item[2]))


FILTERS = {'all': 'الكل', **STATUS_LABELS}


def account_details(row, city_names=None):
    """What the owner copies to make the account by hand in Farq: plain lines, nothing is sent from here."""
    reach = 'البريد' if row.get('contact_kind') == 'email' else 'الجوال'
    return '\n'.join([
        f"الاسم: {row.get('name') or ''}",
        f"الجهة: {row.get('company') or ''}",
        f"{reach}: {row.get('contact') or ''}",
        f"المدينة: {city_label(row.get('city'), city_names)}",
        f"الفئة: {CATEGORIES.get(row.get('category'), row.get('category') or '')}",
    ])


def city_label(city, city_names=None):
    """A city as the owner reads it: its Arabic name from the shared city list, the stored English key otherwise."""
    return (city_names or {}).get(city) or city or ''


SEARCH_FIELDS = ('name', 'company', 'contact', 'city', 'purpose', 'note')


def _fold(text):
    """Text for search: lower case, Arabic-Indic digits as 0-9, the usual Arabic letter variants as one."""
    text = str(text or '').translate(_DIGITS).casefold()
    return re.sub('[أإآ]', 'ا', text).replace('ة', 'ه').replace('ى', 'ي')


def matches(row, query, city_names=None):
    """Whether a request has every word of `query` in its name, company, contact, city (either spelling), purpose or note."""
    words = _fold(query).split()
    if not words:
        return True
    hay = _fold(' '.join([*(str(row.get(field) or '') for field in SEARCH_FIELDS), city_label(row.get('city'), city_names)]))
    return all(word in hay for word in words)


PAGE_SIZE = 50
# the rows that need the owner first: a deletion ask, or a contact approved before
FLAGS = {'deletion': 'طلب حذف بياناته', 'prior': 'سبق قبوله'}


def flagged(row, flag):
    if flag == 'deletion':
        return bool(row.get('deletion_asked')) and not row.get('redacted_at')
    if flag == 'prior':
        return bool(row.get('prior_approved'))
    return True


def list_href(status='all', query='', flag='', page=1):
    """The list's own address with its filters (escaped for an attribute)."""
    parts = [('status', status)]
    if query:
        parts.append(('q', query))
    if flag in FLAGS:
        parts.append(('flag', flag))
    if page > 1:
        parts.append(('page', str(page)))
    return html.escape('/access-requests?' + urllib.parse.urlencode(parts))


def render_html(rows, saved=False, status='all', query='', city_names=None, flag='', page=1, now=None):
    """The owner's list (with_reviews), newest first, every value escaped, filtered by status, a flag and a search,
    PAGE_SIZE rows a page, with per request: a decision form, the account details to copy once approved, «احذف بيانات
    التواصل», the flags «سبق قبوله» and «طلب حذف بياناته» (with «تم التأكد» and, once ticked, «احذف كل بيانات هذا
    الشخص»); above it the last 7 days' count, under it the demand by month, city and category (no one's details)."""
    status = status if status in FILTERS else 'all'
    flag = flag if flag in FLAGS else ''
    query = clean_text(query, 0, 80) or ''
    found = [row for row in rows if matches(row, query, city_names) and flagged(row, flag)]
    counts = {key: (len(found) if key == 'all' else sum(1 for row in found if row.get('status', 'new') == key)) for key in FILTERS}
    shown = [row for row in found if status == 'all' or row.get('status', 'new') == status]
    pages = max(1, -(-len(shown) // PAGE_SIZE))
    try:
        page = min(max(1, int(page)), pages)
    except (TypeError, ValueError):
        page = 1
    newest = list(reversed(shown))
    visible = newest[(page - 1) * PAGE_SIZE:page * PAGE_SIZE]
    unread = sum(1 for row in rows if row.get('status', 'new') == 'new')
    # people, not rows: one person with two requests asked once (the same count as /metrics)
    asked = len({row.get('contact_key') for row in rows if flagged(row, 'deletion') and row.get('contact_key')})
    this_week, last_week = week_counts(rows, now)
    tabs = ' · '.join(
        (f'<strong aria-current="page">{label} ({counts[key]})</strong>' if key == status
         else f'<a href="{list_href(key, query, flag)}">{label} ({counts[key]})</a>')
        for key, label in FILTERS.items())
    flag_counts = {key: sum(1 for row in rows if matches(row, query, city_names) and flagged(row, key)) for key in FLAGS}
    flag_tabs = ' · '.join(
        [(f'<strong aria-current="true">الكل</strong>' if not flag else f'<a href="{list_href(status, query)}">الكل</a>')] +
        [(f'<strong aria-current="true">{label} ({flag_counts[key]})</strong>' if key == flag
          else f'<a href="{list_href(status, query, key)}">{label} ({flag_counts[key]})</a>') for key, label in FLAGS.items()])
    search = ('<form method="get" action="/access-requests" role="search" style="flex-direction:row;align-items:end;max-width:560px">'
              f'<input type="hidden" name="status" value="{html.escape(status)}">'
              + (f'<input type="hidden" name="flag" value="{html.escape(flag)}">' if flag else '') +
              f'<label style="flex:1">ابحث بالاسم أو الجهة أو التواصل أو المدينة<input type="search" name="q" value="{html.escape(query)}" maxlength="80"></label>'
              '<button type="submit">ابحث</button>' + (f'<a href="{list_href(status, "", flag)}">مسح</a>' if query else '') + '</form>')
    trend = 'مثلها' if this_week == last_week else 'أكثر' if this_week > last_week else 'أقل'
    head = ('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>طلبات الحسابات</title>'
            '<style>body{font-family:-apple-system,Tahoma;background:#0f1115;color:#e8eaf0;margin:24px}a{color:#93c5fd}'
            'table{border-collapse:collapse;width:100%}th,td{border:1px solid #2a2f3a;padding:8px;text-align:start;vertical-align:top}'
            'th{background:#171a21}td.c{direction:ltr;text-align:end}tr.new td:first-child{border-inline-start:4px solid #3b82f6}'
            '.s{display:inline-block;padding:2px 8px;border-radius:999px;background:#2a2f3a;font-size:13px}.s.new{background:#1d4ed8}'
            '.s.approved{background:#166534}.s.rejected{background:#7f1d1d}.s.flag{background:#854d0e}'
            'form{display:flex;flex-direction:column;gap:6px;min-width:200px}label.row{flex-direction:row;align-items:center;gap:6px}'
            'label{display:flex;flex-direction:column;gap:2px}pre{white-space:pre-wrap;margin:6px 0;background:#171a21;padding:8px;border-radius:6px}'
            'input,select,textarea,button{font:inherit;border-radius:6px;border:1px solid #2a2f3a;background:#0f1115;color:#e8eaf0;padding:6px}'
            'button{background:#3b82f6;border:0;cursor:pointer}button.x{background:transparent;border:1px solid #7f1d1d;color:#fca5a5}'
            'button.xx{background:#7f1d1d;color:#fff}.ok{color:#86efac}.m{color:#9ca3af;font-size:13px}h2{margin-top:32px}</style>'
            f'<p><a href="/">← لوحة الاستهداف</a></p><h1>طلبات الحسابات ({len(rows)})</h1>'
            f'<p>جديدة لم يُتخذ فيها قرار: <strong>{unread}</strong>'
            + (f' · طلبات حذف بيانات تنتظر: <strong>{asked}</strong> (أشخاص)' if asked else '') + '</p>'
            f'<p>طلبات آخر 7 أيام: <strong>{this_week}</strong>، {trend} من الأيام السبعة قبلها ({last_week}).</p>'
            + search + f'<nav aria-label="الحالة"><p>{tabs}</p></nav><nav aria-label="تحتاج انتباهاً"><p>تحتاج انتباهاً: {flag_tabs}</p></nav>'
            + (f'<p class="ok" role="status">{html.escape(saved)}</p>' if isinstance(saved, str) and saved else
               '<p class="ok" role="status">حُفظ القرار.</p>' if saved else '') +
            '<p>للمراجعة اليدوية. لا يُرسل شيء من هنا. الموافقة تسجّل القرار وتعرض بيانات الحساب لتنسخها وتنشئه يدوياً '
            f'في فرق، ثم تتواصل مع صاحب الطلب بنفسك. تُحذف بيانات التواصل تلقائياً بعد {retention_days()} يوماً.</p>')
    summary = render_aggregate(rows, city_names)
    if not shown:
        empty = 'لا طلبات بعد.' if not rows else 'لا طلبات تطابق البحث.' if query else 'لا طلبات بهذه التصفية.' if flag else 'لا طلبات بهذه الحالة.'
        return head + f'<p>{empty}</p>' + summary + '</html>'

    def e(value):
        return html.escape(str(value or '—'))

    def options(current):
        # a new request starts on «اختر القرار», so saving without choosing is refused instead of marking it reviewed
        pick = '<option value="" selected disabled>اختر القرار</option>' if current not in REVIEW_STATUSES else ''
        return pick + ''.join(f'<option value="{key}"{" selected" if key == current else ""}>{label}</option>' for key, label in REVIEW_STATUSES.items())

    back = html.escape(status)
    hidden = f'<input type="hidden" name="back" value="{back}">'
    body = []
    for row in visible:
        state = row.get('status') if row.get('status') in STATUS_LABELS else 'new'
        rid = html.escape(str(row.get('id', '')))
        decided = f'<br><small>{e(row.get("reviewed_at"))}</small>' if row.get('reviewed_at') else ''
        note = f'<br>{e(row.get("note"))}' if row.get('note') else ''
        flags = ''
        if row.get('prior_approved'):
            flags += f'<br><span class="s flag">سبق قبوله ({e(row.get("prior_approved"))})</span><br><small class="m">قد يكون له حساب. تحقّق قبل إنشاء حساب ثانٍ.</small>'
        deletion = ''
        if flagged(row, 'deletion'):
            flags += f'<br><span class="s flag">طلب حذف بياناته ({e(row.get("deletion_asked"))})</span>'
            confirmed = row.get('deletion_confirmed')
            # «تم التأكد» is ticked by hand once the owner checked the ask is genuine (by the person's own channel, not
            # from here); only then can every request of this person be cleared in one step
            deletion = ('<form method="post" action="/access-requests/deletion-confirm">'
                        f'<input type="hidden" name="id" value="{rid}">{hidden}<input type="hidden" name="confirmed" value="{"0" if confirmed else "1"}">'
                        f'<label class="row"><input type="checkbox" {"checked " if confirmed else ""}onchange="this.form.submit()">'
                        f'تم التأكد من أن الطلب من صاحب البيانات{f" ({e(confirmed)})" if confirmed else ""}</label>'
                        '<noscript><button type="submit">احفظ</button></noscript></form>')
            if confirmed:
                many = row.get('same_contact') or 1
                deletion += ('<form method="post" action="/access-requests/redact-person" '
                             f'data-confirm="تُحذف بيانات هذا الشخص من كل طلباته ({many}) نهائياً، ويُحذف طلب الحذف. متأكد؟">'
                             f'<input type="hidden" name="id" value="{rid}">{hidden}'
                             f'<button type="submit" class="xx">احذف كل بيانات هذا الشخص ({many})</button></form>')
            else:
                deletion += '<p class="m">ضع العلامة بعد أن تتأكد بنفسك، فيظهر زر حذف كل بياناته.</p>'
        if row.get('redacted_at'):
            gone = 'بعد مدة الحفظ' if row.get('redacted_why') == 'retention' else 'بطلب صاحبها'
            actions = f'<p class="m">حُذفت بيانات التواصل {gone} ({e(row.get("redacted_at"))}).</p>'
        else:
            details = ''
            if state == 'approved':
                details = (f'<details open><summary>بيانات إنشاء الحساب</summary><pre id="d-{rid}">{html.escape(account_details(row, city_names))}</pre>'
                           f'<button type="button" data-copy="d-{rid}">انسخ البيانات</button>'
                           '<p class="m">أنشئ الحساب يدوياً في فرق. لا يُرسل شيء لصاحب الطلب من هنا.</p></details>')
            actions = (deletion + details +
                       '<form method="post" action="/access-requests/review">'
                       f'<input type="hidden" name="id" value="{rid}">{hidden}'
                       f'<label>القرار<select name="status" required>{options(state)}</select></label>'
                       f'<label>ملاحظة<textarea name="note" maxlength="{NOTE_MAX}" rows="2">{html.escape(row.get("note") or "")}</textarea></label>'
                       '<button type="submit">احفظ القرار</button></form>'
                       '<form method="post" action="/access-requests/redact" data-confirm="تُحذف بيانات صاحب الطلب نهائياً. متأكد؟">'
                       f'<input type="hidden" name="id" value="{rid}">{hidden}'
                       '<button type="submit" class="x">احذف بيانات التواصل</button></form>')
        cells = [
            (True, e(row.get('received_at'))), (False, e(row.get('name'))), (False, e(row.get('company'))), (True, e(row.get('contact'))),
            (False, e(city_label(row.get('city'), city_names))), (False, e(CATEGORIES.get(row.get('category'), row.get('category')))),
            (False, e(row.get('purpose'))), (True, e(row.get('next'))),
            (False, f'<span class="s {state}">{STATUS_LABELS[state]}</span>{decided}{note}{flags}'), (False, actions)]
        body.append(f'<tr class="{state}">' + ''.join(f'<td{" class=c" if ltr else ""}>{value}</td>' for ltr, value in cells) + '</tr>')
    paging = ''
    if pages > 1:
        first = (page - 1) * PAGE_SIZE + 1
        paging = ('<nav aria-label="الصفحات"><p>'
                  + (f'<a href="{list_href(status, query, flag, page - 1)}">→ الأحدث</a> · ' if page > 1 else '')
                  + f'الصفحة {page} من {pages} (الطلبات {first} إلى {first + len(visible) - 1} من {len(shown)})'
                  + (f' · <a href="{list_href(status, query, flag, page + 1)}">الأقدم ←</a>' if page < pages else '') + '</p></nav>')
    script = ('<script>document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(!b)return;'
              'var t=document.getElementById(b.dataset.copy).textContent;navigator.clipboard.writeText(t).then(function(){b.textContent="نُسخت"},'
              'function(){b.textContent="انسخ يدوياً"})});document.addEventListener("submit",function(e){var m=e.target.dataset.confirm;'
              'if(m&&!confirm(m))e.preventDefault()});</script>')
    return (head + paging + '<table><thead><tr><th>الوقت (UTC)</th><th>الاسم</th><th>الجهة</th><th>التواصل</th><th>المدينة</th>'
            '<th>الفئة</th><th>ما يريد</th><th>الصفحة</th><th>الحالة</th><th>القرار</th></tr></thead><tbody>' + ''.join(body)
            + '</tbody></table>' + paging + summary + script + '</html>')


def render_aggregate(rows, city_names=None):
    """The demand table: counts only, so it stays whole after details are cleared."""
    table = aggregate(rows)
    if not table:
        return ''
    lines = ''.join(
        f'<tr><td class=c>{html.escape(month)}</td><td>{html.escape(city_label(city, city_names) or "—")}</td>'
        f'<td>{html.escape(CATEGORIES.get(category, category) or "—")}</td><td class=c>{n}</td></tr>'
        for month, city, category, n in table)
    return ('<h2>الطلب حسب الشهر والمدينة والفئة</h2><p class="m">أعداد فقط، تبقى بعد حذف البيانات.</p>'
            '<table style="max-width:720px"><thead><tr><th>الشهر</th><th>المدينة</th><th>الفئة</th><th>الطلبات</th></tr></thead>'
            f'<tbody>{lines}</tbody></table>')
