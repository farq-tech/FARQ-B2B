import { IconBase, type FarqIconProps, gearPath } from './base'

const GEAR = gearPath(12, 12, 6, 6.75, 9, 15, 9)

/**
 * إعدادات — A six-tooth gear.
 * Used in: Settings entries.
 */
export function SettingsIcon(props: FarqIconProps) {
  return (
    <IconBase name="settings" {...props}>
      <path className="fi-fill" d={GEAR} /><circle cx="12" cy="12" r="3" />
    </IconBase>
  )
}
