import { Compass, Crosshair, Factory, MapPinned, Truck, type LucideIcon } from 'lucide-react'
import type { GoalId, RequestType } from './types'

export interface GoalDef {
  id: GoalId
  label: string
  description: string
  icon: LucideIcon
  primaryAction: RequestType
  placeholder: string
}

export const GOALS: GoalDef[] = [
  {
    id: 'explore',
    label: 'أفهم السوق',
    description: 'استكشف النشاط والمنافسة والفرص في المدن والأحياء',
    icon: Compass,
    primaryAction: 'list',
    placeholder: 'مثال: حلويات ومخابز في شمال الرياض',
  },
  {
    id: 'expand',
    label: 'أختار موقعًا للتوسع',
    description: 'قارن الأحياء والمواقع حسب السكان والسوق والطرق',
    icon: MapPinned,
    primaryAction: 'list',
    placeholder: 'مثال: موقع فرع جديد لمقهى في شمال الرياض',
  },
  {
    id: 'target',
    label: 'أصل إلى عملاء جدد',
    description: 'اعثر على المنشآت المناسبة لما تبيعه وجهّز قائمة أو حملة',
    icon: Crosshair,
    primaryAction: 'campaign',
    placeholder: 'مثال: أسواق تموينية على شارع الستين',
  },
  {
    id: 'find-supplier',
    label: 'أجد موردًا وأطلب عرض سعر',
    description: 'ابحث عن الموردين وحدد ما تحتاجه وقارن عروضهم',
    icon: Factory,
    primaryAction: 'rfq',
    placeholder: 'مثال: موردين كراتين بالجملة في السلي',
  },
  {
    id: 'network',
    label: 'أخطط للتوزيع والتغطية',
    description: 'خطط خدمة العملاء وتوزيع الطلبات عبر شبكة الطرق',
    icon: Truck,
    primaryAction: 'list',
    placeholder: 'مثال: خطط التوزيع من مستودع السلي إلى عملاء الرياض',
  },
]

export const goalById = new Map(GOALS.map((g) => [g.id, g]))
