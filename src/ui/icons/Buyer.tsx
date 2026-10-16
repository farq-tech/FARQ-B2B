import { IconBase, type FarqIconProps } from './base'

/**
 * مشتري — A briefcase.
 * Used in: Buyer party label (gallery).
 */
export function BuyerIcon(props: FarqIconProps) {
  return (
    <IconBase name="buyer" {...props}>
      <rect className="fi-fill" x="3.5" y="7.5" width="17" height="12.5" rx="2.5" /><path d="M9 7.5V5.75A1.75 1.75 0 0 1 10.75 4h2.5A1.75 1.75 0 0 1 15 5.75V7.5M3.5 13h17M12 12v2" />
    </IconBase>
  )
}
