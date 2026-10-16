import { IconBase, type FarqIconProps } from './base'

/**
 * التجمعات — Three overlapping circles.
 * Used in: «تجمعات هذا النشاط» on خريطة الفرص.
 */
export function ClustersIcon(props: FarqIconProps) {
  return (
    <IconBase name="clusters" {...props}>
      <circle cx="12" cy="8.25" r="4.75" /><circle cx="7.75" cy="15.25" r="4.75" /><circle cx="16.25" cy="15.25" r="4.75" />
    </IconBase>
  )
}
