import { IconBase, type FarqIconProps } from './base'

/**
 * رفع كتالوج — An open book: product tiles on one page, an up-arrow on the other.
 * Used in: StartSheet «أبي أبيع منتجاتي» and «ارفع الكتالوج».
 * hover motion: rise.
 */
export function UploadCatalogIcon(props: FarqIconProps) {
  return (
    <IconBase name="upload-catalog" motion="rise" {...props}>
      <path className="fi-fill" d="M12 7.5C10.5 6 8 5.5 3.5 5.75V18.5c4.5-.25 7 .25 8.5 1.5 1.5-1.25 4-1.75 8.5-1.5V5.75C16 5.5 13.5 6 12 7.5z" /><path d="M12 7.5V20" /><g fill="currentColor" stroke="none"><rect x="5.5" y="9.5" width="2" height="2" rx=".5" /><rect x="8.5" y="9.5" width="2" height="2" rx=".5" /><rect x="5.5" y="12.5" width="2" height="2" rx=".5" /><rect x="8.5" y="12.5" width="2" height="2" rx=".5" /></g><g className="fi-m"><path d="M16.25 15.25v-5.5M14.25 11.5l2-2 2 2" /></g>
    </IconBase>
  )
}
