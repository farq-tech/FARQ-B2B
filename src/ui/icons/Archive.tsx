import { IconBase, type FarqIconProps } from './base'

/**
 * أرشفة — An archive box with a lid and a handle slot.
 * Used in: «أرشفة» and the «مؤرشف» chip in طلباتي.
 */
export function ArchiveIcon(props: FarqIconProps) {
  return (
    <IconBase name="archive" {...props}>
      <rect x="3" y="4" width="18" height="4.5" rx="1" /><path className="fi-fill" d="M4.5 8.5v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-10" /><path d="M10 12.5h4" />
    </IconBase>
  )
}
