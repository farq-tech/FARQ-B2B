import { IconBase, type FarqIconProps } from './base'

/**
 * الشارع — A road in perspective with a dashed centre line.
 * Used in: Street filter and street clusters on خريطة الفرص.
 */
export function StreetIcon(props: FarqIconProps) {
  return (
    <IconBase name="street" {...props}>
      <path d="M9.5 3.5 4 20.5M14.5 3.5 20 20.5M12 4.5v2M12 9.75v2.75M12 15.75v4" />
    </IconBase>
  )
}
