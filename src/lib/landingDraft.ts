/*
 * A request started on the public landing page, kept in this browser until the visitor signs in.
 * The landing writes it; «طلب جديد» (NewRequestV2) reads it once on open, fills the typed line and the
 * delivery city, then clears it. Nothing is sent anywhere by saving it.
 */
export type LandingDraft = {
  text: string
  item: string
  qty: string
  unit: string
  city: string | null      // Arabic city name, as the delivery field expects
  use: string | null
  answer: string | null    // the answer to the one price question, when given
  savedAt: string
}

const KEY = 'farq.landing.draft'
const MAX_AGE_MS = 7 * 24 * 3600 * 1000

export function saveLandingDraft(d: Omit<LandingDraft, 'savedAt'>): boolean {
  try { localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: new Date().toISOString() })); return true } catch { return false }
}

export function readLandingDraft(): LandingDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null') as LandingDraft | null
    if (!d || !d.item || Date.now() - Date.parse(d.savedAt) > MAX_AGE_MS) return null
    return d
  } catch { return null }
}

export function clearLandingDraft() {
  try { localStorage.removeItem(KEY) } catch { /* storage blocked */ }
}

export const hasLandingDraft = () => readLandingDraft() !== null
