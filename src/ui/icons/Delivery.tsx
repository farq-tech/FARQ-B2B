import { IconBase, type FarqIconProps } from './base'

/**
 * توريد — A Saudi Dyna pickup (cab-over light truck) carrying boxes. Mirrors in RTL so it drives forward.
 * Used in: Delivery facts on quotes, supply status (gallery).
 * hover motion: truck.
 */
export function DeliveryIcon(props: FarqIconProps) {
  return (
    <IconBase name="delivery" mirror motion="truck" {...props}>
      <g className="fi-m"><path className="fi-fill" d="M14 17.5V9.75A1.25 1.25 0 0 1 15.25 8.5h2.6a1.5 1.5 0 0 1 1.3.75l1.6 2.8c.17.3.25.62.25.96v3.24" /><path d="M16.25 8.5V12h4.4M3 14.5h11M3 14.5v2.5M10.75 17.5H14" /><path d="M3.5 14.5V10h4.25v4.5M7.75 14.5V7.5H12v7" /><circle cx="7" cy="18" r="1.75" /><circle cx="17.75" cy="18" r="1.75" /></g>
    </IconBase>
  )
}
