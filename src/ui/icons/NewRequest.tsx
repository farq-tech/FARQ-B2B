import { IconBase, type FarqIconProps } from './base'

/**
 * طلب جديد — A plus inside a rounded square.
 * Used in: Sidebar and mobile tab «طلب جديد», «طلب جديد» buttons on خريطة الفرص.
 */
export function NewRequestIcon(props: FarqIconProps) {
  return (
    <IconBase name="new-request" {...props}>
      <rect className="fi-fill" x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8.5v7M8.5 12h7" />
    </IconBase>
  )
}
