import Link from 'next/link'
import { ArrowLeft, Compass, Crosshair, Factory, House, MapPinned, Truck } from 'lucide-react'

const goals = [
  { id: 'explore', title: 'أفهم السوق', text: 'استكشف النشاط والمنافسة والفرص في المدن والأحياء.', icon: Compass },
  { id: 'expand', title: 'أختار موقعًا للتوسع', text: 'قارن السكان والسوق والطرق بين المواقع المرشحة.', icon: MapPinned },
  { id: 'target', title: 'أصل إلى عملاء جدد', text: 'اعثر على المنشآت المناسبة لما تبيعه وجهّز قائمة أو حملة.', icon: Crosshair },
  { id: 'find-supplier', title: 'أجد موردًا وأطلب عرض سعر', text: 'ابحث عن الموردين وأرسل احتياجك وقارن عروضهم.', icon: Factory },
  { id: 'network', title: 'أخطط للتوزيع والتغطية', text: 'خطط خدمة العملاء وتوزيع الطلبات عبر شبكة الطرق.', icon: Truck },
  { id: 'property', title: 'أبحث عن عقار', text: 'شاهد العروض على الخريطة وقارن بين خيارين بحسب احتياجك.', icon: House },
] as const

export function AtlasGoalLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3'}>
      {goals.map(({ id, title, text, icon: Icon }) => (
        // on a phone each goal is one row (icon, words, arrow) instead of a tall card: six goals in one screen, not three
        <Link
          key={id}
          href={`/map?goal=${id}`}
          className="group flex items-center gap-3 rounded-2xl border bg-card p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block sm:p-5"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
          <span className="min-w-0 flex-1 sm:block">
            <span className="block font-bold sm:mt-4">{title}</span>
            <span className="mt-0.5 block text-sm leading-6 text-muted-foreground sm:mt-1">{text}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary sm:mt-4">
            <span className="max-sm:sr-only">ابدأ</span><ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" aria-hidden />
          </span>
        </Link>
      ))}
    </div>
  )
}
