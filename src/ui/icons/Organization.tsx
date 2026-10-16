import { IconBase, type FarqIconProps } from './base'

/**
 * المنشأة — A two-storey Najdi mud building with stepped triangular crenellations and slit windows.
 * Used in: Account / organization settings (gallery; no nav entry yet).
 */
export function OrganizationIcon(props: FarqIconProps) {
  return (
    <IconBase name="organization" {...props}>
      <path className="fi-fill" d="M4.5 20.5V8.5l1.5-2.5 1.5 2.5 1.5-2.5 1.5 2.5L12 6l1.5 2.5L15 6l1.5 2.5L18 6l1.5 2.5v12" /><path d="M3 20.5h18M4.5 13.5h15M8 10.5V11M12 10.5V11M16 10.5V11M7.5 16.5v1M16.5 16.5v1" /><path d="M10.5 20.5V18a1.5 1.5 0 0 1 3 0v2.5" />
    </IconBase>
  )
}
