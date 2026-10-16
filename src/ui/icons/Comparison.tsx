import { IconBase, type FarqIconProps } from './base'

/**
 * مقارنة — Two bars on a baseline; the shorter (cheaper) one is marked with a check.
 * Used in: Comparison screen (gallery).
 */
export function ComparisonIcon(props: FarqIconProps) {
  return (
    <IconBase name="comparison" {...props}>
      <path d="M3 20.5h18M5 20.5V6.5A1.5 1.5 0 0 1 6.5 5h2.5a1.5 1.5 0 0 1 1.5 1.5v14" /><path className="fi-fill" d="M13.5 20.5v-8a1.5 1.5 0 0 1 1.5-1.5h2.5a1.5 1.5 0 0 1 1.5 1.5v8" /><path d="M14.5 6.25l1.5 1.5 2.75-3" />
    </IconBase>
  )
}
