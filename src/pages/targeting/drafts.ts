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
