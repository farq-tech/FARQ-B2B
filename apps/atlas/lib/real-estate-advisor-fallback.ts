import { numberFormat } from './insights-api'

type OptionFacts = {
  label: string
  summary: string
  price: number | null
  priceUnit: string | null
  area: number | null
  villaShare: number | null
}

type DistrictFacts = {
  label: string
  name: string
  population: number | null
  businesses: number | null
  residentsPerBusiness: number | null
  income: number | null
  villaShare: number | null
  underConstruction: number | null
  medians: Map<string, number>
}

const number = (value: string) => Number(value.replaceAll(',', ''))
const format = (value: number) => numberFormat.format(value)

function optionFacts(block: string): OptionFacts | null {
  const [rawSummary = '', districtLine = ''] = block.split('\n')
  const summary = rawSummary.trim()
  if (!/^الخيار\s+[^:]+:\s*(?:غرفة|شقة|دور|فيلا|محل|مكتب|مستودع|أرض|استديو|عقار)(?:\s|$)/.test(summary)) return null
  const priceMatch = summary.match(/\|\s*([\d,]+(?:\.\d+)?) ريال(?:\s+(سنوياً|شهرياً))?/)
  const areaMatch = summary.match(/\|\s*([\d,]+(?:\.\d+)?) م²/)
  const villaMatch = districtLine.match(/حصة الفلل من المساكن\s+([\d,]+(?:\.\d+)?)%/)
  const label = summary.match(/^الخيار\s+([^:]+):/)?.[1] ?? ''
  return {
    label,
    summary,
    price: priceMatch ? number(priceMatch[1]) : null,
    priceUnit: priceMatch ? `${summary.includes('للإيجار') ? 'إيجار' : 'بيع'}:${priceMatch[2] ?? (summary.includes('للإيجار') && summary.includes('المدة غير مذكورة') ? 'مدة غير مذكورة' : 'مبلغ')}` : null,
    area: areaMatch ? number(areaMatch[1]) : null,
    villaShare: villaMatch ? number(villaMatch[1]) : null,
  }
}

function districtFacts(line: string): DistrictFacts | null {
  const label = line.match(/^الخيار\s+([^:]+):/)?.[1]
  const name = line.match(/^الخيار\s+[^:]+:\s*حي\s+([^|]+)/)?.[1]?.trim()
  if (!label || !name) return null
  const value = (pattern: RegExp) => {
    const match = line.match(pattern)
    return match ? number(match[1]) : null
  }
  const medians = new Map<string, number>()
  for (const [key, pattern] of [
    ['rent_year_residential', /وسيط إيجار السكن السنوي للمتر\s+([\d,]+(?:\.\d+)?)/],
    ['rent_month_residential', /وسيط إيجار السكن الشهري للمتر\s+([\d,]+(?:\.\d+)?)/],
    ['sale_residential', /وسيط سعر بيع السكن للمتر\s+([\d,]+(?:\.\d+)?)/],
    ['rent_year_commercial', /وسيط إيجار المحل السنوي للمتر\s+([\d,]+(?:\.\d+)?)/],
    ['rent_unstated_commercial', /وسيط إيجار المحل للمتر \(المدة غير مذكورة\)\s+([\d,]+(?:\.\d+)?)/],
    ['sale_land', /وسيط سعر الأرض للمتر\s+([\d,]+(?:\.\d+)?)/],
  ] as const) {
    const median = value(pattern)
    if (median != null) medians.set(key, median)
  }
  return {
    label,
    name,
    population: value(/السكان\s+([\d,]+(?:\.\d+)?)/),
    businesses: value(/المنشآت\s+([\d,]+(?:\.\d+)?)/),
    residentsPerBusiness: value(/ساكن لكل منشأة\s+([\d,]+(?:\.\d+)?)/),
    income: value(/متوسط الدخل الشهري\s+([\d,]+(?:\.\d+)?)/),
    villaShare: value(/حصة الفلل من المساكن\s+([\d,]+(?:\.\d+)?)/),
    underConstruction: value(/مبانٍ تحت الإنشاء\s+([\d,]+(?:\.\d+)?)/),
    medians,
  }
}

