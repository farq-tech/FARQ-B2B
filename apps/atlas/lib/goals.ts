import { Compass, Crosshair, Factory, type LucideIcon } from 'lucide-react'
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
    id: 'explore',
    label: 'استكشف السوق',
    description: 'كثافة النشاط في الأحياء وشوارع النشاط',
    icon: Compass,
    primaryAction: 'list',
    placeholder: 'مثال: كهربائيات في الملز',
  },
  {
    id: 'target',
    label: 'ابحث عن عملاء',
    description: 'منشآت مناسبة للبيع أو تجهيز قائمة تواصل للمراجعة',
    icon: Crosshair,
    primaryAction: 'campaign',
    placeholder: 'مثال: أسواق تموينية على شارع الستين',
  },
]

export const goalById = new Map(GOALS.map((g) => [g.id, g]))
