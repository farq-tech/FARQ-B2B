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
  audiencePeople(segmented: boolean, minIncome: number): string[] {
    return [
      'سكان كل حي من الجدول الذهبي للسكان، مجموعين على الأحياء المطابقة.',
      ...(segmented ? ['حصة الرجال أو النساء، والسعوديين أو غيرهم، مقاسة لكل حي ثم ضُربت في سكانه. الحي بلا حصة مقاسة لا يُحسب.'] : []),
      ...(minIncome ? [`أحياء متوسط دخل العامل فيها ${n(minIncome)} ريال شهرياً أو أكثر. الحي بلا دخل مقاس لا يُحسب.`] : []),
      'تقدير لحجم الجمهور، لا قائمة أشخاص.',
    ]
  },
  audienceBusinesses: ['المنشآت القائمة في دليل فرق داخل الأحياء المطابقة، للنشاط المختار.', 'التواصل يبقى يدوياً وبعد مراجعة.'],
  audienceScore: ['درجة من 100 داخل المدينة: جمهور الحي ÷ جمهور أعلى حي × 100.', 'الحي الرمادي ليس فيه جمهور مطابق، والحي بلا لون رقمه غير متاح.'],
  realEstate(listings: number | null | undefined, deal: string): string[] {
    const what = deal.startsWith('rent_year') ? 'الإيجار السنوي' : deal.startsWith('rent_month') ? 'الإيجار الشهري' : deal.startsWith('rent_unstated') ? 'الإيجار في العروض التي لا تذكر مدته' : 'سعر البيع'
    return [
      `وسيط ${what} للمتر في العروض المعروضة حالياً داخل حدود الحي: السعر كما في الإعلان ÷ المساحة.`,
      'كل مدة إيجار تُحسب وحدها ولا تُحوَّل إلى غيرها.',
      'سعر معروض لا سعر صفقة، والصفقة تُغلق غالباً بأقل منه.',
      listings == null ? 'يظهر «غير متاح» إذا كان في الحي أقل من 5 عروض من هذا النوع.' : `محسوب من ${n(listings)} عرضاً، نُسب كل منها للحي بموقعه على الخريطة.`,
    ]
  },
  villaShare: [
    'عدد الفلل ÷ عدد الوحدات السكنية في مباني الحي، من طبقة مباني فرق.',
    'مؤشر لمستوى السكن حيث لا يُنشر الدخل: نسبة أعلى تعني مساكن أوسع في الغالب.',
    'يظهر «غير متاح» للحي الذي فيه أقل من 200 وحدة سكنية.',
  ],
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
  aroundPeople: ['مجموع سكان المباني السكنية داخل المنطقة.', 'سكان كل حي موزعون على مبانيه بحسب عدد الوحدات السكنية في كل مبنى.'],
  aroundHomes: ['عدد الوحدات السكنية في المباني داخل المنطقة، من طبقة مباني فرق.'],
  aroundBusinesses: ['المنشآت القائمة في دليل فرق التي يقع موقعها داخل المنطقة.'],
  driveArea(minutes: number): string[] {
    return [`كل الطرق التي تصلها سيارة من الموقع خلال ${n(minutes)} دقائق، محسوبة على شبكة الطرق الفعلية وسرعاتها المعتادة.`, 'لا تشمل الزحام اللحظي، فهي أقرب لوقت القيادة في ساعة هادئة.', 'تحتاج تسجيل الدخول.']
  },
  territory(weight: 'population' | 'businesses'): string[] {
    return [
      'الأحياء مرتبة على مسار يمر بمراكزها، ثم قُسمت إلى مناطق متجاورة.',
      `لكل مندوب حصة متساوية تقريباً من ${weight === 'population' ? 'السكان' : 'المنشآت'}.`,
    ]
  },
  shading(label: string): string[] {
    return [`الأحياء مرتبة حسب «${label}» ومقسومة إلى خمس مجموعات متساوية العدد.`, 'الأفتح هي الأعلى. الحي بلا رقم يبقى بلا لون.']
  },
  listingPerSqm(deal: string | null): string[] {
    return [
      'السعر كما في الإعلان ÷ المساحة، بالمدة التي يذكرها الإعلان.',
      deal === 'rent_unstated' ? 'الإعلان لا يذكر هل الإيجار شهري أم سنوي.' : 'سعر معروض لا سعر صفقة.',
    ]
  },
  listingCheck: [
    'رقم في الإعلان يبدو غير صحيح: مساحة مبنى كامل على وحدة، أو سعر بعيد جداً عن أسعار الحي، أو غرفة، أو لا سعر.',
    'يبقى ظاهراً لكنه لا يدخل في أسعار الحي. تحقق منه في الإعلان.',
  ],
  listingVersusDistrict: [
    'سعر المتر في هذا العرض مقارنة بوسيط سعر المتر لعروض النوع نفسه (سكني، تجاري، أرض…) داخل الحي.',
    'أقل من الوسيط قد يعني فرصة، أو عيباً لا يظهر في الأرقام كالعمر والتشطيب. افتح الإعلان قبل القرار.',
  ],
  bestListings: [
    'العروض المطابقة لاختيارك مرتبة من الأقل سعراً للمتر مقارنة بوسيط حيّها إلى الأعلى.',
    'العرض في حي بلا وسيط كافٍ يأتي في الآخر.',
  ],
}
