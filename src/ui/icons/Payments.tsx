import { IconBase, type FarqIconProps, RiyalGlyph } from './base'

/**
 * دفعات — A wallet with the riyal sign.
 * Used in: Payments (gallery).
 */
export function PaymentsIcon(props: FarqIconProps) {
  return (
    <IconBase name="payments" {...props}>
      <path className="fi-fill" d="M3.5 5.5a2 2 0 0 0 2 2H19a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 19 20H5.5a2 2 0 0 1-2-2z" /><path d="M17.5 7.5V4.75A1.25 1.25 0 0 0 16.25 3.5H5.5a2 2 0 0 0-2 2" /><path d="M20.5 11.5h-2.75a2.25 2.25 0 0 0 0 4.5h2.75" /><RiyalGlyph x={6.75} y={10.25} h={7} weight={0.55} />
    </IconBase>
  )
}
