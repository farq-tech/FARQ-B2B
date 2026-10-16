import { IconBase, type FarqIconProps } from './base'

/**
 * كتابة المنتجات — A pen over text lines. Mirrors in RTL.
 * Used in: StartSheet «اكتب منتجاتك».
 */
export function WriteProductsIcon(props: FarqIconProps) {
  return (
    <IconBase name="write-products" mirror {...props}>
      <path d="M3.5 6h5.5M3.5 10h3.5M3.5 14h1.5" /><path className="fi-fill" d="M17.6 4.9a2.05 2.05 0 0 1 2.9 2.9L10.4 17.9l-3.9 1 1-3.9z" /><path d="M15.5 7l2.9 2.9M12.5 20.5h8" />
    </IconBase>
  )
}
