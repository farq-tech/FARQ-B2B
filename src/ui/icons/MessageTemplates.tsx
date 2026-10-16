import { IconBase, type FarqIconProps } from './base'

/**
 * قوالب الرسائل — A chat bubble with two text lines and two small reply buttons (not the WhatsApp logo).
 * Used in: Sidebar «قوالب واتساب», «القوالب» buttons on خريطة الفرص.
 * Mirrors in RTL.
 */
export function MessageTemplatesIcon(props: FarqIconProps) {
  return (
    <IconBase name="message-templates" mirror {...props}>
      <path className="fi-fill" d="M6 3h12a2.5 2.5 0 0 1 2.5 2.5v3.5a2.5 2.5 0 0 1-2.5 2.5H9.5L6.5 14v-2.5H6A2.5 2.5 0 0 1 3.5 9V5.5A2.5 2.5 0 0 1 6 3z" /><path d="M7.5 6h8M7.5 8.5h4.5" /><rect x="3.5" y="16.75" width="7.5" height="3.75" rx="1.875" /><rect x="13" y="16.75" width="7.5" height="3.75" rx="1.875" />
    </IconBase>
  )
}
