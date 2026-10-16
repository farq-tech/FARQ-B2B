import { IconBase, type FarqIconProps } from './base'

/**
 * مقاول — A hard hat.
 * Used in: Contractor party label (gallery).
 */
export function ContractorIcon(props: FarqIconProps) {
  return (
    <IconBase name="contractor" {...props}>
      <path className="fi-fill" d="M5 15.5a7 7 0 0 1 14 0" /><path d="M10 8.8v3.7M14 8.8v3.7" /><rect x="2.75" y="15.5" width="18.5" height="3.25" rx="1.5" />
    </IconBase>
  )
}
