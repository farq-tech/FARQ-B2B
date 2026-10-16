import { IconBase, type FarqIconProps } from './base'

/**
 * التخصصات — An oval badge with a check.
 * Used in: StartSheet specialty chips «تخصصاتك».
 */
export function SpecialtiesIcon(props: FarqIconProps) {
  return (
    <IconBase name="specialties" {...props}>
      <ellipse className="fi-fill" cx="12" cy="12" rx="7.5" ry="9" /><path d="M8.75 12.25 11 14.5l4.25-4.5" />
    </IconBase>
  )
}
