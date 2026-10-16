import { IconBase, type FarqIconProps, Cut, useCutId } from './base'

/**
 * رفع كراسة — A document with an up-arrow in a circle.
 * Used in: StartSheet «كراسة أو طلب شراء», booklet upload on خريطة الفرص.
 * hover motion: rise.
 */
export function UploadBookletIcon(props: FarqIconProps) {
  const cut = useCutId()
  return (
    <IconBase name="upload-booklet" motion="rise" {...props}>
      <Cut id={cut}><circle cx="17" cy="17" r="4" /></Cut><g mask={`url(#${cut})`}><path className="fi-fill" d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3v4a1.5 1.5 0 0 0 1.5 1.5h4" /><path d="M8.5 12h4.5M8.5 15.5h2.5" /></g><circle cx="17" cy="17" r="4" /><g className="fi-m"><path d="M17 19v-4M15.25 16.5 17 14.75l1.75 1.75" /></g>
    </IconBase>
  )
}
