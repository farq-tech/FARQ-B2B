import { IconBase, type FarqIconProps } from './base'

/**
 * الأعضاء — Two people.
 * Used in: Organization members (gallery; no nav entry yet).
 */
export function MembersIcon(props: FarqIconProps) {
  return (
    <IconBase name="members" {...props}>
      <circle className="fi-fill" cx="9" cy="8" r="3.25" /><path className="fi-fill" d="M3 19.5a6 6 0 0 1 12 0" /><path d="M15 4.85a3.25 3.25 0 0 1 0 6.3M17 13.85a6 6 0 0 1 4 5.65" />
    </IconBase>
  )
}
