/** Accept Arabic and Persian keyboard digits, then store the filter as the same number used by the API. */
export function parseFilterNumber(value: string): number | null {
  const western = value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0)
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660))
  })
  const digits = western.replace(/[^0-9]/g, '')
  if (!digits) return null
  const number = Number(digits)
  return Number.isSafeInteger(number) ? number : null
}
