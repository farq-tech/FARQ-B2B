/*
 * Template drafts (screen 08) live in this tab's memory only (owner 2026-10-16: nothing stored on the device):
 * a reload clears them. A server endpoint for drafts is being built; until then nothing persists.
 */
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
export type HeaderKind = 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT'
export type TemplateDraft = {
  name: string
  label: string
  language: 'ar' | 'en'
  category: TemplateCategory
  header: HeaderKind
  headerText: string
  body: string
  examples: Record<string, string>
  footer: string
  buttons: { text: string; kind: 'QUICK_REPLY' | 'OPT_OUT' }[]
  savedAt: string
}

let drafts: TemplateDraft[] = []

export function loadDrafts(): TemplateDraft[] {
  return [...drafts]
}

export function saveDraft(d: TemplateDraft): boolean {
  drafts = [d, ...drafts.filter((x) => x.name !== d.name)].slice(0, 50)
  return true
}

export const CATEGORY_LABEL: Record<TemplateCategory, string> = { MARKETING: 'تسويق', UTILITY: 'خدمة', AUTHENTICATION: 'مصادقة' }

export function removeDraft(name: string) {
  drafts = drafts.filter((x) => x.name !== name)
}

const varsOf = (body: string) => [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))].sort((a, b) => +a - +b)

/** Why this draft cannot go to Meta yet (null = ready). */
export function submitBlock(d: Omit<TemplateDraft, 'savedAt'>): string | null {
  if (!/^[a-z0-9_]{1,512}$/.test(d.name)) return 'اكتب اسم القالب بحروف إنجليزية صغيرة وشرطة سفلية'
  if (!d.body.trim()) return 'اكتب نص الرسالة'
  if (d.header === 'IMAGE' || d.header === 'DOCUMENT') return 'رأس الصورة أو الملف يحتاج رفع مثال لـMeta — اختر «نص» أو «بدون»'
  if (d.header === 'TEXT' && !d.headerText.trim()) return 'اكتب نص الرأس أو اختر «بدون»'
  const vars = varsOf(d.body)
  if (vars.join(',') !== '1,2') return 'كل قالب حملة يحتاج المتغيرين {{1}} لاسم المنشأة و{{2}} لنص الحملة'
  if (vars.some((v) => !(d.examples[v] || '').trim())) return 'اكتب مثال لكل متغير'
  return null
}

/** The draft in Meta's template format (positional variables, quick replies). */
export function toMetaComponents(d: Omit<TemplateDraft, 'savedAt'>) {
  const vars = varsOf(d.body)
  const out: Record<string, unknown>[] = []
  if (d.header === 'TEXT' && d.headerText.trim()) out.push({ type: 'HEADER', format: 'TEXT', text: d.headerText.trim() })
  out.push(vars.length ? { type: 'BODY', text: d.body.trim(), example: { body_text: [vars.map((v) => d.examples[v].trim())] } } : { type: 'BODY', text: d.body.trim() })
  if (d.footer.trim()) out.push({ type: 'FOOTER', text: d.footer.trim() })
  const buttons = d.buttons.filter((b) => b.text.trim()).map((b) => ({ type: 'QUICK_REPLY', text: b.text.trim() }))
  if (buttons.length) out.push({ type: 'BUTTONS', buttons })
  return out as ({ type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' } & Record<string, unknown>)[]
}
