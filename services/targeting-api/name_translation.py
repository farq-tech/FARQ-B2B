"""An English name for a business that has only an Arabic one, learned from the directory itself.

Letter-by-letter transliteration reads badly («النور» → «Al Nwr», «جامع الراجحي» → «Jama Al Rajhy»), so a name is
written the way the directory already writes it, in this order:
1. **known_name:** the same Arabic name (normalized) has one usual English name among the businesses that carry both.
2. **translated:** word by word. A business word comes from the Farq taxonomy and a core list («صيدلية» → «Pharmacy»,
   «للتجارة» → «Trading»), and is placed after the proper name as English writes it («صيدلية النور» → «Al Noor Pharmacy»).
   A proper name comes from how the directory's pairs spell it («النور» → «Al Noor», «الراجحي» → «Al Rajhi»).
3. **transliterated:** a word neither source knows is spelled with vowel rules, the last resort; the result says so.

`evaluate` measures each method on businesses whose English name is known but held out of the learning, so the
quality is a number before the names are used. Learning reads names only; it keeps no record or key.
"""
import collections
import re
import zlib

DIACRITICS = re.compile(r'[ً-ٰٟـ]')
AR_WORD = re.compile(r'[ء-ي٠-٩]+')
EN_WORD = re.compile(r"[A-Za-z][A-Za-z'&.\-]*|\d+")

# business words the taxonomy does not hold as a single word; the taxonomy's own words are added by Translator
CORE = {
    'صيدليه': 'Pharmacy', 'صيدليات': 'Pharmacies', 'مطعم': 'Restaurant', 'مطاعم': 'Restaurants', 'مقهي': 'Cafe', 'كافيه': 'Cafe',
    'كوفي': 'Coffee', 'قهوه': 'Coffee', 'مخبز': 'Bakery', 'مخابز': 'Bakeries', 'حلويات': 'Sweets', 'بقاله': 'Grocery',
    'تموينات': 'Supplies', 'سوبرماركت': 'Supermarket', 'ماركت': 'Market', 'سوق': 'Market', 'اسواق': 'Markets', 'صالون': 'Salon',
    'حلاق': 'Barber', 'مغسله': 'Laundry', 'ورشه': 'Workshop', 'معرض': 'Showroom', 'مكتب': 'Office', 'مركز': 'Center',
    'مستشفي': 'Hospital', 'مستوصف': 'Clinic', 'عياده': 'Clinic', 'عيادات': 'Clinics', 'مجمع': 'Complex', 'مدرسه': 'School',
    'مدارس': 'Schools', 'روضه': 'Kindergarten', 'جامع': 'Mosque', 'مسجد': 'Mosque', 'شركه': 'Company', 'مؤسسه': 'Est.',
    'موسسه': 'Est.', 'مصنع': 'Factory', 'مصانع': 'Factories', 'فندق': 'Hotel', 'شقق': 'Apartments', 'مفروشه': 'Furnished',
    'محل': 'Shop', 'محلات': 'Shops', 'متجر': 'Store', 'مستودع': 'Warehouse', 'مستودعات': 'Warehouses', 'بنك': 'Bank',
    'مصرف': 'Bank', 'نادي': 'Club', 'جيم': 'Gym', 'عطور': 'Perfumes', 'ملابس': 'Clothes', 'ذهب': 'Gold', 'مجوهرات': 'Jewelry',
    'اثاث': 'Furniture', 'سيارات': 'Cars', 'قطع': 'Parts', 'غيار': 'Spare', 'كهرباء': 'Electricity', 'كهربائيه': 'Electrical',
    'مقاولات': 'Contracting', 'تجاره': 'Trading', 'التجاره': 'Trading', 'التجاريه': 'Trading', 'المقاولات': 'Contracting',
    'العامه': 'General', 'المحدوده': 'Ltd', 'الدوليه': 'International', 'العالميه': 'International', 'الطبي': 'Medical',
    'الطبيه': 'Medical', 'مطبخ': 'Kitchen', 'مشويات': 'Grills', 'بوفيه': 'Buffet', 'عصيرات': 'Juices', 'عصائر': 'Juices',
}
STOP_EN = {'and', 'the', 'of', 'for', 'est', 'est.', 'co', 'co.', 'company', 'ltd', 'llc'}
AR2EN = {'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z', 'س': 's',
         'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm',
         'ن': 'n', 'ه': 'h', 'ء': '', 'ئ': 'e', 'ؤ': 'o'}


