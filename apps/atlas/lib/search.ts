import { BUSINESSES, BUYER_ROLES, CATEGORIES, DISTRICTS, STREETS, SUPPLIER_ROLES, districtById, streetById } from './mock-data'
import type { Business, Channel, Filters, GoalId, RequestType, Role, ScoredBusiness } from './types'

export const EMPTY_FILTERS: Filters = {
  districts: [],
  streets: [],
  categories: [],
  wholesale: 'all',
  roles: [],
  specialties: [],
  channels: [],
}

export function normalizeArabic(text: string) {
  return text
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .trim()
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'مواد بناء': ['بناء', 'حديد', 'اسمنت', 'عوازل'],
  'تغليف وتعبئه': ['تغليف', 'كراتين', 'كرتون', 'اكياس', 'تعبئه', 'مخابز'],
  'معدات مطاعم': ['معدات مطاعم', 'مطاعم', 'مطعم', 'مقاهي', 'كافيه', 'افران', 'ثلاجات', 'مطبخ'],
  'مواد غذائيه': ['غذائيه', 'قهوه', 'تمور', 'زيوت', 'اغذيه', 'تموين', 'اسواق'],
  'مستلزمات طبيه': ['طبيه', 'طبي', 'مستشفي', 'صيدليه', 'مجمعات'],
  كهربائيات: ['كهرباء', 'كهربائيات', 'انارة', 'اناره', 'كابلات', 'اضاءه', 'led'],
  'اثاث مكتبي': ['اثاث', 'مكاتب', 'كراسي'],
  'قطع غيار': ['قطع غيار', 'سيارات', 'ورش', 'ورشه', 'معدات ثقيله'],
}

const ROLE_KEYWORDS: Record<Role, string[]> = {
  مصنع: ['مصنع', 'مصانع', 'مصنعين'],
  مورد: ['مورد', 'موردين', 'توريد'],
  موزع: ['موزع', 'موزعين', 'توزيع'],
  'تاجر تجزئة': ['تجزئه', 'متاجر', 'متجر', 'محلات', 'معارض'],
  'مشتري مؤسسي': ['مشترين', 'مشتري', 'عملاء'],
}

const CHANNEL_KEYWORDS: Record<Channel, string[]> = {
  واتساب: ['واتساب', 'واتس', 'whatsapp'],
  هاتف: ['هاتف', 'اتصال', 'جوال'],
  'بريد إلكتروني': ['بريد', 'ايميل', 'email'],
}

const INTENT_KEYWORDS: Record<RequestType, string[]> = {
  rfq: ['تسعير', 'عرض سعر', 'عروض اسعار', 'عروض سعر', 'اسعار'],
  campaign: ['حمله', 'تسويق', 'رساله', 'رسايل', 'استهدف', 'اعلان'],
  list: ['قائمه', 'احفظ', 'مراجعه'],
}

const STOPWORDS = new Set(['ابحث', 'عن', 'في', 'حي', 'شارع', 'طريق', 'اريد', 'ابي', 'ابغي', 'ابغى', 'وش', 'لي', 'مع', 'من', 'علي', 'الي', 'او', 'و', 'احتاج', 'ابحث', 'جميع', 'كل', 'عبر', 'لل', 'بالجمله', 'جمله'])

const SPECIALTY_HEADS = new Set(['حديد', 'اسمنت', 'عوازل', 'كراتين', 'اكياس', 'افران', 'ثلاجات', 'تمور', 'زيوت', 'اناره', 'كابلات', 'كراسي'])

export interface ParsedQuery {
  categories: string[]
  districts: string[]
  streets: string[]
  roles: Role[]
  channels: Channel[]
  specialties: string[]
  wholesale: boolean
  intent: RequestType | null
  freeText: string[]
  chips: string[]
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((n) => haystack.includes(normalizeArabic(n)))
}

export function parseQuery(text: string, cityId: string): ParsedQuery {
  const q = normalizeArabic(text)
  const parsed: ParsedQuery = {
    categories: [],
    districts: [],
    streets: [],
    roles: [],
    channels: [],
    specialties: [],
    wholesale: false,
    intent: null,
    freeText: [],
    chips: [],
  }
  if (!q) return parsed

  for (const cat of CATEGORIES) {
    const keys = CATEGORY_KEYWORDS[normalizeArabic(cat.name)] ?? []
    if (q.includes(normalizeArabic(cat.name)) || includesAny(q, keys)) parsed.categories.push(cat.name)
    for (const sp of cat.specialties) {
      const head = normalizeArabic(sp).split(' ')[0]
      if (q.includes(normalizeArabic(sp)) || (SPECIALTY_HEADS.has(head) && q.includes(head))) parsed.specialties.push(sp)
    }
  }
  for (const d of DISTRICTS.filter((d) => d.cityId === cityId)) {
    const name = normalizeArabic(d.name)
    if (q.includes(name) || q.includes(name.replace(/^ال/, ''))) parsed.districts.push(d.id)
  }
  for (const s of STREETS.filter((s) => s.cityId === cityId)) {
    const core = normalizeArabic(s.name).replace(/^(شارع|طريق)\s+/, '')
    if (q.includes(core)) parsed.streets.push(s.id)
  }
  for (const role of Object.keys(ROLE_KEYWORDS) as Role[]) {
    if (includesAny(q, ROLE_KEYWORDS[role])) parsed.roles.push(role)
  }
  for (const ch of Object.keys(CHANNEL_KEYWORDS) as Channel[]) {
    if (includesAny(q, CHANNEL_KEYWORDS[ch])) parsed.channels.push(ch)
  }
  parsed.wholesale = q.includes('جمله')
  for (const intent of ['rfq', 'campaign', 'list'] as RequestType[]) {
    if (includesAny(q, INTENT_KEYWORDS[intent])) {
      parsed.intent = intent
      break
    }
  }

  const structured =
    parsed.categories.length + parsed.districts.length + parsed.streets.length + parsed.roles.length + parsed.channels.length + parsed.specialties.length + (parsed.wholesale ? 1 : 0)
  if (structured === 0) {
    parsed.freeText = q.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w))
  }

  parsed.chips = [
    ...parsed.categories.map((c) => `تصنيف: ${c}`),
    ...parsed.specialties.map((s) => `تخصص: ${s}`),
    ...parsed.roles.map((r) => `الدور: ${r}`),
    ...parsed.districts.map((d) => `حي: ${districtById.get(d)?.name}`),
    ...parsed.streets.map((s) => `شارع: ${streetById.get(s)?.name}`),
    ...(parsed.wholesale ? ['بالجملة'] : []),
    ...parsed.channels.map((c) => `قناة: ${c}`),
    ...parsed.freeText.map((t) => `كلمة: ${t}`),
  ]
  return parsed
}

