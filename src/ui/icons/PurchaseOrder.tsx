import { IconBase, type FarqIconProps, Cut, useCutId } from './base'

/**
 * أمر شراء — A document with a round stamp.
 * Used in: Award / purchase order (gallery).
 */
export function PurchaseOrderIcon(props: FarqIconProps) {
  const cut = useCutId()
  return (
    <IconBase name="purchase-order" {...props}>
      <Cut id={cut}><circle cx="17" cy="17" r="3.75" /></Cut><g mask={`url(#${cut})`}><path className="fi-fill" d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3v4a1.5 1.5 0 0 0 1.5 1.5h4" /><path d="M8.5 12h6M8.5 15.5h2.5" /></g><circle cx="17" cy="17" r="3.75" /><circle cx="17" cy="17" r="1.25" />
    </IconBase>
  )
}