def key(word):
    """A matching key: no diacritics or tatweel, one alef, ى as ي, ة as ه."""
    w = DIACRITICS.sub('', word)
    w = re.sub('[أإآٱ]', 'ا', w)
    return w.replace('ى', 'ي').replace('ة', 'ه')


def ar_tokens(name):
    return AR_WORD.findall(name or '')


def en_tokens(name):
    """English words with «Al»/«El» joined to the word after it, so «Al Noor» lines up with «النور»."""
    words, out = EN_WORD.findall(name or ''), []
    i = 0
    while i < len(words):
        if words[i].lower() in {'al', 'el', 'al-', 'el-'} and i + 1 < len(words):
            out.append(f'Al {words[i + 1]}')
            i += 2
            continue
        m = re.match(r'^(?:al|el)-(\w+)$', words[i], re.I)
        out.append(f'Al {m.group(1)}' if m else words[i])
        i += 1
    return out


COMMON = {'محمد': 'Mohammed', 'احمد': 'Ahmed', 'علي': 'Ali', 'بن': 'Bin', 'ابن': 'Ibn', 'عبدالله': 'Abdullah',
          'عبدالرحمن': 'Abdulrahman', 'عبدالعزيز': 'Abdulaziz', 'خالد': 'Khalid', 'فهد': 'Fahad', 'سلطان': 'Sultan',
          'ابو': 'Abu', 'ام': 'Um', 'عمر': 'Omar', 'حسن': 'Hassan', 'حسين': 'Hussein', 'يوسف': 'Yousef', 'ابراهيم': 'Ibrahim',
          'مكه': 'Makkah', 'المدينه': 'Al Madinah', 'الرياض': 'Al Riyadh', 'جده': 'Jeddah', 'الدمام': 'Al Dammam',
          'الحرمين': 'Al Haramain', 'زمزم': 'Zamzam', 'السلام': 'Al Salam', 'الخير': 'Al Khair', 'النهدي': 'Al Nahdi'}
VOWELS = set('اويع')


def transliterate_word(word):
    """Spell one Arabic word with vowel rules (the last resort): «النور» → «Al Noor», «سعيد» → «Saeed»."""
    w = key(word)
    if w in COMMON:
        return COMMON[w]
    if w.startswith('عبد') and len(w) > 4:   # «عبدالكريم» → «Abdul Kareem»
        return 'Abdul ' + transliterate_word(w[3:].removeprefix('ال'))
    article = ''
    if w.startswith('ال') and len(w) > 3:
        article, w = 'Al ', w[2:]
    if w in COMMON:
        return article + COMMON[w]
    # Arabic leaves short vowels unwritten; the commonest is «a»: after a first consonant followed by another, and
    # between the two middle consonants of a four-letter word with no long vowel («زمزم» → «Zamzam»)
    vowel_after = set()
    if len(w) >= 2 and w[0] not in VOWELS and w[1] not in VOWELS:
        vowel_after.add(0)
    if len(w) == 4 and not VOWELS & set(w):
        vowel_after.add(2)
    out = []
    for i, c in enumerate(w):
        prev = w[i - 1] if i else ''
        nxt = w[i + 1] if i + 1 < len(w) else ''
        if c == 'ا':
            out.append('a' if prev != 'ا' else '')
        elif c == 'ع':
            out.append('a' if not prev or prev not in 'اوي' else '')
        elif c == 'و':
            out.append('w' if i == 0 or nxt == 'ا' else 'oo')
        elif c == 'ي':
            out.append('y' if i == 0 else 'iy' if nxt == 'ا' else 'ee' if nxt else 'i')
        elif c == 'ه' and not nxt and i:
            out.append('ah' if prev not in 'اوي' else 'h')
        else:
            out.append(AR2EN.get(c, c if c.isascii() else ''))
        if i in vowel_after:
            out.append('a')
    s = ''.join(out)
    s = re.sub(r'(.)\1{2,}', r'\1\1', s)
    return (article + s[:1].upper() + s[1:]) if s else ''


