import { IconBase, type FarqIconProps, Cut, useCutId } from './base'

/**
 * إخفاء — An eye with a slash.
 * Used in: «إخفاء» and the «مخفي» chip in طلباتي.
 */
export function HideIcon(props: FarqIconProps) {
  const cut = useCutId()
  return (
    <IconBase name="hide" {...props}>
      <Cut id={cut}><path d="M4 4l16 16" /></Cut><g mask={`url(#${cut})`}><path className="fi-fill" d="M2.75 12c1.85-4 5.3-6.5 9.25-6.5s7.4 2.5 9.25 6.5c-1.85 4-5.3 6.5-9.25 6.5S4.6 16 2.75 12z" /><circle cx="12" cy="12" r="3" /></g><path d="M4 4l16 16" />
    </IconBase>
  )
}
