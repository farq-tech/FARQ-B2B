/** Format product-facing numbers with Latin digits, regardless of the UI language. */
export const formatNumber = (value: number, options: Intl.NumberFormatOptions = {}) =>
  value.toLocaleString('en-US', options)