class Translator:
    def __init__(self, business_words=None):
        self.words = {key(k): v for k, v in {**CORE, **(business_words or {})}.items()}
        self.business_en = {w.lower() for v in self.words.values() for w in v.split()} | STOP_EN
        self.exact, self.proper = {}, {}

    def _business(self, token):
        """The English of a business word, also with a «لل» / «ل» / «و» / «ال» prefix («للتجارة», «والمقاولات»)."""
        k = key(token)
        if k in self.words:
            return self.words[k]
        for prefix, add in (('لل', 'ال'), ('ل', ''), ('و', ''), ('ال', '')):
            if k.startswith(prefix) and len(k) > len(prefix) + 2:
                rest = add + k[len(prefix):]
                if rest in self.words:
                    return self.words[rest]
                if rest[2:] in self.words and rest.startswith('ال'):
                    return self.words[rest[2:]]
        return None

    def learn(self, pairs, min_count=3, min_share=0.6):
        """pairs: (Arabic name, English name) of businesses that carry both."""
        exact, proper = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
        for ar, en in pairs:
            ta, te = ar_tokens(ar), en_tokens(en)
            if not ta or not te:
                continue
            exact[' '.join(key(t) for t in ta)][' '.join(te)] += 1
            names_ar = [t for t in ta if not self._business(t)]
            names_en = [w for w in te if w.lower() not in self.business_en]
            if 1 <= len(names_ar) <= 3 and len(names_ar) == len(names_en):
                for a, e in zip(names_ar, names_en):
                    proper[key(a)][e] += 1
        pick = lambda counter: next(((v, n) for v, n in counter.most_common(1) if n >= min_count and n / sum(counter.values()) >= min_share), None)
        self.exact = {k: p[0] for k, c in exact.items() if (p := pick(c))}
        self.proper = {k: p[0] for k, c in proper.items() if (p := pick(c))}
        return self

    def translate(self, ar):
        """(English name, method), method one of known_name / translated / partly_transliterated / transliterated; ('', '') with no Arabic word."""
        tokens = ar_tokens(ar)
        if not tokens:
            return '', ''
        whole = ' '.join(key(t) for t in tokens)
        if whole in self.exact:
            return self.exact[whole], 'known_name'
        names, business, spelled = [], [], 0
        for t in tokens:
            word = self._business(t)
            if word:
                business.append(word)
            elif key(t) in self.proper:
                names.append(self.proper[key(t)])
            else:
                names.append(transliterate_word(t))
                spelled += 1
        en = re.sub(r'\s+', ' ', ' '.join(names + list(dict.fromkeys(business)))).strip()
        method = 'translated' if not spelled else 'transliterated' if spelled == len(tokens) else 'partly_transliterated'
        return en, method


def _norm_en(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower().replace('al ', 'al'))


def evaluate(pairs, business_words=None, holdout=20):
    """Each method's quality on held-out businesses (1 in `holdout` names, by a hash of the Arabic name).

    exact: the same letters as the known English name; close: at least half of its words."""
    train = [p for p in pairs if zlib.crc32(p[0].encode()) % holdout]
    test = [p for p in pairs if not zlib.crc32(p[0].encode()) % holdout]
    translator = Translator(business_words).learn(train)
    scores = collections.defaultdict(lambda: [0, 0, 0])
    for ar, en in test:
        guess, method = translator.translate(ar)
        if not method:
            continue
        truth = {w.lower() for w in en_tokens(en)}
        words = {w.lower() for w in en_tokens(guess)}
        s = scores[method]
        s[0] += 1
        s[1] += _norm_en(guess) == _norm_en(' '.join(en_tokens(en)))
        s[2] += bool(truth) and len(truth & words) / len(truth) >= 0.5
    return {m: {'n': n, 'exact': round(e / n, 4) if n else None, 'close': round(c / n, 4) if n else None}
            for m, (n, e, c) in sorted(scores.items())}
