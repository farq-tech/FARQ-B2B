import { IconBase, type FarqIconProps } from './base'

/**
 * استعادة — A counter-clockwise arrow. Mirrors in RTL.
 * Used in: «استرجاع» in طلباتي.
 */
export function RestoreIcon(props: FarqIconProps) {
  return (
    <IconBase name="restore" mirror {...props}>
      <path d="M3.75 12a8.25 8.25 0 1 0 8.25-8.25 8.9 8.9 0 0 0-6.2 2.5L3.75 8.25" /><path d="M3.75 3.75v4.5h4.5" />
    </IconBase>
  )
}
