import { IconBase, type FarqIconProps } from './base'

/**
 * جملة — Three stacked boxes.
 * Used in: «جملة فقط» filter, «جملة» chips on result rows and clusters.
 * hover motion: boxes.
 */
export function WholesaleIcon(props: FarqIconProps) {
  return (
    <IconBase name="wholesale" motion="boxes" {...props}>
      <g className="fi-m"><rect className="fi-fill" x="3" y="13.5" width="7.5" height="7" rx="1.25" /><rect className="fi-fill" x="13.5" y="13.5" width="7.5" height="7" rx="1.25" /><rect className="fi-fill" x="8.25" y="4" width="7.5" height="7" rx="1.25" /><path d="M6.75 13.5v2.25M17.25 13.5v2.25M12 4v2.25" /></g>
    </IconBase>
  )
}
