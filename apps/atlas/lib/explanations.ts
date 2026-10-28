import { numberFormat } from '@/lib/insights-api'

/**
 * How each figure in Atlas is worked out, in plain Arabic, shown when the figure is tapped. One place for every
 * screen. The wording names the method, never an outside source (docs/atlas-product-foundation.md §5), and an
 * estimate is always called an estimate.
 */
const n = (value: number) => numberFormat.format(Math.round(value))

/** Population sources of the golden table (services/targeting-api/golden.py). */
export function populationMethod(source: string | null | undefined): string {
  if (source?.startsWith('910ths')) return 'رقم مقاس لهذا الحي.'
  if (source === 'farq_buildings_v3') return 'تقدير: عدد الوحدات السكنية في مباني الحي × متوسط الأفراد في الوحدة في أحياء المدينة المقاسة.'
  return 'تقدير من خرائط كثافة السكان بالأقمار الصناعية، مجموعة داخل حدود الحي.'
}

export const EXPLAIN = {
  population(sources: (string | null | undefined)[], total: number | null): string[] {
    if (sources.length === 1) return [populationMethod(sources[0])]
    const measured = sources.filter((source) => source?.startsWith('910ths')).length
    return [
      `مجموع سكان ${n(sources.length)} حياً.`,
      measured === sources.length ? 'كل الأحياء أرقامها مقاسة.' : `${n(measured)} منها أرقامها مقاسة، والباقي تقدير من مباني الحي أو من خرائط الكثافة.`,
      ...(total == null ? ['يظهر «غير متاح» إذا كان حي واحد على الأقل بلا رقم.'] : []),
    ]
  },
  businesses(scope: 'district' | 'districts' | 'city'): string[] {
    const where = scope === 'city' ? 'في المدينة كلها' : scope === 'districts' ? 'في الأحياء المحددة' : 'داخل حدود الحي'
    return [`عدد المنشآت القائمة في دليل فرق ${where}.`, 'لا تُحسب المنشآت المغلقة نهائياً.']
  },
  residentsPerBusiness(people: number | null, businesses: number | null): string[] {
    return people != null && businesses
      ? ['السكان ÷ المنشآت.', `${n(people)} ÷ ${n(businesses)} = ${n(people / businesses)}`, 'كلما ارتفع الرقم قلّت المنشآت التي تخدم السكان.']
      : ['السكان ÷ المنشآت. غير متاح لأن أحد الرقمين غير متاح.']
  },
  restaurants: [
    'عدد المطاعم التي يرصدها فرق على تطبيقات التوصيل داخل حدود الحي، حسب موقع الفرع على الخريطة.',
    'المطعم الذي تتباعد فروعه كثيراً لا يُنسب لحي بعينه، فلا يُحسب هنا.',
    'يتحدّث الرقم كل ساعة.',
  ],
  whatsapp: ['المنشآت التي لها رقم جوال سعودي صالح عليه علامة واتساب في دليل فرق.', 'العلامة لا تعني أن الرقم نشط الآن.'],
  sex: ['نسبة الذكور والإناث من سكان الحي، مقاسة لهذا الحي.', 'تظهر «غير متاح» حيث لا يوجد قياس.'],
  saudi: ['نسبة السعوديين من سكان الحي، مقاسة لهذا الحي.', 'تظهر «غير متاح» حيث لا يوجد قياس.'],
  income: ['متوسط الدخل الشهري للفرد العامل في الحي، مقاس لهذا الحي.', 'متوفر في الرياض فقط حالياً.'],
  growth(underConstruction: number | null, newBuildings: number | null): string[] {
    return underConstruction != null && newBuildings != null
      ? ['مبانٍ تحت الإنشاء + مبانٍ جديدة ظهرت منذ آخر مسح للمباني.', `${n(underConstruction)} + ${n(newBuildings)} = ${n(underConstruction + newBuildings)}`]
      : ['مبانٍ تحت الإنشاء + مبانٍ جديدة ظهرت منذ آخر مسح للمباني. غير متاح لهذا الحي.']
  },
  topAge: ['الفئة العمرية الأكبر عدداً.', 'توزيع الأعمار نمط المنطقة كلها مضبوطاً على عدد سكان الحي، وليس قياساً لكل حي.'],
  activities: ['عدد منشآت كل نشاط رئيسي في الحي من دليل فرق.', 'المنشأة قد تُحسب في أكثر من نشاط.'],
  gap(expected: number, present: number, rate: number): string[] {
    return [
      `معدل المدينة لهذا النشاط: منشأة لكل ${n(rate)} ساكن.`,
      `المتوقع للحي = سكانه ÷ ${n(rate)} = ${n(expected)} منشأة.`,
      `الموجود ${n(present)}، فالفرق ${n(expected - present)}.`,
      'الفرق الموجب يعني منشآت أقل مما يتحمله عدد السكان.',
    ]
  },
  aroundPeople: ['مجموع سكان المباني السكنية داخل الدائرة.', 'سكان كل حي موزعون على مبانيه بحسب عدد الوحدات السكنية في كل مبنى.'],
  aroundHomes: ['عدد الوحدات السكنية في المباني داخل الدائرة، من طبقة مباني فرق.'],
  aroundBusinesses: ['المنشآت القائمة في دليل فرق التي يقع موقعها داخل الدائرة.'],
  territory(weight: 'population' | 'businesses'): string[] {
    return [
      'الأحياء مرتبة على مسار يمر بمراكزها، ثم قُسمت إلى مناطق متجاورة.',
      `لكل مندوب حصة متساوية تقريباً من ${weight === 'population' ? 'السكان' : 'المنشآت'}.`,
    ]
  },
  shading(label: string): string[] {
    return [`الأحياء مرتبة حسب «${label}» ومقسومة إلى خمس مجموعات متساوية العدد.`, 'الأفتح هي الأعلى. الحي بلا رقم يبقى بلا لون.']
  },
}
