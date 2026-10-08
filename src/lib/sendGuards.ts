// Copied from فرق بناء (read-only source): farqconstraction/src/lib/sendGuards.ts — ios-app@5147808, identical to 5147808 (committed). Do not edit business logic here.
/** Checks a line must pass before it is put in front of a real supplier. */

/**
 * The quantity as a positive number, or null.
 *
 * This used to answer 1 for anything it could not read, so «», «0» and
 * «حسب المخطط» all reached a supplier as «الكمية: 1» with nothing on screen to
 * say so. A line without a real quantity is now refused by name.
 */
export function readQty(raw: string): number | null {
  const western = String(raw ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,،٬\s]/g, '')
    .replace(/٫/g, '.')
  if (!western) return null
  const n = Number(western)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Only ever called on lines `readQty` accepted; see `sendBlockers`. */
export function parseQty(raw: string): number {
  return readQty(raw) ?? 0
}

/** A name a supplier can read: letters survive once control characters are gone. */
export function cleanLineName(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\ufffd]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
