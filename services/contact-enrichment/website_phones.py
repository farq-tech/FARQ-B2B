"""Step 1: business phone numbers published on the business's own website.
Reads the home page and at most one contact page, respects robots.txt, one request at a time per site, identifies itself.
Keeps only Saudi numbers, with the page they came from. Never submits forms, never logs in, never follows social networks.
Rows with no website but a company e-mail use the e-mail's domain as the website (free mail providers are skipped).
Usage: python3 website_phones.py OUT.parquet [SAMPLE_SIZE]   (no sample size = every no-phone row with a website)"""
import concurrent.futures as cf, re, sys, time, urllib.parse, urllib.request, urllib.robotparser
import duckdb

P = '/Users/m4pro/farq-targeting/data/targets.parquet'
TWINS = '/Users/m4pro/farq-taxonomy-data/contacts/twin_phones.parquet'
UA = 'FarqContactCheck/0.1 (+https://pricing.farq.sa; business contact details only)'
SKIP_HOSTS = ('instagram.', 'facebook.', 'twitter.', 'x.com', 'tiktok.', 'snapchat.', 'linkedin.', 'youtube.', 'google.', 'goo.gl', 'linktr.ee', 'wa.me', 'whatsapp.')
FREE_MAIL = ('gmail.', 'googlemail.', 'hotmail.', 'outlook.', 'live.', 'msn.', 'yahoo.', 'ymail.', 'icloud.', 'me.com', 'mac.com', 'aol.',
             'protonmail.', 'proton.me', 'yandex.', 'mail.ru', 'gmx.', 'zoho.com', 'rocketmail.', 'windowslive.', 'inbox.', 'qq.com', '163.com')
DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
WA = re.compile(r'(?:wa\.me/|whatsapp\.com/send\?phone=|whatsapp://send\?phone=)\+?(\d{9,15})')
TEL = re.compile(r'tel:([+\d][\d\s().-]{7,20})')
TEXT = re.compile(r'(?<!\d)(?:\+|00)?(?:966[\s-]?)?0?(5\d|1[1-7]|9200)[\s-]?(\d[\s-]?){6,7}(?!\d)')
CONTACT = re.compile(r'href=["\']([^"\']*(?:contact|contact-us|تواصل|اتصل|call)[^"\']*)["\']', re.I)


def normalise(raw):
    d = re.sub(r'\D', '', raw.translate(DIGITS))
    if d.startswith('00'): d = d[2:]
    if d.startswith('966'): d = d[3:]
    if d.startswith('0'): d = d[1:]
    if re.fullmatch(r'(\d)\1{7,}|5(\d\d)\2{3}\d?|5?0{6,}\d*|5?123456\d*', d): return None, None   # placeholders: 0505050505, 500000000, 0512345678
    if re.fullmatch(r'5\d{8}', d): return '+966' + d, 'mobile'
    if re.fullmatch(r'1[1-7]\d{7}', d): return '+966' + d, 'landline'
    if re.fullmatch(r'9200\d{5}', d): return d, 'unified'
    return None, None


def fetch(url, limit=600_000, timeout=8):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if 'html' not in (r.headers.get('Content-Type') or 'html'): return '', r.geturl()
        return r.read(limit).decode(r.headers.get_content_charset() or 'utf-8', 'replace'), r.geturl()


def phones_in(html):
    found = {}
    for m in WA.finditer(html):
        n, kind = normalise(m.group(1))
        if n: found[n] = ('whatsapp_link', kind)
    for m in TEL.finditer(html):
        n, kind = normalise(m.group(1))
        if n and n not in found: found[n] = ('tel_link', kind)
    text = re.sub(r'<[^>]+>', ' ', html)
    for m in TEXT.finditer(text.translate(DIGITS)):
        n, kind = normalise(m.group(0))
        if n and n not in found: found[n] = ('page_text', kind)
    return found


