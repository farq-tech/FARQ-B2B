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

FILE_NAME = 'access_requests.jsonl'
REVIEWS_NAME = 'access_request_reviews.jsonl'
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


def _joined(requests, reviews):
    latest = {review['id']: review for review in reviews}
    rows = []
    for row in requests:
        review = latest.get(row['id'])
        rows.append({**row, 'status': review['status'], 'note': review.get('note') or '', 'reviewed_at': review.get('reviewed_at')} if review
                    else {**row, 'status': 'new', 'note': '', 'reviewed_at': None})
    return rows


def with_reviews(folder):
    """The requests, oldest first, each with its latest decision: status, note and when (status 'new' before any)."""
    return _joined(read_all(folder), read_reviews(folder))


def submit(folder, body, known_cities=None, now=None):
    """Validates and stores one request. Returns (status, answer): 201 stored; 200 with `duplicate` when the same
    contact already has a request open (new or reviewed) or sent one in the last 24 hours (nothing new is stored, and
    the person is told it is under review); 400 with the fields that do not pass; 429 when today's cap is reached."""
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


def apply_retention(folder, now=None, days=None):
    """Empties the personal details of every request older than the retention period. Returns how many."""
    now = time.time() if now is None else now
    limit = (days or retention_days()) * 86400
    with _LOCK:
        return _redact_rows(folder, lambda row: now - float(row.get('ts', 0)) > limit, now, 'retention')


FILTERS = {'all': 'الكل', **STATUS_LABELS}


def account_details(row):
    """What the owner copies to make the account by hand in Farq: plain lines, nothing is sent from here."""
    reach = 'البريد' if row.get('contact_kind') == 'email' else 'الجوال'
    return '\n'.join([
        f"الاسم: {row.get('name') or ''}",
        f"الجهة: {row.get('company') or ''}",
        f"{reach}: {row.get('contact') or ''}",
        f"المدينة: {row.get('city') or ''}",
        f"الفئة: {CATEGORIES.get(row.get('category'), row.get('category') or '')}",
    ])


