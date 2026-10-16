import { IconBase, type FarqIconProps } from './base'

/**
 * إظهار — An eye.
 * Used in: «إظهار» in طلباتي.
 */
export function ShowIcon(props: FarqIconProps) {
  return (
    <IconBase name="show" {...props}>
      <path className="fi-fill" d="M2.75 12c1.85-4 5.3-6.5 9.25-6.5s7.4 2.5 9.25 6.5c-1.85 4-5.3 6.5-9.25 6.5S4.6 16 2.75 12z" /><circle cx="12" cy="12" r="3" />
    </IconBase>
  )
}
