import { IconBase, type FarqIconProps } from './base'

/**
 * الحي — A dashed area outline with a dot at its centre.
 * Used in: District filter and district clusters on خريطة الفرص.
 */
export function DistrictIcon(props: FarqIconProps) {
  return (
    <IconBase name="district" {...props}>
      <path d="M12 3.75c4.5 0 8.25 3 8.25 7.5 0 5-3.75 9-8.5 9S3.75 16.5 3.75 11.5 7.5 3.75 12 3.75z" strokeDasharray="1.5 3" /><circle cx="12" cy="12" r="2" fill="currentColor" />
    </IconBase>
  )
}
