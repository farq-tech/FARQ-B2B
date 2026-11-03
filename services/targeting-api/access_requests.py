"""Requests for an Atlas account («اطلب حساباً»), kept for the owner to review by hand.

Atlas (apps/atlas/app/api/access-request/route.ts) forwards one validated request with the service token; this module
checks it again, appends it to `access_requests.jsonl` in the service's writable runtime folder (FARQ_TARGETING_RUNTIME_DIR,
the same folder as send_log.csv) and lists them for the owner's console (GET /access-requests behind the console
password). The owner's decisions (reviewed, approved, rejected, with a note) are appended to
`access_request_reviews.jsonl` beside it, so the request lines are never rewritten and every decision stays as a trail.
Nothing here sends an email or a message, and nothing creates an account: approving records the decision, and the
owner makes the account by hand in Farq (there is no admin path that creates one). Contact details never leave this file except to the owner's console.

Limits, so a script cannot fill the disk: the same contact within 24 hours is stored once (the second answer is still
«received»), at most DAILY_CAP requests a day in total, and a fixed size for every field.
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
NOTE_MAX = 500
DAILY_CAP = 300
SAME_CONTACT_WINDOW = 24 * 3600
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


def _path(folder):
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, FILE_NAME)


def read_all(folder):
    """Every stored request, oldest first; a line that does not read back is skipped."""
    path = os.path.join(folder, FILE_NAME)
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and row.get('id'):
                rows.append(row)
    return rows


def contact_key(value):
    """The contact as a hash: what the duplicate check compares, so the check needs no second copy of it."""
    return hashlib.sha256(('farq-access-v1:' + value).encode()).hexdigest()[:32]


def submit(folder, body, known_cities=None, now=None):
    """Validates and stores one request. Returns (status, answer): 201 stored, 200 the same contact already asked
    today (nothing new is stored), 400 with the fields that do not pass, 429 when today's cap is reached."""
    record, errors = validate(body, known_cities)
    if errors:
        return 400, {'ok': False, 'error': 'INVALID', 'fields': errors}
    now = time.time() if now is None else now
    key = contact_key(record['contact'])
    with _LOCK:
        rows = read_all(folder)
        if any(row.get('contact_key') == key and now - float(row.get('ts', 0)) < SAME_CONTACT_WINDOW for row in rows):
            return 200, {'ok': True, 'duplicate': True}
        if sum(1 for row in rows if now - float(row.get('ts', 0)) < 86400) >= DAILY_CAP:
            return 429, {'ok': False, 'error': 'DAILY_CAP'}
        stored = {'id': secrets.token_hex(8), 'ts': now, 'received_at': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now)),
                  'status': 'new', 'contact_key': key, **record}
        with open(_path(folder), 'a', encoding='utf-8') as handle:
            handle.write(json.dumps(stored, ensure_ascii=False) + '\n')
    return 201, {'ok': True, 'id': stored['id']}


def read_reviews(folder):
    """Every decision, oldest first (an append-only trail: a later decision on a request replaces the earlier one)."""
    path = os.path.join(folder, REVIEWS_NAME)
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict) and row.get('id') and row.get('status') in REVIEW_STATUSES:
                out.append(row)
    return out


def with_reviews(folder):
    """The requests, oldest first, each with its latest decision: status, note and when (status 'new' before any)."""
    latest = {}
    for review in read_reviews(folder):
        latest[review['id']] = review
    rows = []
    for row in read_all(folder):
        review = latest.get(row['id'])
        rows.append({**row, 'status': review['status'], 'note': review.get('note') or '', 'reviewed_at': review.get('reviewed_at')} if review
                    else {**row, 'status': 'new', 'note': '', 'reviewed_at': None})
    return rows


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
    if not isinstance(request_id, str) or not re.fullmatch(r'[0-9a-f]{16}', request_id):
        return 404, {'ok': False, 'error': 'NOT_FOUND'}
    now = time.time() if now is None else now
    with _LOCK:
        if not any(row['id'] == request_id for row in read_all(folder)):
            return 404, {'ok': False, 'error': 'NOT_FOUND'}
        entry = {'id': request_id, 'status': status, 'note': clean, 'ts': now,
                 'reviewed_at': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now))}
        with open(os.path.join(folder, REVIEWS_NAME), 'a', encoding='utf-8') as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + '\n')
    return 200, {'ok': True, 'status': status}


