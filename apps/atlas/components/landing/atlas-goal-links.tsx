import Link from 'next/link'
import { ArrowLeft, Compass, Crosshair, Factory, MapPinned, Truck } from 'lucide-react'

const goals = [
  { id: 'explore', title: 'أفهم السوق', text: 'استكشف النشاط والمنافسة والفرص في المدن والأحياء.', icon: Compass },
  { id: 'expand', title: 'أختار موقعًا للتوسع', text: 'قارن السكان والسوق والطرق بين المواقع المرشحة.', icon: MapPinned },
  { id: 'target', title: 'أصل إلى عملاء جدد', text: 'اعثر على المنشآت المناسبة لما تبيعه وجهّز قائمة أو حملة.', icon: Crosshair },
  { id: 'find-supplier', title: 'أجد موردًا وأطلب عرض سعر', text: 'ابحث عن الموردين وأرسل احتياجك وقارن عروضهم.', icon: Factory },
  { id: 'network', title: 'أخطط للتوزيع والتغطية', text: 'خطط خدمة العملاء وتوزيع الطلبات عبر شبكة الطرق.', icon: Truck },
] as const

export function AtlasGoalLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'}>
      {goals.map(({ id, title, text, icon: Icon }) => (
        <Link
          key={id}
          href={`/opportunity-map?goal=${id}`}
          className="group rounded-2xl border bg-card p-5 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
          <span className="mt-4 block font-bold">{title}</span>
          <span className="mt-1 block text-sm leading-6 text-muted-foreground">{text}</span>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">ابدأ <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" aria-hidden /></span>
        </Link>
      ))}
    </div>
  )
}
