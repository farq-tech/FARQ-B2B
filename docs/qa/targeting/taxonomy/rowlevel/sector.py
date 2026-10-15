"""Sector of schools, universities, institutes, hospitals and clinics: government / private / unknown.
Read-only on the directory; writes poi_key -> sector, evidence. Evidence is a word in the business name only (category labels such as «مدارس» say nothing about the sector)."""
import duckdb, re, sys
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
C = '/Users/m4pro/farq-taxonomy-data/poi_taxonomy.parquet'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/Users/m4pro/farq-taxonomy-data/poi_sector.parquet'
SUBS = ('edu.school', 'edu.kindergarten', 'edu.nursery', 'edu.university', 'edu.vocational', 'edu.training_center', 'edu.language_center',
        'edu.quran_center', 'health.hospital', 'health.clinic', 'health.dental', 'health.lab', 'health.radiology', 'health.physio', 'health.residential_care')
TR = str.maketrans('أإآةىؤئ', 'اااهيوي')
def norm(s):
    s = (s or '').lower().translate(TR); s = re.sub('[ً-ْـ]', '', s)
    return ' ' + re.sub(r'\s+', ' ', re.sub(r'[^\wء-ي]+', ' ', s)).strip() + ' '

PRIVATE = [r' (ال)?اهلي(ه|ة)? ', r' ahli(a|ah|ya|yah)? ', r' al ?ahl(i|ia|iah|iya) ', r' private ', r' international ', r' (ال)?عالمي(ه)? ',
           r' دله ', r' dallah ', r' (ال)?حبيب ', r' habib ', r' (ال)?مواسا(ه|ة) ', r' mouwasat ', r' (ال)?سعودي (ال)?الماني ', r' saudi german ',
           r' (ال)?حمادي ', r' hammadi ', r' فقيه ', r' fakeeh ', r' (ال)?مانع ', r' (ال)?موسي ', r' رعايه ', r' care ', r' مستوصف ', r' مجمع (طبي|عيادات|.* (ال)?طبي) ', r' polyclinic ',
           r' عياد(ه|ات) ', r' clinic(s)? ', r' جامعه (ال)?فيصل ', r' alfaisal ', r' اليمامه ', r' دار (ال)?علوم ', r' دار (ال)?حكمه ', r' عفت ', r' (ال)?معرفه ',
           r' رياض (ال)?علم ', r' (ال)?اعمال و(ال)?تكنولوجيا ', r' academy ', r' اكاديمي(ه)? ', r' مركز تدريب ', r' training center ', r' معهد لغات ']
GOV = [r' (مستشفي|مستشفى|مدينه|مجمع|جامعه|كليه|مركز) (ال)?(ملك|امير|اميره) ', r' king ', r' prince(ss)? ', r' (ال)?حرس (ال)?وطني ', r' national guard ',
       r' (ال)?عسكري ', r' military ', r' (ال)?قوات (ال)?مسلحه ', r' armed forces ', r' قوي (ال)?امن ', r' security forces ', r' وزاره ', r' ministry ', r' moh ',
       r' (ال)?رعايه (ال)?صحيه (ال)?اوليه ', r' primary (health )?care ', r' مركز صحي ', r' health center ', r' مستشفي .* (ال)?عام ', r' general hospital ',
       r' (ال)?ولاده ', r' maternity ', r' (ال)?صحه (ال)?نفسيه ', r' تجمع ', r' cluster ', r' (ال)?مؤسسه (ال)?عامه ', r' (ال)?تدريب (ال)?تقني ', r' tvtc ',
       r' (ال)?كليه (ال)?تقنيه ', r' technical college ', r' (ال)?معهد (ال)?علمي ', r' (ال)?معهد (ال)?تقني ', r' اداره (ال)?تعليم ',
       r' جامعه (ام القري|طيبه|القصيم|حائل|جازان|نجران|تبوك|الباحه|الجوف|الحدود الشماليه|بيشه|المجمعه|شقراء|الطائف|جده|الامام|الملك|الاميره|الامير سطام|الامير سلطان بن عبدالعزيز|الاسلاميه|الدمام) ',
       r' (umm al qura|taibah|qassim|hail|jazan|najran|tabuk|baha|jouf|northern border|bisha|majmaah|shaqra|taif|imam) university ',
       r' (ال)?(ابتدائي|متوسط|ثانوي)(ه)? (ال)?(اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|حادي|عشر|عشرون|ثلاثون|اربعون|خمسون|ستون|سبعون|ثمانون|تسعون|مائه|مئه)',
       r' (ال)?(اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|حادي)(ه)? (و)?(ال)?(عشر|عشرون|ثلاثون|اربعون|خمسون|ستون|سبعون|ثمانون|تسعون|بعد)? ?(ال)?(ابتدائي|ايتدائي|متوسط|ثانوي)(ه)? ',
       r' goverment | government | حكومي(ه)? ', r' (ال)?روضه \d+ ', r' (ابتدائي|متوسط|ثانوي)(ه)? \d+ ', r' \d+ (ال)?(ابتدائي|متوسط|ثانوي)(ه)? ', r' (elementary|intermediate|secondary|primary|medium) (school )?(no )?\d+ ', r' تحفيظ ']
PRIV = [re.compile(p) for p in PRIVATE]; GOVR = [re.compile(p) for p in GOV]

LEVEL = re.compile(r' (مدرسه|ابتدائيه|ابتدائي|ايتدائيه|متوسطه|ثانويه|الابتدائيه|المتوسطه|الثانويه|للبنين|للبنات|الطفوله المبكره|primary|elementary|intermediate|secondary|medium|high school|kindergarten|روضه|مجمع تعليمي) ')
def sector(text, sub=None):
    g = next((p.pattern.strip() for p in GOVR if p.search(text)), None)
    p = next((p.pattern.strip() for p in PRIV if p.search(text)), None)
    if g and not p: return 'government', g
    if p and not g: return 'private', p
    if g and p:   # «مستشفى الملك فهد الجامعي» vs «مجمع» – a named government body wins over a generic private word
        strong_private = re.search(r'اهلي|ahli|private|international|عالمي|دله|dallah|حبيب|habib|مواسا|mouwasat|الماني|german|حمادي|hammadi|فقيه|fakeeh', text)
        return ('private', p) if strong_private else ('government', g)
    # Most Saudi schools are public. A school name with a level word and no private marker defaults to government (evidence says so).
    if sub in ('edu.school', 'edu.kindergarten', 'edu.quran_center') and LEVEL.search(text): return 'government', 'default: school level name, no private marker'
    return 'unknown', ''

db = duckdb.connect()
rows = db.execute(f"""select c.poi_key, c.sub_id, coalesce(t.name_ar,'')||' '||coalesce(t.name_en,'')
    from read_parquet('{C}') c join read_parquet('{P}') t using(poi_key) where c.sub_id in (select unnest(?::varchar[]))""", [list(SUBS)]).fetchall()
out = [(k, s, *sector(norm(text), s)) for k, s, text in rows]
db.execute("create table s (poi_key varchar, sub_id varchar, sector varchar, evidence varchar)")
db.executemany("insert into s values (?,?,?,?)", out)
db.execute(f"copy s to '{OUT}' (format parquet)")
for r in db.execute("select sub_id, count(*) n, count(*) filter (where sector='government') gov, count(*) filter (where sector='private') priv, count(*) filter (where sector='unknown') unk from s group by 1 order by n desc").fetchall(): print(r)
