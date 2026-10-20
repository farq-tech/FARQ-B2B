import type {
  Business,
  Channel,
  City,
  Consent,
  District,
  InboxMessage,
  Point,
  RequestItem,
  Role,
  Street,
  Template,
} from './types'

/** Deterministic PRNG so server and client render identical mock data. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const MAP_WIDTH = 1000
export const MAP_HEIGHT = 700

export const CITIES: City[] = [
  { id: 'riyadh', name: 'الرياض', available: true },
  { id: 'jeddah', name: 'جدة', available: true },
  { id: 'dammam', name: 'الدمام', available: true },
  { id: 'abha', name: 'أبها', available: false },
]

const DISTRICT_SHAPES: Point[][] = [
  [[40, 40], [340, 34], [326, 330], [58, 340]],
  [[360, 36], [648, 52], [640, 322], [344, 330]],
  [[668, 52], [962, 40], [950, 330], [660, 322]],
  [[58, 362], [326, 352], [334, 662], [40, 652]],
  [[346, 352], [640, 344], [652, 662], [352, 664]],
  [[662, 344], [950, 352], [962, 660], [672, 650]],
]

const CITY_DISTRICTS: Record<string, { name: string; streets: [string, string] }[]> = {
  riyadh: [
    { name: 'الملقا', streets: ['طريق أنس بن مالك', 'شارع الأمير محمد بن سعد'] },
    { name: 'العليا', streets: ['شارع التحلية', 'طريق الملك فهد'] },
    { name: 'الملز', streets: ['شارع الستين', 'شارع الجامعة'] },
    { name: 'السلي', streets: ['طريق الخرج', 'شارع الصناعة'] },
    { name: 'الصناعية الثانية', streets: ['شارع المصانع', 'طريق الحائر'] },
    { name: 'النسيم', streets: ['شارع حسان بن ثابت', 'طريق خريص'] },
  ],
  jeddah: [
    { name: 'الشاطئ', streets: ['طريق الكورنيش', 'شارع الأمير سلطان'] },
    { name: 'الروضة', streets: ['شارع صاري', 'شارع الأمير ماجد'] },
    { name: 'الصفا', streets: ['شارع التحلية', 'شارع حراء'] },
    { name: 'البلد', streets: ['شارع قابل', 'شارع الذهب'] },
    { name: 'الصناعية الأولى', streets: ['شارع المستودعات', 'طريق مكة القديم'] },
    { name: 'الحمدانية', streets: ['طريق عسفان', 'شارع الحمدانية العام'] },
  ],
  dammam: [
    { name: 'الشاطئ', streets: ['طريق الخليج', 'شارع الأمير محمد'] },
    { name: 'الفيصلية', streets: ['شارع الملك سعود', 'شارع الفيصلية التجاري'] },
    { name: 'المنار', streets: ['شارع أبو حدرية', 'شارع المنار العام'] },
    { name: 'العزيزية', streets: ['طريق الدمام الخبر', 'شارع العزيزية'] },
    { name: 'الصناعية الأولى', streets: ['شارع الورش', 'طريق الميناء'] },
    { name: 'النخيل', streets: ['شارع النخيل', 'طريق أبقيق'] },
  ],
}

export const CATEGORIES: { name: string; phrase: string; buyerPattern: string; buyerActivity: string; specialties: string[] }[] = [
  { name: 'مواد بناء', phrase: 'لمواد البناء', buyerPattern: 'شركة {w} للمقاولات', buyerActivity: 'مقاولات عامة', specialties: ['حديد تسليح', 'أسمنت', 'عوازل'] },
  { name: 'تغليف وتعبئة', phrase: 'للتغليف والتعبئة', buyerPattern: 'مخابز {w}', buyerActivity: 'مخابز وحلويات', specialties: ['كراتين شحن', 'أكياس بلاستيك', 'تغليف غذائي'] },
  { name: 'معدات مطاعم', phrase: 'لمعدات المطاعم', buyerPattern: 'مطاعم {w}', buyerActivity: 'مطاعم ومقاهي', specialties: ['أفران تجارية', 'ثلاجات عرض', 'أدوات مطبخ'] },
  { name: 'مواد غذائية', phrase: 'للمواد الغذائية', buyerPattern: 'أسواق {w}', buyerActivity: 'أسواق تموينية', specialties: ['بن وقهوة', 'تمور', 'زيوت'] },
  { name: 'مستلزمات طبية', phrase: 'للمستلزمات الطبية', buyerPattern: 'مجمع {w} الطبي', buyerActivity: 'مجمعات طبية', specialties: ['مستهلكات طبية', 'أجهزة تشخيص'] },
  { name: 'كهربائيات', phrase: 'للكهربائيات', buyerPattern: 'مجموعة {w} العقارية', buyerActivity: 'تطوير عقاري', specialties: ['إنارة', 'كابلات', 'لوحات كهربائية'] },
  { name: 'أثاث مكتبي', phrase: 'للأثاث المكتبي', buyerPattern: 'شركة {w} للاستشارات', buyerActivity: 'مكاتب وشركات', specialties: ['كراسي', 'مكاتب', 'تجهيز مكاتب'] },
  { name: 'قطع غيار', phrase: 'لقطع الغيار', buyerPattern: 'ورشة {w}', buyerActivity: 'ورش صيانة', specialties: ['قطع سيارات', 'معدات ثقيلة'] },
]

export const ROLES: Role[] = ['مصنع', 'مورد', 'موزع', 'تاجر تجزئة', 'مشتري مؤسسي']
export const CHANNELS: Channel[] = ['واتساب', 'هاتف', 'بريد إلكتروني']
export const SUPPLIER_ROLES: Role[] = ['مصنع', 'مورد', 'موزع']
export const BUYER_ROLES: Role[] = ['تاجر تجزئة', 'مشتري مؤسسي']

const WORDS = ['النخبة', 'الأفق', 'الريادة', 'الوفاء', 'السنابل', 'الجزيرة', 'المسار', 'الواحة', 'البيان', 'الصفوة', 'الإتقان', 'المدار', 'الرواد', 'الثريا', 'نجد', 'الخليج', 'الأصالة', 'البركة', 'الشروق', 'المتحدة', 'الأمانة', 'الضياء']

const ROLE_PREFIX: Record<Role, string[]> = {
  مصنع: ['مصنع', 'مصانع'],
  مورد: ['مؤسسة', 'شركة'],
  موزع: ['مستودعات', 'شركة توزيع'],
  'تاجر تجزئة': ['متجر', 'معرض'],
  'مشتري مؤسسي': [],
}

function centroid(poly: Point[]): Point {
  const x = poly.reduce((s, p) => s + p[0], 0) / poly.length
  const y = poly.reduce((s, p) => s + p[1], 0) / poly.length
  return [x, y]
}

function buildGeo() {
  const districts: District[] = []
  const streets: Street[] = []
  for (const city of CITIES) {
    const defs = CITY_DISTRICTS[city.id] ?? CITY_DISTRICTS.riyadh
    defs.forEach((def, i) => {
      const polygon = DISTRICT_SHAPES[i]
      const center = centroid(polygon)
      const id = `${city.id}-d${i}`
      districts.push({ id, name: def.name, cityId: city.id, polygon, center })
      const [cx, cy] = center
      streets.push({
        id: `${id}-s0`,
        name: def.streets[0],
        districtId: id,
        cityId: city.id,
        from: [cx - 118, cy - 52],
        to: [cx + 118, cy - 36],
      })
      streets.push({
        id: `${id}-s1`,
        name: def.streets[1],
        districtId: id,
        cityId: city.id,
        from: [cx + 44, cy - 120],
        to: [cx + 58, cy + 120],
      })
    })
  }
  return { districts, streets }
}

export const { districts: DISTRICTS, streets: STREETS } = buildGeo()

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

function phone(rand: () => number) {
  let digits = ''
  for (let i = 0; i < 8; i++) digits += Math.floor(rand() * 10)
  return `+9665${digits}`
}

function buildBusinesses(): Business[] {
  const rand = mulberry32(20261020)
  const list: Business[] = []
  for (const city of CITIES) {
    const cityDistricts = DISTRICTS.filter((d) => d.cityId === city.id)
    cityDistricts.forEach((district, di) => {
      const districtStreets = STREETS.filter((s) => s.districtId === district.id)
      for (let n = 0; n < 12; n++) {
        // Industrial districts skew towards suppliers, central districts towards buyers.
        const supplierBias = district.name.includes('الصناعية') || district.name === 'السلي' || district.name === 'البلد' ? 0.8 : 0.45
        const role: Role = rand() < supplierBias ? pick(rand, SUPPLIER_ROLES) : pick(rand, BUYER_ROLES)
        const cat = CATEGORIES[(di * 3 + n + Math.floor(rand() * 3)) % CATEGORIES.length]
        const word = pick(rand, WORDS)
        const specialty = pick(rand, cat.specialties)
        const name =
          role === 'مشتري مؤسسي'
            ? cat.buyerPattern.replace('{w}', word)
            : `${pick(rand, ROLE_PREFIX[role])} ${word} ${cat.phrase}`
        const activity = role === 'مشتري مؤسسي' ? cat.buyerActivity : `${role === 'تاجر تجزئة' ? 'بيع' : 'توريد'} ${cat.name}`
        const street = pick(rand, districtStreets)
        const t = 0.12 + rand() * 0.76
        const offset = (rand() - 0.5) * 44
        const isHorizontal = street.id.endsWith('s0')
        const x = street.from[0] + (street.to[0] - street.from[0]) * t + (isHorizontal ? 0 : offset)
        const y = street.from[1] + (street.to[1] - street.from[1]) * t + (isHorizontal ? offset : 0)
        const channels: Channel[] = []
        if (rand() < 0.82) channels.push('واتساب')
        if (rand() < 0.7) channels.push('هاتف')
        if (rand() < 0.45) channels.push('بريد إلكتروني')
        if (channels.length === 0) channels.push('هاتف')
        const consentRoll = rand()
        const consent: Consent = consentRoll < 0.58 ? 'granted' : consentRoll < 0.9 ? 'unknown' : 'declined'
        list.push({
          id: `${district.id}-b${n}`,
          name,
          category: cat.name,
          activity,
          specialty,
          role,
          wholesale: role === 'تاجر تجزئة' || role === 'مشتري مؤسسي' ? rand() < 0.2 : rand() < 0.78,
          cityId: city.id,
          districtId: district.id,
          streetId: street.id,
          channels,
          whatsapp: channels.includes('واتساب') ? phone(rand) : null,
          consent,
          x,
          y,
          rating: Math.round((3.4 + rand() * 1.6) * 10) / 10,
        })
      }
    })
  }

  // Inject duplicate listings (same WhatsApp number, name variant) so dedupe is visible.
  const withWhatsapp = list.filter((b) => b.whatsapp)
  const dupes: Business[] = []
  for (let i = 0; i < withWhatsapp.length; i += 9) {
    const src = withWhatsapp[i]
    dupes.push({
      ...src,
      id: `${src.id}-dup`,
      name: `${src.name} - الفرع الرئيسي`,
      x: src.x + 6,
      y: src.y - 5,
      duplicateOf: src.id,
    })
  }
  return [...list, ...dupes]
}

export const BUSINESSES: Business[] = buildBusinesses()

export const businessById = new Map(BUSINESSES.map((b) => [b.id, b]))
export const districtById = new Map(DISTRICTS.map((d) => [d.id, d]))
export const streetById = new Map(STREETS.map((s) => [s.id, s]))
export const cityById = new Map(CITIES.map((c) => [c.id, c]))

export const TEMPLATES: Template[] = [
  {
    id: 't-intro',
    name: 'تعريف بالخدمات',
    kind: 'تعريفي',
    approval: 'معتمد',
    body: 'مرحباً {{اسم_المنشأة}}، معك {{اسم_المرسل}} من {{اسم_شركتك}}. نقدم {{العرض}} لمنشآت حي {{الحي}}. هل يناسبكم نرسل لكم التفاصيل؟',
  },
  {
    id: 't-seasonal',
    name: 'عرض موسمي',
    kind: 'تسويقي',
    approval: 'معتمد',
    body: 'أهلاً {{اسم_المنشأة}}، لدينا عرض خاص على {{المنتج}} بخصم {{نسبة_الخصم}} حتى {{تاريخ_الانتهاء}}. للاستفسار رد بكلمة: مهتم.',
  },
  {
    id: 't-expo',
    name: 'دعوة لزيارة المعرض',
    kind: 'تسويقي',
    approval: 'قيد المراجعة',
    body: 'السلام عليكم {{اسم_المنشأة}}، يسعدنا دعوتكم لزيارة معرض {{اسم_شركتك}} في {{الموقع}} يوم {{التاريخ}} للاطلاع على أحدث {{المنتج}}.',
  },
  {
    id: 't-followup',
    name: 'متابعة عرض سابق',
    kind: 'خدمي',
    approval: 'معتمد',
    body: 'مرحباً {{اسم_المنشأة}}، نتابع معكم بخصوص {{العرض}} الذي أرسلناه سابقاً. هل لديكم أي استفسار يمكن أن نساعد فيه؟ {{اسم_المرسل}}',
  },
]

export const AUTO_VARIABLES = ['اسم_المنشأة', 'الحي']

export const DEFAULT_VARIABLES: Record<string, string> = {
  اسم_المرسل: 'سارة',
  اسم_شركتك: 'فرق للتوريد',
  العرض: 'توريد مستلزمات التشغيل بأسعار الجملة',
  المنتج: 'مستلزمات التغليف',
  نسبة_الخصم: '15%',
  تاريخ_الانتهاء: '30 نوفمبر 2026',
  الموقع: 'واجهة الرياض',
  التاريخ: '12 نوفمبر 2026',
}

function pickIds(pred: (b: Business) => boolean, count: number) {
  return BUSINESSES.filter((b) => !b.duplicateOf && pred(b))
    .slice(0, count)
    .map((b) => b.id)
}

const packagingSuppliers = pickIds((b) => b.cityId === 'riyadh' && b.category === 'تغليف وتعبئة' && ['مصنع', 'مورد', 'موزع'].includes(b.role), 5)
const constructionSuppliers = pickIds((b) => b.cityId === 'riyadh' && b.category === 'مواد بناء' && ['مصنع', 'مورد', 'موزع'].includes(b.role), 4)
const restaurantTargets = pickIds((b) => b.cityId === 'riyadh' && (b.category === 'معدات مطاعم' || b.category === 'مواد غذائية') && b.whatsapp !== null, 8)
const jeddahFood = pickIds((b) => b.cityId === 'jeddah' && b.category === 'مواد غذائية', 6)
const dammamElectrical = pickIds((b) => b.cityId === 'dammam' && b.category === 'كهربائيات', 5)
const officeSuppliers = pickIds((b) => b.cityId === 'riyadh' && b.category === 'أثاث مكتبي', 4)

export const SEED_REQUESTS: RequestItem[] = [
  {
    id: 'r-1001',
    type: 'rfq',
    title: 'طلب تسعير كراتين شحن مقاس متوسط',
    status: 'awaiting',
    createdAt: '2026-10-14T09:20:00Z',
    updatedAt: '2026-10-15T11:00:00Z',
    cityId: 'riyadh',
    businessIds: packagingSuppliers,
    goal: 'rfq',
    rfq: {
      lineItems: [
        { id: 'l1', name: 'كراتين شحن مموجة 40×30×30', qty: 5000, unit: 'حبة', spec: 'طبقتين، طباعة شعار لون واحد' },
        { id: 'l2', name: 'شريط لاصق شفاف', qty: 300, unit: 'لفة', spec: 'عرض 48 مم' },
      ],
      deadline: '2026-10-25',
      deliveryCity: 'الرياض',
      notes: 'التوريد على دفعتين خلال نوفمبر.',
    },
  },
  {
    id: 'r-1004',
    type: 'rfq',
    title: 'عروض أسعار حديد تسليح لمشروع النرجس',
    status: 'needs_decision',
    createdAt: '2026-10-08T07:45:00Z',
    updatedAt: '2026-10-18T13:30:00Z',
    cityId: 'riyadh',
    businessIds: constructionSuppliers,
    goal: 'rfq',
    rfq: {
      lineItems: [
        { id: 'l1', name: 'حديد تسليح 16 مم', qty: 40, unit: 'طن', spec: 'مطابق لمواصفات SASO' },
        { id: 'l2', name: 'حديد تسليح 12 مم', qty: 25, unit: 'طن', spec: 'مطابق لمواصفات SASO' },
      ],
      deadline: '2026-10-20',
      deliveryCity: 'الرياض',
      notes: 'التسليم في الموقع شمال الرياض.',
    },
  },
  {
    id: 'r-1002',
    type: 'campaign',
    title: 'حملة تعريفية لمطاعم ومقاهي الرياض',
    status: 'ready_manual',
    reviewedAt: '2026-10-13T08:10:00Z',
    createdAt: '2026-10-12T10:00:00Z',
    updatedAt: '2026-10-13T08:10:00Z',
    cityId: 'riyadh',
    businessIds: restaurantTargets,
    goal: 'target',
    campaign: {
      templateId: 't-intro',
      variables: { ...DEFAULT_VARIABLES, العرض: 'توريد البن والمواد الغذائية بالجملة' },
      included: restaurantTargets,
    },
  },
  {
    id: 'r-1003',
    type: 'list',
    title: 'قائمة موردي الأثاث المكتبي للمراجعة',
    status: 'draft',
    createdAt: '2026-10-17T15:05:00Z',
    updatedAt: '2026-10-17T15:05:00Z',
    cityId: 'riyadh',
    businessIds: officeSuppliers,
    goal: 'find-supplier',
    notes: 'مقارنة قبل تجهيز مكتب فرع الملقا.',
  },
  {
    id: 'r-1005',
    type: 'campaign',
    title: 'عرض موسمي لأسواق جدة',
    status: 'draft',
    createdAt: '2026-10-19T12:40:00Z',
    updatedAt: '2026-10-19T12:40:00Z',
    cityId: 'jeddah',
    businessIds: jeddahFood,
    goal: 'find-buyers',
    campaign: {
      templateId: 't-seasonal',
      variables: { ...DEFAULT_VARIABLES, المنتج: 'التمور الفاخرة' },
      included: jeddahFood.filter((id) => {
        const b = businessById.get(id)
        return Boolean(b?.whatsapp) && b?.consent === 'granted'
      }),
    },
  },
  {
    id: 'r-1006',
    type: 'rfq',
    title: 'توريد إنارة LED لمستودعات الدمام',
    status: 'completed',
    createdAt: '2026-09-21T08:00:00Z',
    updatedAt: '2026-10-02T09:00:00Z',
    cityId: 'dammam',
    businessIds: dammamElectrical,
    goal: 'rfq',
    rfq: {
      lineItems: [{ id: 'l1', name: 'كشاف LED صناعي 150 واط', qty: 120, unit: 'حبة', spec: 'ضمان سنتين' }],
      deadline: '2026-09-30',
      deliveryCity: 'الدمام',
      notes: '',
    },
  },
]

export const SEED_INBOX: InboxMessage[] = [
  {
    id: 'm-1',
    source: 'rfq',
    requestId: 'r-1004',
    businessId: constructionSuppliers[0],
    body: 'السلام عليكم، نرفق لكم عرض السعر للحديد المطلوب. الأسعار شاملة النقل داخل الرياض.',
    receivedAt: '2026-10-18T10:15:00Z',
    unread: true,
    quote: { lines: [{ name: 'حديد تسليح 16 مم', unitPrice: 2380, qty: 40 }, { name: 'حديد تسليح 12 مم', unitPrice: 2410, qty: 25 }], validity: '7 أيام', deliveryDays: 3 },
  },
  {
    id: 'm-2',
    source: 'rfq',
    requestId: 'r-1004',
    businessId: constructionSuppliers[1],
    body: 'عرضنا مرفق، ونقدر نوفر كامل الكمية من المستودع مباشرة.',
    receivedAt: '2026-10-17T16:40:00Z',
    unread: false,
    quote: { lines: [{ name: 'حديد تسليح 16 مم', unitPrice: 2340, qty: 40 }, { name: 'حديد تسليح 12 مم', unitPrice: 2450, qty: 25 }], validity: '5 أيام', deliveryDays: 5 },
  },
  {
    id: 'm-3',
    source: 'campaign',
    requestId: 'r-1002',
    businessId: restaurantTargets[0],
    body: 'أهلاً، مهتمين نعرف أسعار البن بالكرتون، وهل فيه توصيل أسبوعي؟',
    receivedAt: '2026-10-16T09:05:00Z',
    unread: true,
    sentiment: 'مهتم',
  },
  {
    id: 'm-4',
    source: 'rfq',
    requestId: 'r-1001',
    businessId: packagingSuppliers[0],
    body: 'تم استلام الطلب، هل الطباعة على وجه واحد أو وجهين؟',
    receivedAt: '2026-10-15T13:22:00Z',
    unread: true,
  },
  {
    id: 'm-5',
    source: 'campaign',
    requestId: 'r-1002',
    businessId: restaurantTargets[2],
    body: 'شكراً لكم، حالياً متعاقدين مع مورد آخر.',
    receivedAt: '2026-10-14T18:30:00Z',
    unread: false,
    sentiment: 'غير مهتم',
  },
  {
    id: 'm-6',
    source: 'campaign',
    requestId: 'r-1002',
    businessId: restaurantTargets[4],
    body: 'ممكن ترسلون كتالوج المنتجات؟',
    receivedAt: '2026-10-14T11:12:00Z',
    unread: false,
    sentiment: 'استفسار',
  },
  {
    id: 'm-7',
    source: 'rfq',
    requestId: 'r-1006',
    businessId: dammamElectrical[0],
    body: 'تم تأكيد التوريد وإرسال الفاتورة. شكراً لتعاملكم.',
    receivedAt: '2026-10-01T08:00:00Z',
    unread: false,
    quote: { lines: [{ name: 'كشاف LED صناعي 150 واط', unitPrice: 185, qty: 120 }], validity: 'منتهي', deliveryDays: 4 },
  },
]