function comparisonLine(a: OptionFacts, b: OptionFacts, profile: string): string | null {
  if (profile.includes('السعر الأقل')) {
    if (a.price != null && b.price != null && a.priceUnit === b.priceUnit) {
      const cheaper = a.price === b.price ? null : a.price < b.price ? a : b
      return cheaper
        ? `بحسب السعر المعلن في المدة نفسها، الخيار ${cheaper.label} أقل سعراً (${format(Math.min(a.price, b.price))} مقابل ${format(Math.max(a.price, b.price))} ريال).`
        : `السعران المعلنان متساويان (${format(a.price)} ريال)؛ قارن بقية الشروط.`
    }
    return 'لا أستطيع تحديد الأقل سعراً من البيانات المتاحة لأن السعر أو مدة الإيجار غير مكتملة أو مختلفة.'
  }
  if (profile.includes('مساحة أكبر')) {
    if (a.area != null && b.area != null) {
      const larger = a.area === b.area ? null : a.area > b.area ? a : b
      return larger
        ? `الخيار ${larger.label} أكبر مساحةً (${format(Math.max(a.area, b.area))} م² مقابل ${format(Math.min(a.area, b.area))} م²).`
        : `المساحتان متساويتان (${format(a.area)} م²).`
    }
    return 'المساحة غير متاحة لكلا العرضين، لذلك لا يمكن مقارنتها.'
  }
  if (profile.includes('حي عائلي (فلل أكثر)')) {
    if (a.villaShare != null && b.villaShare != null) {
      const higher = a.villaShare === b.villaShare ? null : a.villaShare > b.villaShare ? a : b
      return higher
        ? `حصة الفلل أعلى في حي الخيار ${higher.label} (${format(Math.max(a.villaShare, b.villaShare))}% مقابل ${format(Math.min(a.villaShare, b.villaShare))}%). هذا وصف لنوع المساكن ولا يثبت وحده أن الحي أنسب للعائلة.`
        : `حصة الفلل متساوية في الحيين (${format(a.villaShare)}%). هذا المؤشر وحده لا يثبت ملاءمة الحي للعائلة.`
    }
    return 'حصة الفلل غير متاحة للمقارنة في الحيين؛ لا أستنتج ملاءمة الحي للعائلة من ذلك.'
  }
  if (profile.includes('حي هادئ قليل المحلات')) return 'لا تتوفر في هذه البيانات قياسات للضوضاء أو الهدوء، لذلك لا أستطيع ترتيب الحيين بهذا المعيار.'
  if (profile.includes('خدمات ومحلات قريبة')) return 'حقائق العرضين لا تتضمن مسافة الخدمات والمحلات، لذلك لا أستطيع تحديد أيهما أقرب إليها.'
  return null
}

