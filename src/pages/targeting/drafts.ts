/*
 * Template drafts (screen 08) live in this browser only until the service has a template endpoint:
 * the targeting service can read one template's Meta status but cannot list, create or submit templates.
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

const KEY = 'farq.targeting.templateDrafts'

export function loadDrafts(): TemplateDraft[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function saveDraft(d: TemplateDraft): boolean {
  try {
    const all = loadDrafts().filter((x) => x.name !== d.name)
    localStorage.setItem(KEY, JSON.stringify([d, ...all].slice(0, 50)))
    return true
  } catch { return false }
}

export const CATEGORY_LABEL: Record<TemplateCategory, string> = { MARKETING: 'تسويق', UTILITY: 'خدمة', AUTHENTICATION: 'مصادقة' }

export function removeDraft(name: string) {
  try { localStorage.setItem(KEY, JSON.stringify(loadDrafts().filter((x) => x.name !== name))) } catch { /* storage blocked */ }
}

const varsOf = (body: string) => [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))].sort((a, b) => +a - +b)

/** Why this draft cannot go to Meta yet (null = ready). */
export function submitBlock(d: Omit<TemplateDraft, 'savedAt'>): string | null {
  if (!/^[a-z0-9_]{1,512}$/.test(d.name)) return 'اكتب اسم القالب بحروف إنجليزية صغيرة وشرطة سفلية'
  if (!d.body.trim()) return 'اكتب نص الرسالة'
  if (d.header === 'IMAGE' || d.header === 'DOCUMENT') return 'رأس الصورة أو الملف يحتاج رفع مثال لـMeta — اختر «نص» أو «بدون»'
  if (d.header === 'TEXT' && !d.headerText.trim()) return 'اكتب نص الرأس أو اختر «بدون»'
  const vars = varsOf(d.body)
  if (!vars.every((v, i) => +v === i + 1)) return 'رقّم المتغيرات بالترتيب: {{1}} ثم {{2}}…'
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
