import { IconBase, type FarqIconProps } from './base'

/**
 * تم الاستلام — A box with a check.
 * Used in: Delivery received status (gallery).
 */
export function ReceivedIcon(props: FarqIconProps) {
  return (
    <IconBase name="received" {...props}>
      <path className="fi-fill" d="M4.5 8.5h15v10a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" /><rect x="3" y="4.5" width="18" height="4" rx="1" /><path d="M9 14.25l2 2 4-4" />
    </IconBase>
  )
}
