import { farqSession } from '../api/farqSession'
import type { TargetRow } from '../api/targetingClient'
import type { BookletLine } from '../lib/readBooklet'
import type { NationalAddress } from '../lib/saudi/validators'

export type GoalMode = 'purchase' | 'marketing'
export type ExploreDraft = { q: string; city: string; mode: GoalMode; lines: BookletLine[]; selected: TargetRow[]; updatedAt: string }
export type Opportunity = { id: string; company: TargetRow; product: string; city: string; stage: 'potential' | 'qualified' | 'quoted' | 'won' | 'closed'; need: string; quantity: string; unit: string; quote: string; updatedAt: string }
export type BusinessProfile = { name: string; phone: string; city: string; email: string; legalName: string; crNumber: string; vatNumber: string; nationalAddress: string; defaultDeliveryCity: string; defaultDeadlineDays: number; /** «حسابي» structured national address (SPL); nationalAddress is its one-line form for the RFQ */ nationalAddressParts?: NationalAddress }

const key = (name: string) => `farq.b2b.${farqSession.getUser()?.id || 'guest'}.${name}.v1`
export function readLocal<T>(name: string, fallback: T): T {
  try { const value = localStorage.getItem(key(name)); return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}
export function writeLocal(name: string, value: unknown): boolean {
  try { localStorage.setItem(key(name), JSON.stringify(value)); return true } catch { return false }
}
export function loadBusinessProfile(): BusinessProfile {
  return { name: '', phone: '', city: '', email: farqSession.getUser()?.email || '', legalName: '', crNumber: '', vatNumber: '', nationalAddress: '', defaultDeliveryCity: '', defaultDeadlineDays: 14, ...readLocal<Partial<BusinessProfile>>('profile', {}) }
}
export function saveBusinessProfile(value: BusinessProfile) { return writeLocal('profile', value) }
export function saveOpportunities(draft: ExploreDraft): boolean {
  const existing = readLocal<Opportunity[]>('opportunities', [])
  const now = new Date().toISOString()
  for (const company of draft.selected) {
    const id = `${company.poi_key}:${draft.q.trim()}`
    if (!existing.some(row => row.id === id)) existing.unshift({ id, company, product: draft.q, city: draft.city, stage: 'potential', need: '', quantity: '', unit: '', quote: '', updatedAt: now })
  }
  return writeLocal('opportunities', existing)
}