def check(row):
    key, site = row
    url = site.strip()
    if not re.match(r'https?://', url): url = 'https://' + url
    host = urllib.parse.urlparse(url).netloc.lower()
    if not host or any(s in host for s in SKIP_HOSTS): return key, url, 'skipped_social', {}
    try:
        rp = urllib.robotparser.RobotFileParser(); rp.set_url(f'{urllib.parse.urlparse(url).scheme}://{host}/robots.txt')
        try:
            rq = urllib.request.Request(rp.url, headers={'User-Agent': UA})
            with urllib.request.urlopen(rq, timeout=5) as r: rp.parse(r.read(100_000).decode('utf-8', 'replace').splitlines())
        except Exception: rp.parse([])   # no robots.txt: allowed
        if not rp.can_fetch(UA, url): return key, url, 'robots_disallow', {}
        html, final = fetch(url)
        found = {n: (v[0], v[1], final) for n, v in phones_in(html).items()}
        if not any(v[1] == 'mobile' for v in found.values()):
            m = CONTACT.search(html)
            if m:
                contact = urllib.parse.urljoin(final, m.group(1))
                if urllib.parse.urlparse(contact).netloc.lower() == urllib.parse.urlparse(final).netloc.lower() and rp.can_fetch(UA, contact):
                    time.sleep(1)
                    html2, final2 = fetch(contact)
                    for n, v in phones_in(html2).items(): found.setdefault(n, (v[0], v[1], final2))
        return key, url, 'ok' if found else 'no_number', found
    except Exception as e:
        return key, url, 'unreachable:' + type(e).__name__, {}


def main(out, sample=None):
    db = duckdb.connect()
    free = ' and '.join(f"position('{d}' in dom)=0" for d in FREE_MAIL)
    q = f"""with base as (
          select t.poi_key, nullif(trim(t.website),'') web,
                 lower(regexp_extract(trim(t.email), '@([A-Za-z0-9.-]+\\.[A-Za-z]{{2,}})$', 1)) dom
          from read_parquet('{P}') t
          where nullif(trim(t.phone_norm),'') is null and nullif(trim(t.phone_raw),'') is null
            and coalesce(t.lifecycle_state,'') not in ('closed','permanently_closed') and coalesce(t.company_status,'') not in ('cancelled','inactive','ملغي','ملغى')
            and t.poi_key not in (select poi_key from read_parquet('{TWINS}')))
        select poi_key, coalesce(web, 'https://' || dom) site, case when web is not null then 'website' else 'email_domain' end origin from base
        where web is not null or (dom <> '' and {free})"""
    if sample: db.execute("select setseed(0.5)"); q += f" order by random() limit {int(sample)}"
    rows = db.execute(q).fetchall()
    origin = {k: o for k, _, o in rows}
    results = []
    with cf.ThreadPoolExecutor(8) as ex:
        for key, url, status, found in ex.map(check, [(k, s) for k, s, _ in rows]):
            if not found: results.append((key, origin[key], url, status, None, None, None, None))
            for n, (how, kind, page) in found.items(): results.append((key, origin[key], url, status, n, kind, how, page))
    db.execute("create table r (poi_key varchar, site_origin varchar, website varchar, status varchar, phone varchar, phone_kind varchar, found_by varchar, source_page varchar)")
    db.executemany("insert into r values (?,?,?,?,?,?,?,?)", results)
    db.execute(f"copy (select *, 'business_website' phone_source, current_date found_on from r) to '{out}' (format parquet)")
    s = db.execute("""select count(distinct poi_key), count(distinct poi_key) filter (where phone is not null),
        count(distinct poi_key) filter (where phone_kind='mobile'), count(distinct poi_key) filter (where found_by='whatsapp_link') from r""").fetchone()
    print({'sites': s[0], 'with_any_number': s[1], 'with_mobile': s[2], 'with_whatsapp_link': s[3]})
    print(db.execute("select split_part(status,':',1) st, count(distinct poi_key) from r group by 1 order by 2 desc").fetchall())
    print(db.execute("select site_origin, count(distinct poi_key), count(distinct poi_key) filter (where phone is not null) from r group by 1").fetchall())


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None)