def render_html(rows, saved=False, status='all'):
    """The owner's list (with_reviews), newest first, every value escaped, filtered by status, with per request: a
    decision form, the account details to copy once approved, and «احذف بيانات التواصل». Nothing here sends anything."""
    status = status if status in FILTERS else 'all'
    counts = {key: (len(rows) if key == 'all' else sum(1 for row in rows if row.get('status', 'new') == key)) for key in FILTERS}
    shown = [row for row in rows if status == 'all' or row.get('status', 'new') == status]
    tabs = ' · '.join(
        (f'<strong aria-current="page">{label} ({counts[key]})</strong>' if key == status
         else f'<a href="/access-requests?status={key}">{label} ({counts[key]})</a>')
        for key, label in FILTERS.items())
    head = ('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>طلبات الحسابات</title>'
            '<style>body{font-family:-apple-system,Tahoma;background:#0f1115;color:#e8eaf0;margin:24px}a{color:#93c5fd}'
            'table{border-collapse:collapse;width:100%}th,td{border:1px solid #2a2f3a;padding:8px;text-align:start;vertical-align:top}'
            'th{background:#171a21}td.c{direction:ltr;text-align:end}tr.new td:first-child{border-inline-start:4px solid #3b82f6}'
            '.s{display:inline-block;padding:2px 8px;border-radius:999px;background:#2a2f3a;font-size:13px}.s.new{background:#1d4ed8}'
            '.s.approved{background:#166534}.s.rejected{background:#7f1d1d}form{display:flex;flex-direction:column;gap:6px;min-width:200px}'
            'label{display:flex;flex-direction:column;gap:2px}pre{white-space:pre-wrap;margin:6px 0;background:#171a21;padding:8px;border-radius:6px}'
            'select,textarea,button{font:inherit;border-radius:6px;border:1px solid #2a2f3a;background:#0f1115;color:#e8eaf0;padding:6px}'
            'button{background:#3b82f6;border:0;cursor:pointer}button.x{background:transparent;border:1px solid #7f1d1d;color:#fca5a5}'
            '.ok{color:#86efac}.m{color:#9ca3af;font-size:13px}</style>'
            f'<p><a href="/">← لوحة الاستهداف</a></p><h1>طلبات الحسابات ({len(rows)})</h1>'
            f'<p>جديدة لم يُتخذ فيها قرار: <strong>{counts["new"]}</strong></p>'
            f'<nav aria-label="الحالة"><p>{tabs}</p></nav>'
            + (f'<p class="ok" role="status">{html.escape(saved)}</p>' if isinstance(saved, str) and saved else
               '<p class="ok" role="status">حُفظ القرار.</p>' if saved else '') +
            '<p>للمراجعة اليدوية. لا يُرسل شيء من هنا. الموافقة تسجّل القرار وتعرض بيانات الحساب لتنسخها وتنشئه يدوياً '
            f'في فرق، ثم تتواصل مع صاحب الطلب بنفسك. تُحذف بيانات التواصل تلقائياً بعد {retention_days()} يوماً.</p>')
    if not shown:
        return head + ('<p>لا طلبات بعد.</p>' if not rows else '<p>لا طلبات بهذه الحالة.</p>') + '</html>'

    def e(value):
        return html.escape(str(value or '—'))

    def options(current):
        # a new request starts on «اختر القرار», so saving without choosing is refused instead of marking it reviewed
        pick = '<option value="" selected disabled>اختر القرار</option>' if current not in REVIEW_STATUSES else ''
        return pick + ''.join(f'<option value="{key}"{" selected" if key == current else ""}>{label}</option>' for key, label in REVIEW_STATUSES.items())

    back = html.escape(status)
    body = []
    for row in reversed(shown):
        state = row.get('status') if row.get('status') in STATUS_LABELS else 'new'
        rid = html.escape(str(row.get('id', '')))
        decided = f'<br><small>{e(row.get("reviewed_at"))}</small>' if row.get('reviewed_at') else ''
        note = f'<br>{e(row.get("note"))}' if row.get('note') else ''
        if row.get('redacted_at'):
            gone = 'بعد مدة الحفظ' if row.get('redacted_why') == 'retention' else 'بطلب صاحبها'
            actions = f'<p class="m">حُذفت بيانات التواصل {gone} ({e(row.get("redacted_at"))}).</p>'
        else:
            details = ''
            if state == 'approved':
                details = (f'<details open><summary>بيانات إنشاء الحساب</summary><pre id="d-{rid}">{html.escape(account_details(row))}</pre>'
                           f'<button type="button" data-copy="d-{rid}">انسخ البيانات</button>'
                           '<p class="m">أنشئ الحساب يدوياً في فرق. لا يُرسل شيء لصاحب الطلب من هنا.</p></details>')
            actions = (details +
                       '<form method="post" action="/access-requests/review">'
                       f'<input type="hidden" name="id" value="{rid}"><input type="hidden" name="back" value="{back}">'
                       f'<label>القرار<select name="status" required>{options(state)}</select></label>'
                       f'<label>ملاحظة<textarea name="note" maxlength="{NOTE_MAX}" rows="2">{html.escape(row.get("note") or "")}</textarea></label>'
                       '<button type="submit">احفظ القرار</button></form>'
                       '<form method="post" action="/access-requests/redact" data-confirm="تُحذف بيانات صاحب الطلب نهائياً. متأكد؟">'
                       f'<input type="hidden" name="id" value="{rid}"><input type="hidden" name="back" value="{back}">'
                       '<button type="submit" class="x">احذف بيانات التواصل</button></form>')
        cells = [
            (True, e(row.get('received_at'))), (False, e(row.get('name'))), (False, e(row.get('company'))), (True, e(row.get('contact'))),
            (False, e(row.get('city'))), (False, e(CATEGORIES.get(row.get('category'), row.get('category')))), (False, e(row.get('purpose'))),
            (True, e(row.get('next'))), (False, f'<span class="s {state}">{STATUS_LABELS[state]}</span>{decided}{note}'), (False, actions)]
        body.append(f'<tr class="{state}">' + ''.join(f'<td{" class=c" if ltr else ""}>{value}</td>' for ltr, value in cells) + '</tr>')
    script = ('<script>document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(!b)return;'
              'var t=document.getElementById(b.dataset.copy).textContent;navigator.clipboard.writeText(t).then(function(){b.textContent="نُسخت"},'
              'function(){b.textContent="انسخ يدوياً"})});document.addEventListener("submit",function(e){var m=e.target.dataset.confirm;'
              'if(m&&!confirm(m))e.preventDefault()});</script>')
    return (head + '<table><thead><tr><th>الوقت (UTC)</th><th>الاسم</th><th>الجهة</th><th>التواصل</th><th>المدينة</th>'
            '<th>الفئة</th><th>ما يريد</th><th>الصفحة</th><th>الحالة</th><th>القرار</th></tr></thead><tbody>' + ''.join(body)
            + '</tbody></table>' + script + '</html>')
