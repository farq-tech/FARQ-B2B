import { IconBase, type FarqIconProps } from './base'

/**
 * موعد — A calendar.
 * Used in: Dates and deadlines (gallery).
 */
export function AppointmentIcon(props: FarqIconProps) {
  return (
    <IconBase name="appointment" {...props}>
      <rect className="fi-fill" x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17.25h.01M12 17.25h.01" />
    </IconBase>
  )
}
