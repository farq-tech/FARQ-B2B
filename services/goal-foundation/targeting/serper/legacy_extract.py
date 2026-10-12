# Reused from farq-eval/google-search-method/serper_lookup.py; no key loading or API calls.

import re, unicodedata

YM = "966569576338"

GENERIC = set("""للكابلات كابلات الكابلات cables cable pipes pipe للانابيب انابيب الانابيب للمواسير مواسير للتجارة تجارة trading
industries industry للصناعات الصناعات للصناعة صناعة العربي العربية العربيه arabian arab saudi السعودية السعوديه السعودي الوطنية الوطنيه national
الخليج gulf للديكور decor للادوات الادوات الصحية الصحيه sanitary ceramic والسيراميك المحدودة المحدوده limited لانظمة انظمة systems
plastic بلاستيك factory manufacturing manufacturers electric الكهرباء للكهرباء tools materials مواد البناء building""".split())

PHONE_RE = re.compile(r"(?:\+?966[\s-]?|0)(?:5\d|1\d)[\s-]?\d{3}[\s-]?\d{4}|9200\d{5}|920\s?\d{3}\s?\d{3}|800\s?\d{3}\s?\d{4}")

SKIP_SITES = ("youmats", "facebook.", "instagram.", "linkedin.", "twitter.", "x.com", "youtube.", "tiktok.", "wikipedia.",
              "snapchat.", "google.", "yellowpages", "dalil", "daleli", "saudi-companies", "sa.kompass", "kompass", "infoisinfo", "aroundus", "2gis", "waze", "mapcarta", "daleeli", "saudiayp", "cybo.", "zawya", "bayut", "haraj",
              "amazon.", "noon.", "made-in-china", "alibaba", "indiamart", "opensooq", "argaam", "tadawul", "mubasher")

def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"[أإآ]", "ا", s); s = s.replace("ة", "ه").replace("ى", "ي")
    s = re.sub(r"\b(شركة|شركه|مصنع|مؤسسة|مؤسسه|مجموعة|مجموعه|company|co|ltd|llc|factory|est|group|the|for|of|and)\b", " ", s)
    return re.sub(r"[^\w]+", " ", s).strip()

def norm_phone(p):
    d = re.sub(r"\D", "", p)
    if d.startswith("0") and len(d) == 10:
        d = "966" + d[1:]
    elif len(d) == 9 and d[0] in "15":
        d = "966" + d
    return "+" + d if d.startswith("966") else d

def extract(slug, names, resp_list):
    best = {"phone": None, "whatsapp": None, "website": None, "address": None, "city": None, "maps_url": None,
            "rating": None, "source_url": None, "source": None, "confidence": None, "matched_title": None}
    keys = [norm(n) for n in names if n]

    def conf(title):
        t = norm(title)
        if any(k and (k == t or k in t or (t and t in k and len(t) > 4)) for k in keys):
            return "exact"
        toks = {w for w in " ".join(keys).split() if len(w) >= 3 and w not in GENERIC}
        tt = set(t.split())
        return "loose" if toks & tt else None

    cands = []
    for kind, resp in resp_list:
        if not resp or "error" in resp:
            continue
        for p in resp.get("places", []) or []:
            cands.append(("places", p.get("title"), p.get("phoneNumber"), p.get("website"), p.get("address"),
                          p.get("rating"), p.get("cid") and f"https://maps.google.com/?cid={p['cid']}"))
        kg = resp.get("knowledgeGraph")
        if kg:
            attrs = kg.get("attributes") or {}
            ph = next((v for k, v in attrs.items() if "هاتف" in k or "phone" in k.lower()), None)
            addr = next((v for k, v in attrs.items() if "عنوان" in k or "address" in k.lower()), None)
            cands.append(("knowledgeGraph", kg.get("title"), ph, kg.get("website"), addr, kg.get("rating"), None))
    for src, title, ph, web, addr, rating, maps in cands:
        c = conf(title or "")
        if not c:
            continue
        if ph and YM in re.sub(r"\D", "", ph):
            ph = None
        if best["confidence"] != "exact" or c == "exact":
            if (ph or web) and (best["phone"] is None or (c == "exact" and best["confidence"] != "exact")):
                best.update(phone=norm_phone(ph) if ph else best["phone"], website=web or best["website"], address=addr,
                            rating=rating, maps_url=maps, source=src, confidence=c, matched_title=title)
    # organic: official site + phone in snippets
    for kind, resp in resp_list:
        if not resp or "error" in resp:
            continue
        for o in (resp.get("organic") or [])[:8]:
            link = o.get("link", ""); title = o.get("title", ""); snip = o.get("snippet", "")
            c = conf(title)
            dom = re.sub(r"^https?://(www\.)?", "", link).split("/")[0]
            if not best["website"] and c and not any(s in dom for s in SKIP_SITES):
                best["website"] = "https://" + dom; best["source_url"] = link
                best["confidence"] = best["confidence"] or c
            if not best["phone"] and c:
                for m in PHONE_RE.findall(snip + " " + title):
                    if YM not in re.sub(r"\D", "", m):
                        best["phone"] = norm_phone(m); best["source_url"] = best["source_url"] or link
                        best["source"] = best["source"] or "organic_snippet"; best["confidence"] = best["confidence"] or c
                        break
            if "wa.me" in link and not best["whatsapp"] and YM not in link:
                best["whatsapp"] = link
    if best["phone"] and re.sub(r"\D", "", best["phone"]).startswith("9665"):
        best["whatsapp"] = best["whatsapp"] or ("https://wa.me/" + re.sub(r"\D", "", best["phone"]))
    if best["address"]:
        m = re.search(r"(الرياض|جدة|الدمام|الخبر|مكة|المدينة|الجبيل|ينبع|الطائف|القصيم|بريدة|حائل|تبوك|أبها|جازان|الخرج|الأحساء|Riyadh|Jeddah|Dammam|Khobar|Jubail|Yanbu|Makkah|Mecca|Madinah|Medina|Taif|Buraydah|Qassim|Hail|Tabuk|Abha|Jazan|Kharj|Hofuf|Al Ahsa)", best["address"], re.I)
        best["city"] = m.group(1) if m else None
    return best
