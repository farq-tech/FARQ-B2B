import { IconBase, type FarqIconProps, RiyalGlyph } from './base'

/**
 * طلبات التسعير — A document with a folded corner, three lines and a small riyal sign.
 * Used in: Sidebar «طلبات التسعير», mobile tab «الطلبات», StartSheet link to the price-request wizard.
 */
export function PricingRequestsIcon(props: FarqIconProps) {
  return (
    <IconBase name="pricing-requests" {...props}>
      <path className="fi-fill" d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3v4a1.5 1.5 0 0 0 1.5 1.5h4" /><path d="M8.5 8h2.5M8.5 11.5h7M8.5 15h2.5" /><RiyalGlyph x={12.4} y={14.25} h={5} />
    </IconBase>
  )
}
