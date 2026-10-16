import { IconBase, type FarqIconProps } from './base'

/**
 * حسابي — A person in a circle.
 * Used in: Sidebar «حسابي».
 */
export function AccountIcon(props: FarqIconProps) {
  return (
    <IconBase name="account" {...props}>
      <circle className="fi-fill" cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.4 18.3a6.5 6.5 0 0 1 11.2 0" />
    </IconBase>
  )
}
