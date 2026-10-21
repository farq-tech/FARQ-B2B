import { Compass, Crosshair, Factory, FileText, Store, type LucideIcon } from 'lucide-react'
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
    id: 'find-supplier',
    label: 'ابحث عن مورد',
    description: 'مصانع وموردون وموزعون حسب التصنيف والحي',
    icon: Factory,
    primaryAction: 'list',
    placeholder: 'مثال: موردين كراتين بالجملة في السلي',
  },
  {
    id: 'find-buyers',
    label: 'ابحث عن مشترين',
    description: 'متاجر ومنشآت مؤسسية تحتاج منتجاتك',
    icon: Store,
    primaryAction: 'list',
    placeholder: 'مثال: مطاعم ومقاهي في العليا',
  },
  {
    id: 'explore',
    label: 'استكشف السوق',
    description: 'كثافة النشاط في الأحياء وشوارع النشاط',
    icon: Compass,
    primaryAction: 'list',
    placeholder: 'مثال: كهربائيات في الملز',
  },
  {
    id: 'target',
    label: 'استهدف منشآت',
    description: 'جهات ذات إشارة واتساب لتجهيز قائمة حملة للمراجعة',
    icon: Crosshair,
    primaryAction: 'campaign',
    placeholder: 'مثال: أسواق تموينية على شارع الستين',
  },
  {
    id: 'rfq',
    label: 'أنشئ طلب تسعير',
    description: 'اختر موردين وجهّز طلب تسعير للمراجعة',
    icon: FileText,
    primaryAction: 'rfq',
    placeholder: 'مثال: حديد تسليح في الصناعية الثانية',
  },
]

export const goalById = new Map(GOALS.map((g) => [g.id, g]))
