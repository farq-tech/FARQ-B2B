import { IconBase, type FarqIconProps } from './base'

/**
 * صندوق الوارد — An open tray with a small chat bubble dropping in.
 * Used in: Sidebar «صندوق الوارد», mobile tab «الوارد».
 */
export function InboxIcon(props: FarqIconProps) {
  return (
    <IconBase name="inbox" {...props}>
      <path className="fi-fill" d="M3.5 14v4.5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V14h-4.25l-1.5 2.5h-5.5l-1.5-2.5z" /><path d="M3.5 14l2.2-5.2A2 2 0 0 1 7.55 7.5H8M20.5 14l-2.2-5.2a2 2 0 0 0-1.85-1.3H16" /><path d="M10.5 3h3A1.5 1.5 0 0 1 15 4.5V7a1.5 1.5 0 0 1-1.5 1.5h-.75L11 10.25V8.5h-.5A1.5 1.5 0 0 1 9 7V4.5A1.5 1.5 0 0 1 10.5 3z" />
    </IconBase>
  )
}
