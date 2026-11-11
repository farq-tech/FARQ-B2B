/** Normalize English, Arabic-Indic and Persian keyboard digits to the stored English-digit input string. */
export function normalizeNumericInput(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^0-9]/g, '')
}

/** Parse integer filters from English, Arabic-Indic or Persian keyboard digits; display stays English. */
export function parseFilterInteger(value: string): number | null {
  const digits = normalizeNumericInput(value)
  if (!digits) return null
  const parsed = Number(digits)
  return Number.isSafeInteger(parsed) ? parsed : null
}
