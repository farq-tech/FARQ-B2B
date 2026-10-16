import { IconBase, type FarqIconProps } from './base'

/**
 * إشعارات — A bell.
 * Used in: Top bar notifications.
 * hover motion: bell.
 */
export function NotificationsIcon(props: FarqIconProps) {
  return (
    <IconBase name="notifications" motion="bell" {...props}>
      <g className="fi-m"><path className="fi-fill" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M12 3v2M10 20.75a2.25 2.25 0 0 0 4 0" /></g>
    </IconBase>
  )
}