function districtComparisonLine(a: DistrictFacts, b: DistrictFacts, profile: string): string | null {
  const compareLower = (key: keyof Pick<DistrictFacts, 'population' | 'businesses' | 'residentsPerBusiness' | 'income' | 'villaShare' | 'underConstruction'>, label: string) => {
    const first = a[key]
    const second = b[key]
    if (first == null || second == null) return `${label} غير متاح للمقارنة بين الحيين.`
    const lower = first === second ? null : first < second ? a : b
    return lower
      ? `${label} أقل في حي ${lower.name} (${format(Math.min(first, second))} مقابل ${format(Math.max(first, second))}).`
      : `${label} متساوٍ في الحيين (${format(first)}).`
  }
  if (profile.includes('السعر الأقل')) {
    const shared = [...a.medians.keys()].filter((key) => b.medians.has(key))
    if (!shared.length) return 'وسيط السعر غير متاح بالمقياس نفسه في الحيين؛ لا يمكن تحديد الأقل سعراً.'
    const label: Record<string, string> = {
      rent_year_residential: 'وسيط إيجار السكن السنوي للمتر',
      rent_month_residential: 'وسيط إيجار السكن الشهري للمتر',
      sale_residential: 'وسيط بيع السكن للمتر',
      rent_year_commercial: 'وسيط إيجار المحل السنوي للمتر',
      rent_unstated_commercial: 'وسيط إيجار المحل للمتر بمدة غير مذكورة',
      sale_land: 'وسيط بيع الأرض للمتر',
    }
    return shared.map((key) => {
      const first = a.medians.get(key)!
      const second = b.medians.get(key)!
      const lower = first === second ? null : first < second ? a : b
      return lower
        ? `${label[key]} أقل في حي ${lower.name} (${format(Math.min(first, second))} مقابل ${format(Math.max(first, second))} ريال).`
        : `${label[key]} متساوٍ في الحيين (${format(first)} ريال).`
    }).join('\n')
  }
  if (profile.includes('مساحة أكبر')) return 'مساحة العقار غير متاحة من بيانات الحي؛ قارنها من تفاصيل كل عرض.'
  if (profile.includes('حي عائلي (فلل أكثر)')) {
    if (a.villaShare == null || b.villaShare == null) return 'حصة الفلل غير متاحة للمقارنة في الحيين.'
    const higher = a.villaShare === b.villaShare ? null : a.villaShare > b.villaShare ? a : b
    return higher
      ? `حصة الفلل أعلى في حي ${higher.name} (${format(Math.max(a.villaShare, b.villaShare))}% مقابل ${format(Math.min(a.villaShare, b.villaShare))}%). هذا وصف لنوع المساكن ولا يثبت وحده أن الحي أنسب للعائلة.`
      : `حصة الفلل متساوية في الحيين (${format(a.villaShare)}%). هذا المؤشر وحده لا يثبت ملاءمة الحي للعائلة.`
  }
  if (profile.includes('حي هادئ قليل المحلات')) return 'لا تتوفر قياسات للضوضاء أو الهدوء؛ لا أرتب الحيين بهذا المعيار.'
  if (profile.includes('خدمات ومحلات قريبة')) return 'بيانات الحي لا تقيس مسافة الخدمات والمحلات؛ عدد المنشآت لا يثبت قربها من العقار.'
  return [
    compareLower('population', 'عدد السكان'),
    compareLower('businesses', 'عدد المنشآت'),
    compareLower('residentsPerBusiness', 'عدد السكان لكل منشأة'),
    compareLower('income', 'متوسط دخل العامل الشهري'),
    compareLower('underConstruction', 'المباني تحت الإنشاء'),
  ].join('\n')
}

/** Honest, local response when the model refuses or the advisor service is unavailable. */
export function realEstateAdvisorFallback(facts: string, profile: string): string {
  const blocks = facts.split(/\n\n(?=الخيار [^:]+:)/)
  const options = blocks.map(optionFacts).filter((item): item is OptionFacts => item !== null)
  const districts = facts.split('\n').map(districtFacts).filter((item): item is DistrictFacts => item !== null)
  const lines = [
    'استناداً إلى بيانات أطلس المتاحة:',
    ...options.map((option) => `- ${option.summary}`),
    ...districts.map((district) => `- حي ${district.name}: السكان ${district.population == null ? 'غير متاح' : format(district.population)}، المنشآت ${district.businesses == null ? 'غير متاح' : format(district.businesses)}، متوسط دخل العامل الشهري ${district.income == null ? 'غير متاح' : `${format(district.income)} ريال`}.`),
  ]
  if (options.length === 2) {
    const comparison = comparisonLine(options[0], options[1], profile)
    if (comparison) lines.push(comparison)
  }
  if (districts.length === 2) {
    const comparison = districtComparisonLine(districts[0], districts[1], profile)
    if (comparison) lines.push(comparison)
  }
  if (options.length) lines.push('السعر في الإعلان ليس صفقة مكتملة، وبيانات أطلس لا تثبت توفر العرض أو حالته. تحقق من التفاصيل مع المعلن.')
  if (districts.length) lines.push('هذه مقاييس على مستوى الحي؛ لا تثبت قرب الخدمات أو ملاءمة الحي لكل شخص.')
  return lines.join('\n')
}
