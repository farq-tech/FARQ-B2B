// with extensions, so node --test can load this file for journey-logic.test.ts
import { counted, numberFormat } from '../../lib/insights-api.ts'
import { homesHref, priceStartHref } from '../../lib/handoff.ts'
import type { DistrictRow } from './city-data.ts'
import type { JourneyStep, LensId, ToolId } from './lenses.ts'

const show = (value: number | null | undefined) => (value == null ? 'غير متاح' : numberFormat.format(value))

/**
 * Why a step that is still working takes long, and what the customer can do meanwhile: said once it has run past the
 * slow mark (useAnswer's `slow`), under the steps, in place of a skeleton that says nothing.
 */
export const STEP_WAIT: Record<ToolId, { why: string; meanwhile: string }> = {
  gaps: { why: 'نقارن عدد منشآت نشاطك بسكان كل حي في المدينة.', meanwhile: 'في المدن الكبيرة يأخذ حتى نصف دقيقة. انتظر هنا، أو اكتب نشاطاً أدق.' },
  competitors: { why: 'نعدّ منشآت النشاط وسلاسله في كل حي.', meanwhile: 'انتظر هنا، أو اختر نشاطاً رئيسياً من القائمة فيكون أسرع.' },
  corridors: { why: 'نقيس المحلات على طول كل شارع في المدينة.', meanwhile: 'انتظر هنا، أو اختر نشاطاً أدق.' },
  around: { why: 'نحسب من يسكن ومن يعمل داخل نطاق كل موقع.', meanwhile: 'نطاق القيادة يُحسب على الطرق ويأخذ أطول من الدائرة.' },
  homes: { why: 'نجمع العروض المعروضة الآن ونقارن كل عرض بوسيط حيّه.', meanwhile: 'انتظر هنا، أو اختر حياً ليقلّ عدد العروض.' },
  audience: { why: 'نجمع أرقام الجمهور المقاسة لكل حي.', meanwhile: 'انتظر هنا؛ الترتيب يظهر حين تكتمل.' },
  businesses: { why: 'نبحث في دليل المنشآت للأحياء المختارة.', meanwhile: 'انتظر هنا، أو اختر حياً واحداً.' },
  territories: { why: 'نقسّم المدينة كلها بين مندوبيك.', meanwhile: 'انتظر هنا، أو اختر نشاط عملائك ليقلّ عدد المنشآت.' },
  growth: { why: 'نجمع المباني الجديدة وتحت الإنشاء لكل حي.', meanwhile: 'انتظر هنا.' },
  district: { why: 'نجمع أرقام الأحياء.', meanwhile: 'انتظر هنا.' },
  compare: { why: 'نجمع أرقام الحيين.', meanwhile: 'انتظر هنا.' },
}

export type StepLine = { text: string; tone: 'answer' | 'ask' | 'loading' | 'slow' | 'error' }

/**
 * The one line a step says where its answer goes (the phone's peeking sheet): its own answer, else that it is working
 * (or slow, or failed), else what the customer does on it. Only the ranking steps fall back to the shading's top district.
 */
export function stepLine({ tool, step, summary, state, slow, rankLine }: {
  tool: ToolId
  step: Pick<JourneyStep, 'label' | 'ask'> | null
  summary?: string | null
  state?: 'loading' | 'error' | null
  slow?: boolean
  rankLine?: string | null
}): StepLine | null {
  if (summary) return { text: summary, tone: 'answer' }
  const label = step?.label ?? ''
  if (state === 'error') return { text: `تعذّر حساب «${label}» الآن`, tone: 'error' }
  if (state === 'loading') return slow ? { text: `ما زلنا نحسب «${label}»، ويأخذ أطول من المعتاد`, tone: 'slow' } : { text: `جارٍ حساب «${label}»…`, tone: 'loading' }
  if ((tool === 'district' || tool === 'growth') && rankLine) return { text: rankLine, tone: 'answer' }
  if (step?.ask) return { text: step.ask, tone: 'ask' }
  return rankLine ? { text: rankLine, tone: 'answer' } : null
}

/**
 * The answer line of a step whose answer is the picked districts themselves (no request of its own), from their golden
 * rows as loaded: a missing figure reads «غير متاح». Null with nothing picked.
 */
export function pickedLine(tool: ToolId, picked: readonly DistrictRow[]): string | null {
  if (!picked.length) return null
  const one = picked.length === 1 ? picked[0] : null
  if (tool === 'compare') return picked.length === 2 ? `${picked[0].name} مقابل ${picked[1].name}` : null
  if (tool === 'growth') {
    if (!one) return `${counted(picked.length, 'district')} مختارة`
    const built = one.underConstruction != null && one.newBuildings != null ? one.underConstruction + one.newBuildings : null
    return `${one.name}: ${show(built)} مبنى جديد وتحت الإنشاء`
  }
  if (tool === 'district') {
    if (!one) return `${counted(picked.length, 'district')}: ${picked.map((row) => row.name).join('، ')}`
    return `${one.name}: ${show(one.population)} ساكن · ${show(one.businesses)} منشأة`
  }
  return null
}

