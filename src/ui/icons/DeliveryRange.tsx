import { IconBase, type FarqIconProps } from './base'

/**
 * نطاق التوصيل — A pin inside two dashed coverage rings (seen from above).
 * Used in: Delivery coverage (gallery; next on supplier profiles).
 * hover motion: pin.
 */
export function DeliveryRangeIcon(props: FarqIconProps) {
  return (
    <IconBase name="delivery-range" motion="pin" {...props}>
      <circle cx="12" cy="12" r="5.5" pathLength={12} strokeDasharray="0.6 1.4" /><circle cx="12" cy="12" r="9" pathLength={20} strokeDasharray="0.6 1.4" /><g className="fi-m"><path className="fi-fill" d="M12 15s-2.25-2-2.25-4a2.25 2.25 0 0 1 4.5 0c0 2-2.25 4-2.25 4z" /></g>
    </IconBase>
  )
}
