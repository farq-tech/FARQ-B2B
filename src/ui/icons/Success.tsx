import { IconBase, type FarqIconProps } from './base'

/**
 * نجاح — A check in a circle.
 * Used in: Success badges and toasts; fit «مناسب».
 */
export function SuccessIcon(props: FarqIconProps) {
  return (
    <IconBase name="success" {...props}>
      <circle className="fi-fill" cx="12" cy="12" r="9" /><path d="M8 12.25l2.75 2.75L16 9.5" />
    </IconBase>
  )
}