/** One action of the decision card: open the picked districts' businesses (where a quote, a campaign or a list is made
 * from the picks, components/lens/businesses-panel.tsx), open a step on districts, or follow a link to another page. */
export type DecisionAction =
  | { kind: 'businesses'; ids: string[]; label: string }
  | { kind: 'step'; tool: ToolId; ids: string[]; label: string }
  | { kind: 'link'; href: string; label: string }

export type Decision = { title: string; pick: string | null; actions: DecisionAction[] }

const byGrowth = (rows: readonly DistrictRow[]) => rows
  .map((row) => ({ row, built: row.underConstruction != null && row.newBuildings != null ? row.underConstruction + row.newBuildings : null }))
  .filter((item): item is { row: DistrictRow; built: number } => item.built != null && item.built > 0)
  .sort((a, b) => b.built - a.built)

/**
 * The card each group's journey closes on: what the journey points to (the district an earlier step put first, or the
 * districts picked) and the actions that act on it, through the flows that already exist (the businesses list makes
 * the quote request, the campaign or the list after review; «العقار» and «سعّر عقارك» take the district by link).
 * Never a recommendation the steps did not make: no pick, no «قرارك».
 */
export function decisionFor({ lens, city, rows, picked, leads, activity, done = [] }: {
  lens: LensId
  /** The steps answered in this visit: the growth ranking points to a district only once its step was opened. */
  done?: readonly ToolId[]
  city: string
  rows: readonly DistrictRow[]
  picked: readonly DistrictRow[]
  leads: Partial<Record<ToolId, string>>
  activity: string | null
}): Decision {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const lead = (tool: ToolId) => (leads[tool] ? byId.get(leads[tool]!) ?? null : null)
  const one = picked.length === 1 ? picked[0] : null
  switch (lens) {
    case 'shops': {
      const place = one ?? lead('gaps')
      const title = activity ? `أين تفتح «${activity}»` : 'أين تفتح'
      if (!place) return { title, pick: null, actions: [] }
      return {
        title,
        pick: one ? `الحي الذي اخترته: ${place.name}` : `أكثر حي ينقصه نشاطك: ${place.name}`,
        actions: [
          { kind: 'step', tool: 'homes', ids: [place.id], label: `محلات للإيجار في ${place.name}` },
          { kind: 'businesses', ids: [place.id], label: `منشآت ${place.name}: اطلب تسعيراً أو احفظ قائمة` },
        ],
      }
    }
    case 'marketers': {
      const places = picked.length ? [...picked] : lead('audience') ? [lead('audience')!] : []
      const title = 'أين تركّز حملتك'
      if (!places.length) return { title, pick: null, actions: [] }
      const names = places.map((row) => row.name).join('، ')
      return {
        title,
        pick: picked.length ? `الأحياء التي اخترتها: ${names}` : `أعلى حي مطابق لجمهورك: ${names}`,
        actions: [{ kind: 'businesses', ids: places.map((row) => row.id), label: `جهّز حملة لمنشآت ${places.length === 1 ? names : counted(places.length, 'district')}` }],
      }
    }
    case 'distributors': {
      const place = one ?? (done.includes('growth') ? byGrowth(rows)[0]?.row ?? null : null)
      const title = 'أين ينمو عملاؤك'
      if (!place) return { title, pick: null, actions: [] }
      return {
        title,
        pick: one ? `الحي الذي اخترته: ${place.name}` : `أكثر حي يُبنى فيه الآن: ${place.name}`,
        actions: [
          { kind: 'businesses', ids: [place.id], label: `منشآت ${place.name}: احفظها قائمة لمندوبك` },
          { kind: 'step', tool: 'territories', ids: [], label: 'ارجع إلى المناطق والمسار' },
        ],
      }
    }
    case 'analysts': {
      const title = 'المقارنة'
      if (picked.length !== 2) return { title, pick: null, actions: [] }
      return { title, pick: `${picked[0].name} مقابل ${picked[1].name}`, actions: [] }
    }
    case 'property': {
      const place = one ?? lead('homes')
      const title = 'العرض والحي'
      if (!place) return { title, pick: null, actions: [] }
      return {
        title,
        pick: one ? `الحي الذي اخترته: ${place.name}` : `حي العرض الأنسب: ${place.name}`,
        actions: [
          { kind: 'link', href: homesHref({ city, districts: [place.id] }), label: `كل عروض ${place.name} في «العقار»` },
          { kind: 'link', href: priceStartHref({ city, district: place.id }), label: `سعّر عقاراً في ${place.name}` },
        ],
      }
    }
  }
}
