import { farqSession } from '../api/farqSession'
import type { TargetRow } from '../api/targetingClient'
import type { NationalAddress } from '../lib/saudi/validators'

export type Opportunity = { id: string; company: TargetRow; product: string; city: string; stage: 'potential' | 'qualified' | 'quoted' | 'won' | 'closed'; need: string; quantity: string; unit: string; quote: string; updatedAt: string }
export type BusinessProfile = { name: string; phone: string; city: string; email: string; legalName: string; crNumber: string; vatNumber: string; nationalAddress: string; defaultDeliveryCity: string; defaultDeadlineDays: number; /** «حسابي» structured national address (SPL); nationalAddress is its one-line form for the RFQ */ nationalAddressParts?: NationalAddress }

/*
 * Per-tab working state (owner 2026-10-16: «لا اريد اي بيانات على الجهاز»): kept in this module's memory only,
 * keyed per signed-in user as before. Nothing is written to the device; a reload or a new tab starts clean.
 * The company profile is not here: it lives on the server (src/api/companyProfileClient.ts).
 */
const mem = new Map<string, string>()
const key = (name: string) => `farq.b2b.${farqSession.getUser()?.id || 'guest'}.${name}.v1`
export function readLocal<T>(name: string, fallback: T): T {
  try { const value = mem.get(key(name)); return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}
export function writeLocal(name: string, value: unknown): boolean {
  try { if (value === null || value === undefined) mem.delete(key(name)); else mem.set(key(name), JSON.stringify(value)); return true } catch { return false }
}
