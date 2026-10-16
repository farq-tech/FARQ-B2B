import { IconBase, type FarqIconProps, sealPath } from './base'

const SEAL = sealPath(12, 12, 12, 7.6, 2.1)

/**
 * منشأة سعودية — A scalloped seal with a palm frond outline. No emblem, no swords.
 * Used in: Saudi-registered business mark (gallery; next on verified suppliers).
 */
export function SaudiEntityIcon(props: FarqIconProps) {
  return (
    <IconBase name="saudi-entity" {...props}>
      <path className="fi-fill" d={SEAL} /><path d="M8.75 16.25 15.5 8.5M10.25 14.5l.7 2.08M10.25 14.5l-2.15-.43M12 12.5l.7 2.08M12 12.5l-2.15-.43M13.75 10.5l.7 2.08M13.75 10.5l-2.15-.43" />
    </IconBase>
  )
}
