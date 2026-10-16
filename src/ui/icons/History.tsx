import { IconBase, type FarqIconProps } from './base'

/**
 * السجل — A clock with list lines.
 * Used in: «السجل» (audit trail) in طلباتي.
 */
export function HistoryIcon(props: FarqIconProps) {
  return (
    <IconBase name="history" {...props}>
      <circle className="fi-fill" cx="9.5" cy="9.5" r="6" /><path d="M9.5 6.5v3l2 1.25M18 9.5h2.5M15 14.5h5.5M8 19.5h12.5" />
    </IconBase>
  )
}
