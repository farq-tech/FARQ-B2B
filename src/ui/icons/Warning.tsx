import { IconBase, type FarqIconProps } from './base'

/**
 * تنبيه — An exclamation mark in a rounded triangle.
 * Used in: Warnings and inline errors; fit «محتمل».
 */
export function WarningIcon(props: FarqIconProps) {
  return (
    <IconBase name="warning" {...props}>
      <path className="fi-fill" d="M10.3 4.2 2.9 17.5a1.95 1.95 0 0 0 1.7 2.9h14.8a1.95 1.95 0 0 0 1.7-2.9L13.7 4.2a1.95 1.95 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 16.75v.01" />
    </IconBase>
  )
}
