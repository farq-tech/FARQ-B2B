/** Joins class names, dropping falsy parts. */
export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/** Shared focus ring — Figma «State=Focus»: 2px border/primary. */
export const FOCUS_RING = 'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-primary)]'
