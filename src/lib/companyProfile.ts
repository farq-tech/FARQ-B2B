// Copied from فرق بناء (read-only source): farqconstraction/src/lib/companyProfile.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/**
 * The buyer's company details, as printed on a request for quotation.
 *
 * Read from the server only (owner 2026-10-16: «لا اريد اي بيانات على الجهاز»): `loadCompanyProfile` maps the
 * profile last fetched by src/api/companyProfileClient.ts (GET /api/business/company-profile, cached in memory for
 * this tab), with Farq's published contact details as defaults. Saving goes through حسابي (PUT on the same route);
 * `saveCompanyProfile` only updates this tab's memory. Nothing is written to the device.
 */
import { cachedBusinessProfile } from '../api/companyProfileClient'

export type CompanyProfile = {
  name: string
  city: string
  phone: string
  email: string
  /** Shown to suppliers so they can issue a formal quote; empty fields are omitted. */
  legalName: string
  crNumber: string
  vatNumber: string
  nationalAddress: string
  /** Pre-filled in the send form; the buyer can still change both per request. */
  defaultDeliveryCity: string
  defaultDeadlineDays: number
}

/** Overrides set in this tab via saveCompanyProfile; memory only. */
let override: Partial<CompanyProfile> | null = null

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = Object.freeze({
  name: 'فرق للبناء',
  city: 'الرياض',
  phone: '0563333463',
  email: 'info@farq.sa',
  legalName: '',
  crNumber: '',
  vatNumber: '',
  nationalAddress: '',
  defaultDeliveryCity: 'الرياض',
  defaultDeadlineDays: 14,
})

function days(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : DEFAULT_COMPANY_PROFILE.defaultDeadlineDays
}

const opt = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)

function clean(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text || fallback
}

export function loadCompanyProfile(): CompanyProfile {
  try {
    const parsed: Partial<CompanyProfile> = { ...cachedBusinessProfile(), ...(override || {}) }
    return {
      name: clean(parsed.name, DEFAULT_COMPANY_PROFILE.name),
      city: clean(parsed.city, DEFAULT_COMPANY_PROFILE.city),
      phone: clean(parsed.phone, DEFAULT_COMPANY_PROFILE.phone),
      email: clean(parsed.email, DEFAULT_COMPANY_PROFILE.email),
      legalName: opt(parsed.legalName),
      crNumber: opt(parsed.crNumber),
      vatNumber: opt(parsed.vatNumber),
      nationalAddress: opt(parsed.nationalAddress),
      defaultDeliveryCity: clean(parsed.defaultDeliveryCity, DEFAULT_COMPANY_PROFILE.defaultDeliveryCity),
      defaultDeadlineDays: days(parsed.defaultDeadlineDays),
    }
  } catch {
    return { ...DEFAULT_COMPANY_PROFILE }
  }
}

/** Memory only for this tab; the server copy is saved from حسابي. */
export function saveCompanyProfile(profile: CompanyProfile): boolean {
  try {
    override = {
      name: clean(profile.name, DEFAULT_COMPANY_PROFILE.name),
      city: clean(profile.city, DEFAULT_COMPANY_PROFILE.city),
      phone: clean(profile.phone, DEFAULT_COMPANY_PROFILE.phone),
      email: clean(profile.email, DEFAULT_COMPANY_PROFILE.email),
      legalName: opt(profile.legalName),
      crNumber: opt(profile.crNumber),
      vatNumber: opt(profile.vatNumber),
      nationalAddress: opt(profile.nationalAddress),
      defaultDeliveryCity: clean(profile.defaultDeliveryCity, DEFAULT_COMPANY_PROFILE.defaultDeliveryCity),
      defaultDeadlineDays: days(profile.defaultDeadlineDays),
    }
    return true
  } catch {
    return false
  }
}
