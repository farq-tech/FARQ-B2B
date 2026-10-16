import { IconBase, type FarqIconProps } from './base'

/**
 * معلومة — An «i» in a circle.
 * Used in: Hints and notes on خريطة الفرص and template editor.
 */
export function InfoIcon(props: FarqIconProps) {
  return (
    <IconBase name="info" {...props}>
      <circle className="fi-fill" cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.75v.01" />
    </IconBase>
  )
}