const uniq = <T,>(arr: T[]) => Array.from(new Set(arr))

export function mergeParsedIntoFilters(filters: Filters, parsed: ParsedQuery): Filters {
  return {
    districts: uniq([...filters.districts, ...parsed.districts]),
    streets: uniq([...filters.streets, ...parsed.streets]),
    categories: uniq([...filters.categories, ...parsed.categories]),
    wholesale: parsed.wholesale ? 'wholesale' : filters.wholesale,
    roles: uniq([...filters.roles, ...parsed.roles]),
    specialties: uniq([...filters.specialties, ...parsed.specialties]),
    channels: uniq([...filters.channels, ...parsed.channels]),
  }
}

export function goalRoles(goal: GoalId | null): Role[] {
  if (goal === 'find-supplier' || goal === 'rfq') return SUPPLIER_ROLES
  if (goal === 'find-buyers') return BUYER_ROLES
  return []
}

export function countActiveFilters(f: Filters) {
  return f.districts.length + f.streets.length + f.categories.length + f.roles.length + f.specialties.length + f.channels.length + (f.wholesale === 'all' ? 0 : 1)
}

export interface SearchResult {
  results: ScoredBusiness[]
  duplicatesMerged: number
  /** Businesses in the city scope before structured filters (for category counts). */
  scope: Business[]
}

function stableJitter(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997
  return h % 7
}

export function runSearch(params: { cityId: string; goal: GoalId | null; filters: Filters; freeText: string[] }): SearchResult {
  const { cityId, goal, filters, freeText } = params
  const roleScope = filters.roles.length ? filters.roles : goalRoles(goal)
  const scope = BUSINESSES.filter((b) => b.cityId === cityId && (roleScope.length === 0 || roleScope.includes(b.role)))

  const matched = scope.filter((b) => {
    if (filters.districts.length && !filters.districts.includes(b.districtId)) return false
    if (filters.streets.length && !filters.streets.includes(b.streetId)) return false
    if (filters.categories.length && !filters.categories.includes(b.category)) return false
    if (filters.specialties.length && !filters.specialties.includes(b.specialty)) return false
    if (filters.wholesale === 'wholesale' && !b.wholesale) return false
    if (filters.wholesale === 'retail' && b.wholesale) return false
    if (filters.channels.length && !filters.channels.some((c) => b.channels.includes(c))) return false
    if (goal === 'target' && !b.whatsapp) return false
    if (freeText.length) {
      const hay = normalizeArabic(`${b.name} ${b.activity} ${b.specialty} ${b.category} ${districtById.get(b.districtId)?.name} ${streetById.get(b.streetId)?.name}`)
      if (!freeText.some((t) => hay.includes(t))) return false
    }
    return true
  })

  const ids = new Set(matched.map((b) => b.id))
  const deduped = matched.filter((b) => !(b.duplicateOf && ids.has(b.duplicateOf)))
  const duplicatesMerged = matched.length - deduped.length

  const results: ScoredBusiness[] = deduped
    .map((b) => {
      const reasons: string[] = []
      let score = 52
      if (filters.categories.includes(b.category)) {
        reasons.push(`النشاط ${b.category}`)
        score += 12
      }
      if (filters.specialties.includes(b.specialty)) {
        reasons.push(`متخصص في ${b.specialty}`)
        score += 10
      }
      if (filters.districts.includes(b.districtId)) {
        reasons.push(`داخل حي ${districtById.get(b.districtId)?.name}`)
        score += 8
      }
      if (filters.streets.includes(b.streetId)) {
        reasons.push(`على ${streetById.get(b.streetId)?.name}`)
        score += 8
      }
      if (roleScope.includes(b.role)) {
        reasons.push(`دوره ${b.role}`)
        score += 6
      }
      if (b.wholesale && filters.wholesale === 'wholesale') {
        reasons.push('يبيع بالجملة')
        score += 6
      }
      if (b.whatsapp && (filters.channels.includes('واتساب') || goal === 'target')) {
        reasons.push('متاح عبر واتساب')
        score += 5
      }
      if (b.consent === 'granted' && goal === 'target') {
        reasons.push('موافقة تواصل مسجلة')
        score += 4
      }
      if (freeText.length) {
        reasons.push(`يطابق "${freeText.join(' ')}"`)
        score += 8
      }
      if (reasons.length === 0) reasons.push(`ضمن ${b.activity} في المدينة`)
      score += Math.round((b.rating - 3.4) * 4) + stableJitter(b.id)
      return { ...b, relevance: Math.min(99, score), reasons }
    })
    .sort((a, b) => b.relevance - a.relevance)

  return { results, duplicatesMerged, scope }
}
