/*
 * Meta's template rejection codes in plain Arabic (Figma M10 «مرفوض»). The original code is shown too,
 * left-to-right under «النص الأصلي من ميتا», so nothing is hidden behind the translation.
 */
const REASON_AR: Record<string, string> = {
  INCORRECT_CATEGORY: 'التصنيف ما يناسب نص الرسالة. غيّر التصنيف وأرسله من جديد.',
  INVALID_FORMAT: 'شكل القالب غير صحيح (المتغيرات أو الأزرار). راجع المتغيرات وأرسله من جديد.',
  TAG_CONTENT_MISMATCH: 'نوع القالب ما يطابق محتواه. غيّر النوع أو النص.',
  PROMOTIONAL: 'النص ترويجي بينما التصنيف غير «تسويق». غيّره إلى «تسويق».',
  ABUSIVE_CONTENT: 'ميتا اعتبرت النص مخالفاً لسياساتها. أعد صياغته بلغة عادية.',
  SCAM: 'ميتا اشتبهت إن الرسالة احتيال. وضّح من أنت ووش تبي.',
}

export function metaReasonAr(reason?: string | null): { ar: string; original: string } | null {
  const r = String(reason || '').trim()
  if (!r || r === 'NONE') return null
  return { ar: REASON_AR[r.toUpperCase()] || 'رفضت ميتا القالب. راجع النص والتصنيف وأرسله من جديد.', original: r }
}
