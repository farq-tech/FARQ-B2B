"""One spelling per city. Raw city names come from the atlas, OSM, Urbi, HudHud and other sources in many spellings
(«Mecca» / «Makkah Al Mukarramah» / «Makkah», «Yanbu`», «At Ta'if»). A name key drops Arabic-transliteration articles, quotes and
punctuation; an alias table joins true synonyms; each key gets one English and one Arabic name (the alias's, else the most frequent
spelling, with the most frequent Arabic-script name). Used inside build_golden.py on the raw values, so it is stable across rebuilds."""
import re
ALIAS = {  # key -> (English, Arabic)
 'riyadh': ('Riyadh', 'الرياض'), 'jeddah': ('Jeddah', 'جدة'), 'jiddah': ('Jeddah', 'جدة'),
 'mecca': ('Makkah', 'مكة المكرمة'), 'makkah': ('Makkah', 'مكة المكرمة'), 'makkahmukarramah': ('Makkah', 'مكة المكرمة'), 'mekkah': ('Makkah', 'مكة المكرمة'),
 'medina': ('Madinah', 'المدينة المنورة'), 'madinah': ('Madinah', 'المدينة المنورة'), 'madinahmunawwarah': ('Madinah', 'المدينة المنورة'), 'madina': ('Madinah', 'المدينة المنورة'),
 'dammam': ('Dammam', 'الدمام'), 'khobar': ('Al Khobar', 'الخبر'), 'dhahran': ('Dhahran', 'الظهران'),
 'hofuf': ('Al Ahsa', 'الأحساء'), 'ahsa': ('Al Ahsa', 'الأحساء'), 'hasa': ('Al Ahsa', 'الأحساء'), 'mubarraz': ('Al Mubarraz', 'المبرز'),
 'taif': ('Taif', 'الطائف'), 'yanbu': ('Yanbu', 'ينبع'), 'jubayl': ('Jubail', 'الجبيل'), 'jubail': ('Jubail', 'الجبيل'),
 'hail': ('Hail', 'حائل'), 'tabuk': ('Tabuk', 'تبوك'), 'buraydah': ('Buraydah', 'بريدة'), 'buraidah': ('Buraydah', 'بريدة'),
 'khamismushayt': ('Khamis Mushait', 'خميس مشيط'), 'khamismushait': ('Khamis Mushait', 'خميس مشيط'), 'abha': ('Abha', 'أبها'),
 'jizan': ('Jazan', 'جازان'), 'jazan': ('Jazan', 'جازان'), 'gizan': ('Jazan', 'جازان'), 'arar': ('Arar', 'عرعر'), 'sakaka': ('Sakaka', 'سكاكا'),
 'najran': ('Najran', 'نجران'), 'qatif': ('Qatif', 'القطيف'), 'bishah': ('Bisha', 'بيشة'), 'bisha': ('Bisha', 'بيشة'),
 'hafarbatin': ('Hafar Al Batin', 'حفر الباطن'), 'unaizah': ('Unaizah', 'عنيزة'), 'unayzah': ('Unaizah', 'عنيزة'),
 'diriyah': ('Diriyah', 'الدرعية'), 'kharj': ('Al Kharj', 'الخرج'), 'baha': ('Al Bahah', 'الباحة'), 'bahah': ('Al Bahah', 'الباحة'),
 'qunfudhah': ('Al Qunfudhah', 'القنفذة'), 'majmaah': ('Al Majmaah', 'المجمعة'), 'zulfi': ('Az Zulfi', 'الزلفي'), 'khafji': ('Al Khafji', 'الخفجي'),
 'rastannurah': ('Ras Tanura', 'رأس تنورة'), 'ula': ('AlUla', 'العلا'), 'rabigh': ('Rabigh', 'رابغ'), 'qurayyat': ('Al Qurayyat', 'القريات'),
}
ARTICLES = r'^(al|el|ad|ar|as|at|az|an|ash|adh|ath|aj)[\s\-]+'
def key(name):
    s = (name or '').lower().strip()
    s = re.sub(r"[`'’ʼ]", '', s)
    s = re.sub(ARTICLES, '', s)
    s = re.sub(r'\b(al|el|ad|ar|as|at|az|an|ash|adh)[\s\-]+', '', s)
    s = re.sub(r'\b(city|governorate|province|region)\b', '', s)
    return re.sub(r'[^a-z؀-ۿ]+', '', s)
