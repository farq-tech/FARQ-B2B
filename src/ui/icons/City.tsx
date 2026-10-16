import { IconBase, type FarqIconProps } from './base'

/**
 * المدينة — Three buildings, the middle one a tower.
 * Used in: City picker on خريطة الفرص.
 */
export function CityIcon(props: FarqIconProps) {
  return (
    <IconBase name="city" {...props}>
      <path className="fi-fill" d="M9 20.5V6.75L12 4l3 2.75V20.5z" /><path d="M4.5 20.5v-9h4.5M15 9.5h4.5v11M3 20.5h18M12 9v1.5M12 13v1.5M6.75 14.5v.01M6.75 17.5v.01M17.25 12.5v.01M17.25 15.5v.01" />
    </IconBase>
  )
}
