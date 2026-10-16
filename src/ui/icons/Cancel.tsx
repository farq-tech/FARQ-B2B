import { IconBase, type FarqIconProps } from './base'

/**
 * إلغاء — A circle with a slash.
 * Used in: «إلغاء الطلب» and the «ملغي» chip in طلباتي; unreachable channel.
 */
export function CancelIcon(props: FarqIconProps) {
  return (
    <IconBase name="cancel" {...props}>
      <circle className="fi-fill" cx="12" cy="12" r="9" /><path d="M5.65 5.65l12.7 12.7" />
    </IconBase>
  )
}