def render_html(rows, saved=False):
    """The owner's list (with_reviews), newest first, every value escaped, with a decision form per request (status and
    note) posting to /access-requests/review in the same console. Nothing on this page sends anything."""
    unread = sum(1 for row in rows if row.get('status', 'new') == 'new')
    head = ('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>طلبات الحسابات</title>'
            '<style>body{font-family:-apple-system,Tahoma;background:#0f1115;color:#e8eaf0;margin:24px}a{color:#93c5fd}'
            'table{border-collapse:collapse;width:100%}th,td{border:1px solid #2a2f3a;padding:8px;text-align:start;vertical-align:top}'
            'th{background:#171a21}td.c{direction:ltr;text-align:end}tr.new td:first-child{border-inline-start:4px solid #3b82f6}'
            '.s{display:inline-block;padding:2px 8px;border-radius:999px;background:#2a2f3a;font-size:13px}.s.new{background:#1d4ed8}'
            '.s.approved{background:#166534}.s.rejected{background:#7f1d1d}form{display:flex;flex-direction:column;gap:6px;min-width:200px}'
            'label{display:flex;flex-direction:column;gap:2px}'
            'select,textarea,button{font:inherit;border-radius:6px;border:1px solid #2a2f3a;background:#0f1115;color:#e8eaf0;padding:6px}'
            'button{background:#3b82f6;border:0;cursor:pointer}.ok{color:#86efac}</style>'
            f'<p><a href="/">← لوحة الاستهداف</a></p><h1>طلبات الحسابات ({len(rows)})</h1>'
            f'<p>جديدة لم يُتخذ فيها قرار: <strong>{unread}</strong></p>'
            + ('<p class="ok" role="status">حُفظ القرار.</p>' if saved else '') +
            '<p>للمراجعة اليدوية. لا يُرسل شيء من هنا. الموافقة تسجّل القرار فقط: الحساب يُنشأ يدوياً في فرق، '
            'ثم تتواصل مع صاحب الطلب بنفسك.</p>')
    if not rows:
        return head + '<p>لا طلبات بعد.</p></html>'

    def e(value):
        return html.escape(str(value or '—'))

    def options(current):
        # a new request starts on «اختر القرار», so saving without choosing is refused instead of marking it reviewed
        pick = '<option value="" selected disabled>اختر القرار</option>' if current not in REVIEW_STATUSES else ''
        return pick + ''.join(f'<option value="{key}"{" selected" if key == current else ""}>{label}</option>' for key, label in REVIEW_STATUSES.items())

    body = []
    for row in reversed(rows):
        status = row.get('status') if row.get('status') in STATUS_LABELS else 'new'
        decided = f'<br><small>{e(row.get("reviewed_at"))}</small>' if row.get('reviewed_at') else ''
        note = f'<br>{e(row.get("note"))}' if row.get('note') else ''
        form = ('<form method="post" action="/access-requests/review">'
                f'<input type="hidden" name="id" value="{html.escape(str(row.get("id", "")))}">'
                f'<label>القرار<select name="status" required>{options(status)}</select></label>'
                f'<label>ملاحظة<textarea name="note" maxlength="{NOTE_MAX}" rows="2">{html.escape(row.get("note") or "")}</textarea></label>'
                '<button type="submit">احفظ القرار</button></form>')
        cells = [
            (True, e(row.get('received_at'))), (False, e(row.get('name'))), (False, e(row.get('company'))), (True, e(row.get('contact'))),
            (False, e(row.get('city'))), (False, e(CATEGORIES.get(row.get('category'), row.get('category')))), (False, e(row.get('purpose'))),
            (True, e(row.get('next'))), (False, f'<span class="s {status}">{STATUS_LABELS[status]}</span>{decided}{note}'), (False, form)]
        body.append(f'<tr class="{status}">' + ''.join(f'<td{" class=c" if ltr else ""}>{value}</td>' for ltr, value in cells) + '</tr>')
    return (head + '<table><thead><tr><th>الوقت (UTC)</th><th>الاسم</th><th>الجهة</th><th>التواصل</th><th>المدينة</th>'
            '<th>الفئة</th><th>ما يريد</th><th>الصفحة</th><th>الحالة</th><th>القرار</th></tr></thead><tbody>' + ''.join(body) + '</tbody></table></html>')
