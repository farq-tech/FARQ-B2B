import { IconBase, type FarqIconProps } from './base'

/**
 * واتساب-عام — A phone handset in a rounded chat bubble — generic messaging, not the WhatsApp brand mark.
 * Used in: WhatsApp channel badge, template preview header.
 */
export function WhatsAppGenericIcon(props: FarqIconProps) {
  return (
    <IconBase name="whatsapp-generic" {...props}>
      <path className="fi-fill" d="M6 3.5h12A2.5 2.5 0 0 1 20.5 6v9a2.5 2.5 0 0 1-2.5 2.5h-7L6.5 21v-3.5H6A2.5 2.5 0 0 1 3.5 15V6A2.5 2.5 0 0 1 6 3.5z" /><path d="M9.5 6.75h1.4l.75 1.9-.95.6a4.7 4.7 0 0 0 2.5 2.5l.6-.95 1.9.75v1.4a1 1 0 0 1-1.05 1A7 7 0 0 1 8.5 7.8a1 1 0 0 1 1-1.05z" />
    </IconBase>
  )
}
