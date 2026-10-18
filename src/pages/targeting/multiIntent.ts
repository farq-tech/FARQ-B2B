export type MapIntent = { activity: string; district: string }
export const MAX_MAP_INTENTS = 8

/** Use the directory's established activity label for the colloquial barber variants. */
export function directoryActivityQuery(activity: string): string {
  const normalized = activity.normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
  return /حلاق|حلاقه/u.test(normalized) ? 'حلاق رجالي' : activity
}

/** Avoid bulk-selecting barber-query rows unless the business name itself indicates barber / haircut. */
export function hasDirectoryActivityEvidence(activity: string, values: (string | null | undefined)[]): boolean {
  const normalizedActivity = activity.normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
  if (!/حلاق|حلاقه/u.test(normalizedActivity)) return true
  const evidence = values.filter(Boolean).join(' ').normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').toLocaleLowerCase('ar')
  return /حلاق|حلاقه|barber/u.test(evidence)
}

const REQUEST_PREFIX = /^(?:(?:أبي|ابي|ابغى|أبغى|أريد|اريد|أحتاج|احتاج)\s*)+/u
const INTENT_SEPARATOR = /\s+و(?=\s*(?:أبي|ابي|ابغى|أبغى|أريد|اريد|أحتاج|احتاج)\s)/u
const DISTRICT_MARKER = /\s+(?:في\s+)?(?:ب?حي)\s+/u

/** Parse only explicit multi-requests that name one activity and one district per clause. */
export function parseMapIntents(value: string): { intents: MapIntent[]; invalid: boolean } | null {
  const clauses = value.split(INTENT_SEPARATOR).map((part) => part.trim()).filter(Boolean)
  if (clauses.length < 2) return null
  if (clauses.length > MAX_MAP_INTENTS) return { intents: [], invalid: true }

  const intents: MapIntent[] = []
  for (const clause of clauses) {
    const clean = clause.replace(REQUEST_PREFIX, '').trim()
    const marker = DISTRICT_MARKER.exec(clean)
    if (!marker || marker.index === undefined) return { intents: [], invalid: true }
    const activity = clean.slice(0, marker.index).trim().replace(/[،,؛;]+$/u, '').trim()
    const district = clean.slice(marker.index + marker[0].length).trim().replace(/^(?:الحي\s+)/u, '').replace(/[؟?!.،,؛;]+$/u, '').trim()
    if (!activity || !district) return { intents: [], invalid: true }
    intents.push({ activity, district })
  }
  return { intents, invalid: false }
}
