/*
 * Popular market names («الاسم الدارج») for trade clusters, and the words people say when they ask for things.
 *
 * Curated by hand and kept small. Only names we are sure of are active; anything we are not sure of — the place,
 * the district it sits in, or the trade it is known for — stays in MARKET_NAMES_TODO for the owner to confirm and is
 * never shown. A name is keyed by city + district (or street) + trade: a cluster gets it only when all three match.
 */

export type MarketName = {
  /** what people call it */
  name: string
  /** city names as the targeting service writes them (City.en / City.ar) */
  city: string[]
  /** the cluster's district_ar must equal one of these (after dropping «حي») */
  district?: string[]
  /** or its street_ar must contain one of these */
  street?: string[]
  /** trade words matched against the cluster's trade (sub_ar / label_ar) or the request; label = the trade suffix shown */
  trades: { match: RegExp; label: string; term: string }[]
}

export const MARKET_NAMES: MarketName[] = [
  {
    // Souq Al-Zal, the old market in Al-Dirah (central Riyadh): carpets, bisht, fabrics, perfume and incense.
    name: 'سوق الزل',
    city: ['Riyadh', 'الرياض'],
    district: ['الديرة'],
    trades: [
      { match: /أقمش|قماش|منسوجات|خياط/, label: 'للأقمشة', term: 'أقمشة' },
      { match: /سجاد|موكيت|زوالي/, label: 'للسجاد', term: 'سجاد' },
      { match: /بشوت|بشت|مشالح|ملابس رجالي/, label: 'للبشوت', term: 'بشوت' },
      { match: /عطور|عطر|بخور|عود/, label: 'للعطور والبخور', term: 'عطور وبخور' },
    ],
  },
  {
    // Al-Sulay industrial area (east Riyadh): car workshops, spare parts and metal workshops.
    name: 'صناعية السلي',
    city: ['Riyadh', 'الرياض'],
    district: ['السلي'],
    trades: [
      { match: /قطع غيار|ورش|ورشة|سيارات|ميكانيك|كهرباء سيارات|سمكرة/, label: '', term: 'قطع غيار سيارات' },
      { match: /حداد|لحام|ألمنيوم|المنيوم|خراط/, label: '', term: 'حدادة وألمنيوم' },
    ],
  },
]

/**
 * TODO(owner): names given in the brief or known by ear, not confirmed here. Each needs: the exact city, the
 * district as the directory writes it (or the street), and the trade it is known for. Confirm, then move to MARKET_NAMES.
 */
export const MARKET_NAMES_TODO: { name: string; city: string; question: string }[] = [
  { name: 'شارع العطايف', city: 'الرياض', question: 'أي حي في البيانات (الديرة؟) وأي نشاط يُعرف به؟' },
  { name: 'سوق الديرة', city: 'الرياض', question: 'هل المقصود أسواق الديرة حول المصمك؟ وأي نشاط (ذهب، عطور، تحف)؟' },
  { name: 'الحراج (حراج ابن قاسم)', city: 'الرياض', question: 'اسم الحي في البيانات، والنشاط (أثاث وأجهزة مستعملة؟)' },
  { name: 'شارع خالد بن الوليد للسباكة', city: 'الرياض؟', question: 'أي مدينة وأي حي؟ في بيانات الاختبار يقع في حي الملك فيصل؛ نحتاج تأكيد أنه نفس الشارع المعروف بالسباكة' },
  { name: 'سوق الكهرباء', city: '؟', question: 'أي مدينة وأي حي أو شارع؟' },
  { name: 'البطحاء', city: 'الرياض', question: 'هل يُعرض كسوق جملة (إلكترونيات، جوالات، ملابس)؟ وأي نشاط بالضبط؟' },
  { name: 'البلد (جدة التاريخية)', city: 'جدة', question: 'اسم الحي في البيانات (البلد؟) والأسواق المقصودة (العلوي، الندى) ونشاطها' },
  { name: 'سوق الصواريخ', city: 'جدة', question: 'اسم الحي في البيانات والنشاط' },
]

const normDistrict = (s: string | null | undefined) => String(s || '').trim().replace(/^حي\s+/, '').replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ')
const normCity = (s: string | null | undefined) => String(s || '').trim().toLowerCase().replace(/[أإآ]/g, 'ا')

export type ClusterLike = { district_ar: string | null; street_ar: string | null; sub_ar: string | null; label_ar: string }

/** The popular name of a cluster («سوق الزل للأقمشة»), or null when no curated name fits all three keys. */
export function marketNameFor(c: ClusterLike, city: string | null | undefined, request = ''): string | null {
  const cityKey = normCity(city)
  if (!cityKey) return null
  for (const m of MARKET_NAMES) {
    if (!m.city.some((x) => normCity(x) === cityKey)) continue
    const inDistrict = m.district?.some((d) => normDistrict(d) === normDistrict(c.district_ar)) ?? false
    const onStreet = m.street?.some((s) => String(c.street_ar || '').includes(s)) ?? false
    if (!inDistrict && !onStreet) continue
    const trade = `${c.sub_ar || ''} ${c.label_ar || ''} ${request}`
    const hit = m.trades.find((t) => t.match.test(trade))
    if (hit) return hit.label ? `${m.name} ${hit.label}` : m.name
  }
  return null
}

/** The curated markets of a city, for suggestions under the search bar. */
export function marketsIn(city: string | null | undefined): MarketName[] {
  const cityKey = normCity(city)
  return cityKey ? MARKET_NAMES.filter((m) => m.city.some((x) => normCity(x) === cityKey)) : []
}

/** Suggestion chips for a city: «سوق الزل للأقمشة» → search «أقمشة» inside district الديرة. */
export function marketSuggestions(city: string | null | undefined, max = 4): { label: string; term: string; district?: string }[] {
  const out: { label: string; term: string; district?: string }[] = []
  for (const m of marketsIn(city)) {
    // one chip per distinct term (a market listed twice with an empty label would repeat its name)
    const seen = new Set<string>()
    for (const t of m.trades) {
      const label = t.label ? `${m.name} ${t.label}` : m.name
      if (seen.has(label)) continue
      seen.add(label)
      out.push({ label, term: t.term, district: m.district?.[0] })
    }
  }
  return out.slice(0, max)
}

/*
 * Market vocabulary: how buyers and shop owners actually ask. Used as example chips and in placeholders.
 * «كوري وصيني» = Korean and Chinese car parts; «مليس» = plaster skim coat; «جملة وقطاعي» = wholesale and retail.
 */
export const BUY_EXAMPLES = ['حدايد وبويات', 'بلاط', 'مليس', 'قطع غيار كوري وصيني', 'أدوات صحية جملة وقطاعي'] as const
export const SELL_EXAMPLES = ['حدايد وبويات', 'بلاط وسيراميك', 'قطع غيار كوري وصيني', 'جملة وقطاعي'] as const
export const BUY_PLACEHOLDER = 'وش تبي تسعّر؟ مثل: حدايد وبويات، بلاط، مليس'
export const SELL_PLACEHOLDER = 'وش تبيع؟ مثل: قطع غيار كوري وصيني، جملة وقطاعي'
/** phones: the question alone (the example chips sit right under it) */
export const BUY_PLACEHOLDER_SHORT = 'وش تبي تسعّر؟'
export const SELL_PLACEHOLDER_SHORT = 'وش تبيع؟'
