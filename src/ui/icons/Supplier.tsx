import { IconBase, type FarqIconProps } from './base'

/**
 * مورد — A small factory with a saw-tooth roof and a chimney.
 * Used in: Supplier party label (gallery; next on «مورد في فرق» result rows).
 */
export function SupplierIcon(props: FarqIconProps) {
  return (
    <IconBase name="supplier" {...props}>
      <path className="fi-fill" d="M3.5 20.5V9.5l4.5 3v-3l4.5 3v-3l4.5 3V4.5h3.5v16z" /><path d="M6.5 16.5h2.5M11 16.5h2.5" />
    </IconBase>
  )
}
