import { IconBase, type FarqIconProps } from './base'

/**
 * خروج — A door frame with an arrow leaving it. Mirrors in RTL.
 * Used in: Sidebar account card «تسجيل الخروج».
 */
export function LogoutIcon(props: FarqIconProps) {
  return (
    <IconBase name="logout" mirror {...props}>
      <path className="fi-fill" d="M10.5 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h4" /><path d="M10.5 12h10" /><g className="fi-m"><path d="M17 8.5l3.5 3.5-3.5 3.5" /></g>
    </IconBase>
  )
}
