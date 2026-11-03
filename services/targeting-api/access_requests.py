"""Requests for an Atlas account («اطلب حساباً»), kept for the owner to review by hand.

Atlas (apps/atlas/app/api/access-request/route.ts) forwards one validated request with the service token; this module
checks it again, appends it to `access_requests.jsonl` in the service's writable runtime folder (FARQ_TARGETING_RUNTIME_DIR,
the same folder as send_log.csv) and lists them for the owner's console (GET /access-requests behind the console
password). Nothing here sends an email or a message, and nothing creates an account: the owner reads the list and
decides. Contact details never leave this file except to the owner's console.

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


def render_html(rows):
    """The owner's list, newest first, every value escaped. A page of its own inside the console, read only."""
    head = ('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>طلبات الحسابات</title>'
            '<style>body{font-family:-apple-system,Tahoma;background:#0f1115;color:#e8eaf0;margin:24px}'
            'table{border-collapse:collapse;width:100%}th,td{border:1px solid #2a2f3a;padding:8px;text-align:start;vertical-align:top}'
            'th{background:#171a21}td.c{direction:ltr;text-align:end}</style>'
            f'<h1>طلبات الحسابات ({len(rows)})</h1>'
            '<p>للمراجعة اليدوية. لا يُرسل شيء من هنا، ولا يُنشأ حساب تلقائياً.</p>')
    if not rows:
        return head + '<p>لا طلبات بعد.</p></html>'
    cells = ''.join(
        '<tr>' + ''.join(f'<td{" class=c" if key in ("contact", "received_at") else ""}>{html.escape(str(value or "—"))}</td>' for key, value in (
            ('received_at', row.get('received_at')), ('name', row.get('name')), ('company', row.get('company')),
            ('contact', row.get('contact')), ('city', row.get('city')), ('category', CATEGORIES.get(row.get('category'), row.get('category'))),
            ('purpose', row.get('purpose')), ('next', row.get('next')))) + '</tr>'
        for row in reversed(rows))
    return (head + '<table><thead><tr><th>الوقت (UTC)</th><th>الاسم</th><th>الجهة</th><th>التواصل</th><th>المدينة</th>'
            '<th>الفئة</th><th>ما يريد</th><th>الصفحة</th></tr></thead><tbody>' + cells + '</tbody></table></html>')
