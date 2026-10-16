import { IconBase, type FarqIconProps } from './base'

/**
 * بحث — A magnifier.
 * Used in: Search bar and «بحث حر» on خريطة الفرص.
 */
export function SearchIcon(props: FarqIconProps) {
  return (
    <IconBase name="search" {...props}>
      <circle className="fi-fill" cx="10.75" cy="10.75" r="6.25" /><path d="M15.5 15.5 20 20" />
    </IconBase>
  )
}
