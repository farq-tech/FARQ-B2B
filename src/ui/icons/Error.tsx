import { IconBase, type FarqIconProps } from './base'

/**
 * خطأ — A cross in an octagon.
 * Used in: Error states; fit «غير مناسب».
 */
export function ErrorIcon(props: FarqIconProps) {
  return (
    <IconBase name="error" {...props}>
      <path className="fi-fill" d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" /><path d="M9.25 9.25l5.5 5.5M14.75 9.25l-5.5 5.5" />
    </IconBase>
  )
}
