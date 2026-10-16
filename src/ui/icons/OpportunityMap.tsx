import { IconBase, type FarqIconProps, Cut, useCutId } from './base'

/**
 * خريطة الفرص — A tri-fold map with a pin and a small four-point Najdi star.
 * Used in: Sidebar «خريطة الفرص», mobile tab, the targeting page header.
 * hover motion: pin.
 */
export function OpportunityMapIcon(props: FarqIconProps) {
  const cut = useCutId()
  return (
    <IconBase name="opportunity-map" motion="pin" {...props}>
      <Cut id={cut}><path d="M15.5 13.75s-3.75-3.2-3.75-6.25a3.75 3.75 0 0 1 7.5 0c0 3.05-3.75 6.25-3.75 6.25z" /></Cut><g mask={`url(#${cut})`}><path className="fi-fill" d="M3 8.5l5.5-2 7 2 5.5-2v12l-5.5 2-7-2-5.5 2z" /><path d="M8.5 6.5v12M15.5 8.5v12" /></g><path fill="currentColor" stroke="none" d="M5.75 11.5l.6 1.65 1.65.6-1.65.6-.6 1.65-.6-1.65-1.65-.6 1.65-.6z" /><g className="fi-m"><path d="M15.5 13.75s-3.75-3.2-3.75-6.25a3.75 3.75 0 0 1 7.5 0c0 3.05-3.75 6.25-3.75 6.25z" /><circle cx="15.5" cy="7.5" r="1" /></g>
    </IconBase>
  )
}
