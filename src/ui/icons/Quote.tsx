import { IconBase, type FarqIconProps, RiyalGlyph } from './base'

/**
 * عرض سعر — The riyal sign in a card.
 * Used in: Quotes on requests and comparison (gallery; next on Quote Card).
 */
export function QuoteIcon(props: FarqIconProps) {
  return (
    <IconBase name="quote" {...props}>
      <rect className="fi-fill" x="3" y="5.5" width="18" height="13" rx="2.5" /><RiyalGlyph x={8.42} y={8} h={8} weight={0.55} />
    </IconBase>
  )
}
