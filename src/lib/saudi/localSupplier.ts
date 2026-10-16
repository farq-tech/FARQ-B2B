import { isValidCr } from './validators'

/*
 * «منشأة سعودية»: shown only when the data says so — never guessed from a name, a phone prefix or a location.
 *   · a commercial registration (10 digits) on the record, or
 *   · a trade licence from a Saudi registry on the record, or a source that is itself such a registry.
 * TODO(owner): confirm LOCAL_REGISTRY_SOURCES. Today it is only the 2GIS «firms with trade license» layer (MOMRAH licences);
 * the targeting service does not return licence numbers in search rows yet (cols list in its server.py), so the badge
 * shows on targeting rows only once it does, or for rows from that layer.
 */
export const LOCAL_REGISTRY_SOURCES = ['firms_license'] as const

export type LocalEvidence = { cr_number?: string | null; commercial_license?: string | null; license_no?: string | null; sources?: string[] | null }

export function isSaudiEstablishment(r: LocalEvidence | null | undefined): boolean {
  if (!r) return false
  if (r.cr_number && isValidCr(r.cr_number)) return true
  if (String(r.commercial_license || r.license_no || '').trim()) return true
  return (r.sources || []).some((s) => (LOCAL_REGISTRY_SOURCES as readonly string[]).includes(s))
}
