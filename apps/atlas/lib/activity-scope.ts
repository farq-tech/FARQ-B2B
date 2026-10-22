import type { LiveActivityMain } from './live-market'

function normalize(text: string) {
  return text.replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase().trim()
}

const EXPLICIT_ACTIVITY_TERMS: Record<string, string[]> = {
  'مقاولات وخدمات انشائيه': ['مقاول', 'مقاولات', 'انشائي', 'انشائيه', 'تشطيب'],
}

const CATEGORY_ALIASES: Record<string, string[]> = {
  'معدات مطاعم': ['اغذيه ومشروبات'],
  'مواد غذائيه': ['اغذيه ومشروبات'],
  'مواد بناء': ['مواد بناء'],
}

/**
 * Resolve a phrase into exactly one catalog activity. Explicit trade words
 * outrank broad legacy UI categories: "شركات مقاولات" must never fall back
 * to sellers of building materials.
 */
export function resolveLiveActivityScope(
  categories: readonly string[],
  specialties: readonly string[],
  catalog: readonly LiveActivityMain[],
  query = '',
): LiveActivityMain | null {
  if (!catalog.length) return null
  const q = normalize(query)
  const explicit = catalog.filter((activity) => (EXPLICIT_ACTIVITY_TERMS[normalize(activity.main_ar)] ?? [])
    .some((term) => q.includes(normalize(term))))
  const category = catalog.filter((activity) => {
    const activityKey = normalize(activity.main_ar)
    return categories.some((value) => {
      const categoryKey = normalize(value)
      return activityKey.includes(categoryKey) || categoryKey.includes(activityKey) || (CATEGORY_ALIASES[categoryKey] ?? []).some((alias) => activityKey.includes(alias))
    })
  })
  const candidates = explicit.length ? explicit : category
  if (candidates.length !== 1) return null
  const activity = candidates[0]
  const matchedSubs = activity.subs.filter((sub) => specialties.some((specialty) => {
    const specialtyKey = normalize(specialty)
    const subKey = normalize(sub.sub_ar)
    return subKey.includes(specialtyKey) || specialtyKey.includes(subKey)
  }))
  if (!matchedSubs.length) return activity
  return { ...activity, subs: matchedSubs, streets: matchedSubs.reduce((total, sub) => total + sub.streets, 0), shops: matchedSubs.reduce((total, sub) => total + sub.shops, 0) }
}
